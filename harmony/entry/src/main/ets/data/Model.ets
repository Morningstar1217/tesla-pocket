export interface Point { latitude: number; longitude: number }
export interface PowerPoint { minute: number; powerKw: number }
export interface Trip {
  id: number; startedAt: string; endedAt: string | null; from: string; to: string;
  distanceKm: number | null; durationMin: number | null; energyKwh: number | null;
  efficiencyWhKm: number | null; points: Point[];
}
export interface Charge {
  id: number; startedAt: string; endedAt: string | null; location: string;
  energyKwh: number | null; cost: number | null; currency: string;
  startPct: number | null; endPct: number | null; kind: string;
  durationMin: number | null; curve: PowerPoint[];
}
export interface Openings {
  windows: boolean | null; driverFront: boolean | null; driverRear: boolean | null;
  passengerFront: boolean | null; passengerRear: boolean | null; trunk: boolean | null; frunk: boolean | null;
}
export interface Climate { on: boolean | null; preconditioning: boolean | null }
export interface Tyres { fl: number | null; fr: number | null; rl: number | null; rr: number | null }
export interface Charging {
  powerKw: number | null; voltage: number | null; currentA: number | null;
  remainingMin: number | null; limitPct: number | null;
}
export interface Vehicle {
  id: number; name: string; model: string; state: string; observedAt: string | null;
  batteryPct: number | null; rangeKm: number | null; odometerKm: number | null;
  locked: boolean | null; sentry: boolean | null; insideTempC: number | null;
  outsideTempC: number | null; locationName: string | null;
  openings: Openings; climate: Climate; tyres: Tyres; charging: Charging | null;
}
export interface Snapshot { source: string; generatedAt: string; notices: string[]; vehicle: Vehicle; trips: Trip[]; charges: Charge[] }
export interface Settings { mode: string; baseUrl: string; token: string }
export interface CostEntry { mode: string; value: number }
export interface Locations { from: string; to: string }
export interface StreetMap { image: string; sampled: boolean }
export const ENERGY_HINT = '能耗待校准：TeslaMate 需要至少两次超过 10 分钟、且电量低于 95% 的充电记录。校准后会自动估算历史行程；采样不足的行程仍可能暂无数据。';
export const CONNECTION_KEY = 'tesla-pocket.connection.v1';
export const COST_PREFIX = 'tesla-pocket.charge-costs.v1:';

