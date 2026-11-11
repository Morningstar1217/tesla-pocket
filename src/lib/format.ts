import type { VehicleState } from '../../shared/types'

export function num(value: number | null | undefined, digits = 0) {
  return value == null || !Number.isFinite(value) ? '--' : value.toFixed(digits)
}

export function energyValue(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? '待校准' : num(value, digits)
}

function localDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function dateTime(value: string | null | undefined) {
  const date = localDate(value)
  if (!date) return '时间未知'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function shortDate(value: string | null | undefined) {
  const date = localDate(value)
  return date ? `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')}` : '--'
}

export function duration(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '--'
  const total = Math.round(minutes)
  return total < 60 ? `${total}分钟` : `${Math.floor(total / 60)}小时${total % 60 ? `${total % 60}分` : ''}`
}

export const stateLabels: Record<VehicleState, string> = {
  asleep: '车辆休眠', online: '车辆在线', charging: '正在充电', driving: '行驶中', offline: '车辆离线', unknown: '状态未知',
}

export function openingSummary(states: (boolean | null | undefined)[]) {
  const count = states.filter(value => value === true).length
  if (count) return `${count}处开启`
  return !states.length || states.some(value => value == null) ? '状态未知' : '全部关闭'
}

// 列表只显示地点名；原始完整地址继续用于详情。
export function shortAddress(value: string | null | undefined) {
  const address = value?.trim() || ''
  if (!address) return ''
  const parts = address.split(/\s+·\s+/)
  const administrative = /^(?:[\u4e00-\u9fff]{1,12}?(?:省|自治区|自治州|地区|市|区|县))+/
  const place = parts.length > 1 && administrative.test(parts[0]) ? parts[parts.length - 1] : parts[0]
  const compact = place.replace(administrative, '').replace(/[(（][^()（）]*[)）]/g, '').trim()
  return compact || place
}
