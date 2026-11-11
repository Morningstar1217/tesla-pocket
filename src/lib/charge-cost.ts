import type { Charge } from '../../shared/types'

export interface ChargeCostEntry { mode: 'total' | 'rate'; value: number }
export type ChargeCosts = Record<string, ChargeCostEntry>

export function chargeCostKey(charge: Pick<Charge, 'id' | 'startedAt'>) {
  return `${charge.id}:${charge.startedAt}`
}

export function parseChargeCost(input: string, mode: ChargeCostEntry['mode']): ChargeCostEntry {
  const text = input.trim()
  const valid = mode === 'total' ? /^\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,4})?$/
  const value = Number(text)
  if (!valid.test(text) || !Number.isFinite(value) || value > 999999) {
    throw new Error(mode === 'total' ? '请填写 0～999999 元的金额，最多两位小数。' : '请填写 0～999999 元/度的单价，最多四位小数。')
  }
  return { mode, value }
}

export function chargeCost(charge: Pick<Charge, 'cost' | 'energyKwh'>, entry?: ChargeCostEntry): number | null {
  if (!entry) return charge.cost != null && Number.isFinite(charge.cost) ? charge.cost : null
  if (entry.mode === 'total') return entry.value
  if (charge.energyKwh == null || !Number.isFinite(charge.energyKwh) || charge.energyKwh < 0) return null
  return Math.round((charge.energyKwh * entry.value + Number.EPSILON) * 100) / 100
}

export function loadChargeCosts(scope: string): ChargeCosts {
  const saved = uni.getStorageSync(`tesla-pocket.charge-costs.v1:${scope}`)
  const result: ChargeCosts = {}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return result
  for (const [key, entry] of Object.entries(saved)) {
    if (!entry || typeof entry !== 'object') continue
    const { mode, value } = entry as ChargeCostEntry
    if ((mode !== 'total' && mode !== 'rate') || typeof value !== 'number') continue
    try { result[key] = parseChargeCost(String(value), mode) } catch { /* Ignore invalid local entries. */ }
  }
  return result
}

export function saveChargeCosts(scope: string, entries: ChargeCosts) {
  try { uni.setStorageSync(`tesla-pocket.charge-costs.v1:${scope}`, entries) }
  catch { throw new Error('费用保存失败，请检查设备存储空间后重试。') }
}
