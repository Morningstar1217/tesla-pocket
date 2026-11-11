export const tabs = [
  { id: 'vehicle', label: '车况' },
  { id: 'charges', label: '充电' },
  { id: 'trips', label: '行程' },
  { id: 'settings', label: '设置' },
] as const

export type Tab = typeof tabs[number]['id']

export function tabForNativeIndex(index: unknown): Tab | null {
  return typeof index === 'number' && Number.isInteger(index) ? tabs[index]?.id ?? null : null
}

export type NavigationScroll = { anchorTop: number; hidden: boolean }

export function updateNavigationScroll(state: NavigationScroll, value: unknown): NavigationScroll {
  if (typeof value !== 'number' || !Number.isFinite(value)) return state
  const top = Math.max(0, value)
  if (top <= 12) return state.hidden || state.anchorTop !== 0 ? { anchorTop: 0, hidden: false } : state
  const delta = top - state.anchorTop
  if (state.hidden && delta > 0 || !state.hidden && delta < 0) return { ...state, anchorTop: top }
  if (!state.hidden && delta >= 48) return { anchorTop: top, hidden: true }
  if (state.hidden && delta <= -48) return { anchorTop: top, hidden: false }
  return state
}
