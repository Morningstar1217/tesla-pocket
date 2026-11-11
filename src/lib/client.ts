import type { Snapshot, Trip, Charge } from '../../shared/types'
import { createDemoSnapshot } from '../../shared/demo.mjs'

export interface Settings { mode: 'demo' | 'live'; baseUrl: string; token: string }
const storageKey = 'tesla-pocket.connection.v1'
const defaults: Settings = { mode: 'demo', baseUrl: '', token: '' }
let demo: Snapshot | null = null

export function getSettings(): Settings {
  const saved = uni.getStorageSync(storageKey)
  if (!saved || (saved.mode !== 'demo' && saved.mode !== 'live')) return { ...defaults }
  return { mode: saved.mode, baseUrl: String(saved.baseUrl || ''), token: String(saved.token || '') }
}

export function saveSettings(settings: Settings) {
  const baseUrl = settings.baseUrl.trim().replace(/\/+$/, '')
  const token = settings.token.trim()
  if (settings.mode === 'live') {
    const address = /^http:\/\/((?:\d{1,3}\.){3}\d{1,3})(?::\d+)?$/.exec(baseUrl)?.[1]
    const parts = address?.split('.') || []
    const octets = parts.map(Number)
    const privateIp = parts.length === 4 && octets.every((n, i) => n <= 255 && String(n) === parts[i]) &&
      (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168))
    if (!privateIp && !/^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:localhost|127\.0\.0\.1))(?::\d+)?$/i.test(baseUrl)) {
      throw new Error('请填写 HTTPS 服务根地址，或本机/可信局域网 HTTP 地址；不带 /api')
    }
    if (token.length < 32) throw new Error('访问令牌至少 32 位，请填写自己服务的 APP_ACCESS_TOKEN')
  }
  uni.setStorageSync(storageKey, { mode: settings.mode, baseUrl, token })
}

export function resetSettings() {
  uni.removeStorageSync(storageKey)
}

function request<T>(path: string): Promise<T> {
  const settings = getSettings()
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${settings.baseUrl}${path}`,
      method: 'GET', timeout: path.endsWith('/map') ? 25000 : 15000,
      header: { Authorization: `Bearer ${settings.token}`, Accept: 'application/json' },
      success: (response) => {
        if (response.statusCode === 401 || response.statusCode === 403) return reject(new Error('连接未授权，请检查访问令牌'))
        if (response.statusCode !== 200) return reject(new Error('服务暂不可用，请检查后端配置后重试'))
        if (!response.data || typeof response.data !== 'object') return reject(new Error('服务返回的数据格式不正确'))
        resolve(response.data as T)
      },
      fail: () => reject(new Error('连接失败，请检查网络、服务地址及 HTTPS 证书；局域网连接需处于同一 Wi-Fi')),
    })
  })
}

export async function fetchSnapshot(): Promise<Snapshot> {
  if (getSettings().mode === 'demo') {
    demo = createDemoSnapshot(new Date()) as Snapshot
    return demo
  }
  const value = await request<Snapshot>('/api/dashboard')
  if (value.source !== 'teslamate') throw new Error('服务尚未连接 TeslaMate，仍返回演示数据；请完成后端配置')
  if (!value.vehicle || !Array.isArray(value.trips) || !Array.isArray(value.charges)) throw new Error('车辆数据结构不完整，请检查服务版本')
  return value
}

export async function fetchTrip(id: number): Promise<Trip> {
  if (getSettings().mode === 'demo') {
    const value = (demo ?? (createDemoSnapshot(new Date()) as Snapshot)).trips.find(trip => trip.id === id)
    if (!value) throw new Error('未找到该行程')
    return value as Trip
  }
  return request<Trip>(`/api/trips/${id}`)
}

export async function fetchCharge(id: number): Promise<Charge> {
  if (getSettings().mode === 'demo') {
    const value = (demo ?? (createDemoSnapshot(new Date()) as Snapshot)).charges.find(charge => charge.id === id)
    if (!value) throw new Error('未找到该充电记录')
    return value as Charge
  }
  return request<Charge>(`/api/charges/${id}`)
}

export async function fetchTripLocations(id: number): Promise<{ from: string; to: string }> {
  const value = await request<{ from: string; to: string }>(`/api/trips/${id}/locations`)
  if (typeof value.from !== 'string' || typeof value.to !== 'string') throw new Error('行程地址格式不正确')
  return { from: value.from, to: value.to }
}

export async function fetchTripMap(id: number): Promise<{ image: string; sampled: boolean }> {
  const value = await request<{ image: string; sampled: boolean }>(`/api/trips/${id}/map`)
  if (typeof value.image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.image)) throw new Error('街道地图格式不正确')
  return { image: value.image, sampled: value.sampled === true }
}