export function defaultSettings(): Settings { return { mode: 'demo', baseUrl: '', token: '' }; }
export function emptySnapshot(): Snapshot {
  return {
    source: 'demo', generatedAt: '', notices: [], trips: [], charges: [],
    vehicle: {
      id: 0, name: '', model: '', state: 'unknown', observedAt: null, batteryPct: null, rangeKm: null,
      odometerKm: null, locked: null, sentry: null, insideTempC: null, outsideTempC: null, locationName: null,
      openings: { windows: null, driverFront: null, driverRear: null, passengerFront: null, passengerRear: null, trunk: null, frunk: null },
      climate: { on: null, preconditioning: null }, tyres: { fl: null, fr: null, rl: null, rr: null }, charging: null
    }
  };
}
export function validateSettings(input: Settings): Settings {
  if (input.mode !== 'demo' && input.mode !== 'live') throw new Error('连接模式不正确');
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
  const token = input.token.trim();
  if (input.mode === 'live') {
    const match = /^http:\/\/((?:\d{1,3}\.){3}\d{1,3})(?::\d+)?$/.exec(baseUrl);
    const parts = match ? match[1].split('.') : [];
    const octets = parts.map((p: string) => Number(p));
    const privateIp = parts.length === 4 && octets.every((n: number, i: number) => n <= 255 && String(n) === parts[i]) &&
      (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
    if (!privateIp && !/^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:localhost|127\.0\.0\.1))(?::\d+)?$/i.test(baseUrl)) {
      throw new Error('请填写 HTTPS 服务根地址，或本机/可信局域网 HTTP 地址；不带 /api');
    }
    if (token.length < 32 || /[\r\n]/.test(token)) throw new Error('访问令牌至少 32 位，请填写自己服务的 APP_ACCESS_TOKEN');
  }
  return { mode: input.mode, baseUrl, token };
}
export function finite(value: number | null | undefined): boolean { return typeof value === 'number' && Number.isFinite(value); }
export function num(value: number | null | undefined, digits: number = 0): string { return finite(value) ? (value as number).toFixed(digits) : '--'; }
export function energy(value: number | null, digits: number = 1): string { return finite(value) ? num(value, digits) : '待校准'; }
export function money(value: number | null): string { return finite(value) ? `¥${num(value, 2)}` : '--'; }
export function progress(value: number | null): number { return finite(value) ? Math.max(0, Math.min(100, value as number)) : 0; }
export function dateTime(value: string | null): string {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function duration(value: number | null): string {
  if (!finite(value) || (value as number) < 0) return '--';
  const n = Math.round(value as number);
  return n < 60 ? `${n}分钟` : `${Math.floor(n / 60)}小时${n % 60 ? `${n % 60}分` : ''}`;
}
export function booleanLabel(value: boolean | null | undefined, yes: string, no: string): string { return typeof value !== 'boolean' ? '未知' : value ? yes : no; }
export function openingSummary(values: (boolean | null)[]): string {
  const n = values.filter((v: boolean | null) => v === true).length;
  return n ? `${n}处开启` : !values.length || values.some((v: boolean | null) => typeof v !== 'boolean') ? '状态未知' : '全部关闭';
}
export function stateLabel(state: string): string {
  switch (state) {
    case 'asleep': return '车辆休眠';
    case 'online': return '车辆在线';
    case 'charging': return '正在充电';
    case 'driving': return '行驶中';
    case 'offline': return '车辆离线';
    default: return '状态未知';
  }
}
export function shortAddress(value: string): string {
  const address = value.trim();
  if (!address) return '';
  const parts = address.split(/\s+·\s+/);
  const administrative = /^(?:[\u4e00-\u9fff]{1,12}?(?:省|自治区|自治州|地区|市|区|县))+/;
  const place = parts.length > 1 && administrative.test(parts[0]) ? parts[parts.length - 1] : parts[0];
  return place.replace(administrative, '').replace(/[(（][^()（）]*[)）]/g, '').trim() || place;
}
export function inRange(start: string, reference: string, days: number): boolean {
  if (!days) return true;
  const now = Date.parse(reference);
  const date = Date.parse(start);
  return Number.isFinite(date) && date >= (Number.isFinite(now) ? now : Date.now()) - days * 86400000;
}
export function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((v: number | null) => finite(v));
  return known.length ? known.reduce((a: number, b: number | null) => a + (b as number), 0) : null;
}
export function costScope(snapshot: Snapshot, settings: Settings): string {
  const values: (string | number)[] = [snapshot.source, snapshot.source === 'demo' ? '' : settings.baseUrl, snapshot.vehicle.id];
  return JSON.stringify(values);
}
export function costKey(charge: Charge): string { return `${charge.id}:${charge.startedAt}`; }
export function parseCost(input: string, mode: string): CostEntry {
  const text = input.trim();
  const valid = mode === 'total' ? /^\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,4})?$/;
  const value = Number(text);
  if ((mode !== 'total' && mode !== 'rate') || !valid.test(text) || !Number.isFinite(value) || value > 999999) {
    throw new Error(mode === 'total' ? '请填写 0～999999 元的金额，最多两位小数。' : '请填写 0～999999 元/度的单价，最多四位小数。');
  }
  return { mode, value };
}
export function effectiveCost(charge: Charge, entry?: CostEntry): number | null {
  if (!entry) return finite(charge.cost) ? charge.cost : null;
  if (entry.mode === 'total') return entry.value;
  if (!finite(charge.energyKwh) || (charge.energyKwh as number) < 0) return null;
  return Math.round(((charge.energyKwh as number) * entry.value + Number.EPSILON) * 100) / 100;
}
export function peakIndex(curve: PowerPoint[]): number {
  let index = 0;
  curve.forEach((point: PowerPoint, i: number) => { if (finite(point.powerKw) && point.powerKw > curve[index].powerKw) index = i; });
  return index;
}
export function powerMaximum(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(peak));
  return Number((Math.ceil(peak / step) * step).toPrecision(12));
}
export function validPoints(points: Point[]): Point[] {
  return points.filter((p: Point) => p && finite(p.latitude) && finite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && (p.latitude !== 0 || p.longitude !== 0));
}
export function validateTrip(value: Trip): Trip {
  if (!value || !Number.isInteger(value.id) || typeof value.startedAt !== 'string' || typeof value.from !== 'string' || typeof value.to !== 'string' || !Array.isArray(value.points)) throw new Error('行程数据结构不完整');
  value.points = validPoints(value.points);
  return value;
}
export function validateCharge(value: Charge): Charge {
  if (!value || !Number.isInteger(value.id) || typeof value.startedAt !== 'string' || typeof value.location !== 'string' || !Array.isArray(value.curve)) throw new Error('充电数据结构不完整');
  value.curve = value.curve.filter((p: PowerPoint) => p && finite(p.minute) && finite(p.powerKw));
  return value;
}
export function validateSnapshot(value: Snapshot, live: boolean): Snapshot {
  if (!value || (live ? value.source !== 'teslamate' : value.source !== 'demo')) throw new Error('服务尚未连接 TeslaMate，或数据来源不正确');
  if (!value.vehicle || !Number.isInteger(value.vehicle.id) || !Array.isArray(value.trips) || !Array.isArray(value.charges) || !Array.isArray(value.notices)) throw new Error('车辆数据结构不完整，请检查服务版本');
  const defaults = emptySnapshot().vehicle;
  if (!value.vehicle.openings || typeof value.vehicle.openings !== 'object' || Array.isArray(value.vehicle.openings)) value.vehicle.openings = defaults.openings;
  if (!value.vehicle.climate || typeof value.vehicle.climate !== 'object' || Array.isArray(value.vehicle.climate)) value.vehicle.climate = defaults.climate;
  if (!value.vehicle.tyres || typeof value.vehicle.tyres !== 'object' || Array.isArray(value.vehicle.tyres)) value.vehicle.tyres = defaults.tyres;
  value.notices = value.notices.filter((notice: string) => typeof notice === 'string');
  value.trips = value.trips.map((trip: Trip) => validateTrip(trip));
  value.charges = value.charges.map((charge: Charge) => validateCharge(charge));
  return value;
}
