export function powerAxisMaximum(peak: number | null): number {
  if (peak == null || !Number.isFinite(peak) || peak <= 0) return 1
  const step = 10 ** Math.floor(Math.log10(peak))
  return Number((Math.ceil(peak / step) * step).toPrecision(12))
}

export function powerHeight(power: number, maximum: number): number {
  if (!Number.isFinite(power) || !Number.isFinite(maximum) || maximum <= 0) return 0
  return Math.max(0, Math.min(100, power / maximum * 100))
}
