const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;
const text = value => typeof value === 'string' ? value : '';
const date = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const failure = () => Object.assign(new Error('车辆数据服务暂不可用，请检查上游连接、鉴权及版本。'), { status: 502 });

function list(value) {
  if (value === null) return [];
  if (!Array.isArray(value)) throw failure();
  return value;
}

function record(row, field) {
  if (!object(row) || !Number.isSafeInteger(row[field]) || row[field] < 1 || !date(row.start_date)) throw failure();
  return row;
}

async function get(config, fetcher, path) {
  try {
    const response = await fetcher(`${config.upstream}${path}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json', ...(config.authorization ? { Authorization: config.authorization } : {}) }
    });
    if (!response.ok) throw failure();
    const payload = await response.json();
    if (!object(payload?.data)) throw failure();
    return payload.data;
  } catch { throw failure(); }
}

const km = (value, unit) => number(value) === null ? null : unit === 'km' ? value : unit === 'mi' ? value * 1.609344 : null;

async function locationLabel(geodata, geocode) {
  const name = text(geodata?.geofence).trim();
  if (name) return name;
  const latitude = number(geodata?.location?.latitude ?? geodata?.latitude);
  const longitude = number(geodata?.location?.longitude ?? geodata?.longitude);
  // 上游缺失坐标可能默认为 (0, 0)，不把这对值当成实际位置。
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return null;
  if (geocode) return await geocode(latitude, longitude) || '位置已收到，地址暂未解析';
  return `纬度 ${latitude.toFixed(5)} · 经度 ${longitude.toFixed(5)}`;
}

function trip(row, unit) {
  record(row, 'drive_id');
  const distanceKm = km(row.odometer_details?.odometer_distance, unit);
  const energyKwh = number(row.energy_consumed_net);
  return {
    id: row.drive_id, startedAt: date(row.start_date), endedAt: date(row.end_date),
    from: text(row.start_address), to: text(row.end_address), distanceKm,
    durationMin: number(row.duration_min), energyKwh,
    efficiencyWhKm: energyKwh !== null && distanceKm > 0 ? energyKwh * 1000 / distanceKm : null,
    points: []
  };
}

function charge(row) {
  record(row, 'charge_id');
  return {
    id: row.charge_id, startedAt: date(row.start_date), endedAt: date(row.end_date),
    location: text(row.address), energyKwh: number(row.charge_energy_added), cost: number(row.cost), currency: '',
    startPct: number(row.battery_details?.start_battery_level), endPct: number(row.battery_details?.end_battery_level),
    kind: 'unknown', durationMin: number(row.duration_min), curve: []
  };
}

export async function loadDetail(config, kind, id, fetcher = globalThis.fetch, now = new Date()) {
  const isTrip = kind === 'trips';
  const data = await get(config, fetcher, `/api/v1/cars/${config.carId}/${isTrip ? 'drives' : 'charges'}/${id}`);
  const row = data[isTrip ? 'drive' : 'charge'];
  if (data.car?.car_id !== config.carId || row?.[isTrip ? 'drive_id' : 'charge_id'] !== id) throw failure();
  const result = isTrip ? trip(row, data.units?.unit_of_length) : charge(row);
  if (Date.parse(result.startedAt) < now.getTime() - 30 * 86400000 || Date.parse(result.startedAt) > now.getTime()) {
    throw Object.assign(new Error('仅支持最近 30 天的记录'), { status: 404 });
  }
  if (isTrip) {
    result.points = list(row.drive_details ?? null).filter(point =>
      object(point) && number(point.latitude) !== null && Math.abs(point.latitude) <= 90 &&
      number(point.longitude) !== null && Math.abs(point.longitude) <= 180 && (point.latitude !== 0 || point.longitude !== 0)
    ).map(point => ({ latitude: point.latitude, longitude: point.longitude }));
  } else {
    const details = list(row.charge_details ?? null).filter(object);
    result.curve = details.flatMap(point => {
      const minute = date(point.date) ? (Date.parse(point.date) - Date.parse(result.startedAt)) / 60000 : null;
      const powerKw = number(point.charger_details?.charger_power);
      return minute !== null && minute >= 0 && powerKw !== null ? [{ minute, powerKw }] : [];
    });
    if (details.some(point => point.fast_charger_info?.fast_charger_present === true)) result.kind = 'DC';
    else if (details.some(point => point.fast_charger_info?.fast_charger_present === false)) result.kind = 'AC';
  }
  return result;
}

export async function loadSnapshot(config, fetcher = globalThis.fetch, now = new Date(), geocode) {
  const from = new Date(now.getTime() - 30 * 86400000).toISOString();
  const to = now.toISOString();
  const query = new URLSearchParams({ startDate: from, endDate: to, page: '1', show: '100' });
  const base = `/api/v1/cars/${config.carId}`;
  const [status, drives, chargeList] = await Promise.all([
    get(config, fetcher, `${base}/status`),
    get(config, fetcher, `${base}/drives?${query}`), get(config, fetcher, `${base}/charges?${query}`)
  ]);
  if (!object(status.status) || status.car?.car_id !== config.carId ||
      drives.car?.car_id !== config.carId || chargeList.car?.car_id !== config.carId) throw failure();
  const lengthUnit = status.units?.unit_of_length;
  const tempUnit = status.units?.unit_of_temperature;
  const pressureUnit = status.units?.unit_of_pressure;
  const distance = value => km(value, lengthUnit);
  const temp = value => number(value) === null ? null : tempUnit === 'C' ? value : tempUnit === 'F' ? (value - 32) * 5 / 9 : null;
  const pressure = value => number(value) === null ? null : pressureUnit === 'bar' ? value : pressureUnit === 'psi' ? value / 14.5037738 : null;
  const s = status.status;
  const battery = s.battery_details || {}, charging = s.charging_details || {}, tpms = s.tpms_details || {};
  const notices = [
    '真实数据仅取最近 30 天已结束的行程和充电，各最多 100 条；数量达到上限时可能不完整。',
    '行程轨迹和充电曲线按需读取；无采集样本时留空，不补造轨迹或曲线。',
    '上游未提供车况采样时间，状态可能为缓存；本页更新时间仅表示接口读取时间。',
    '能耗沿用 TeslaMate 的估算口径；上游未提供货币，费用不标注币种。部分上游缺失值会被上游转换为 0，需以源记录核对。'
  ];
  if (!['km', 'mi'].includes(lengthUnit) || !['C', 'F'].includes(tempUnit) || !['bar', 'psi'].includes(pressureUnit)) {
    notices.push('部分单位未知，相关数值留空，未猜测单位。');
  }
  if (geocode) notices.push('地址为车辆最后上报位置附近的道路或地点，仅供参考；解析由 Photon 提供，地图数据 © OpenStreetMap contributors（ODbL）：https://www.openstreetmap.org/copyright');
  const trips = list(drives.drives).map(row => trip(row, drives.units?.unit_of_length || lengthUnit))
    .filter(row => row.startedAt >= from && row.startedAt <= to);
  const charges = list(chargeList.charges).map(charge).filter(row => row.startedAt >= from && row.startedAt <= to);
  return {
    source: 'teslamate', generatedAt: to, notices,
    vehicle: {
      id: config.carId, name: text(status.car.car_name), model: text(s.car_details?.model),
      state: ['asleep', 'online', 'charging', 'driving', 'offline'].includes(s.state) ? s.state : 'unknown',
      observedAt: null, batteryPct: number(battery.battery_level), rangeKm: distance(battery.rated_battery_range),
      odometerKm: distance(s.odometer), locked: boolean(s.car_status?.locked), sentry: boolean(s.car_status?.sentry_mode),
      insideTempC: temp(s.climate_details?.inside_temp), outsideTempC: temp(s.climate_details?.outside_temp),
      openings: {
        windows: boolean(s.car_status?.windows_open),
        driverFront: boolean(s.car_status?.driver_front_door_open), driverRear: boolean(s.car_status?.driver_rear_door_open),
        passengerFront: boolean(s.car_status?.passenger_front_door_open), passengerRear: boolean(s.car_status?.passenger_rear_door_open),
        trunk: boolean(s.car_status?.trunk_open), frunk: boolean(s.car_status?.frunk_open)
      },
      climate: { on: boolean(s.climate_details?.is_climate_on), preconditioning: boolean(s.climate_details?.is_preconditioning) },
      locationName: await locationLabel(s.car_geodata, geocode),
      tyres: { fl: pressure(tpms.tpms_pressure_fl), fr: pressure(tpms.tpms_pressure_fr), rl: pressure(tpms.tpms_pressure_rl), rr: pressure(tpms.tpms_pressure_rr) },
      charging: charging.charging_state === 'Charging' || s.state === 'charging' ? {
        powerKw: number(charging.charger_power), voltage: number(charging.charger_voltage), currentA: number(charging.charger_actual_current),
        remainingMin: number(charging.time_to_full_charge) === null ? null : charging.time_to_full_charge * 60,
        limitPct: number(charging.charge_limit_soc)
      } : null
    }, trips, charges
  };
}
