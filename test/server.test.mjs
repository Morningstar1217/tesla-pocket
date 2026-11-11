import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDemoSnapshot } from '../shared/demo.mjs';
import { createHandler } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { loadSnapshot, loadDetail } from '../server/teslamate.mjs';

const now = new Date('2026-10-21T10:00:00Z');
const token = 'a'.repeat(32);
const config = { upstream: 'https://teslamate.example', carId: 1, appToken: token, authorization: 'Basic hidden-upstream-secret' };
const trip = { drive_id: 11, start_date: '2026-10-20T08:00:00+08:00', end_date: '2026-10-20T08:30:00+08:00', odometer_details: { odometer_distance: 10 }, energy_consumed_net: 2.5 };
const charge = { charge_id: 22, start_date: '2026-10-20T09:00:00+08:00', end_date: '2026-10-20T09:30:00+08:00', charge_energy_added: 30, cost: 0, battery_details: { start_battery_level: 20, end_battery_level: 80 } };
function upstream(overrides = {}) {
  const payloads = {
    status: { car: { car_id: 1, car_name: '真实车辆' }, units: { unit_of_length: 'mi', unit_of_temperature: 'F', unit_of_pressure: 'psi' }, status: {
      state: 'charging', odometer: 100, car_details: { model: 'Y' }, battery_details: { battery_level: 0, rated_battery_range: 10 },
      car_status: { locked: false }, climate_details: { inside_temp: 68, outside_temp: 32 },
      tpms_details: { tpms_pressure_fl: 43.5113214 }, charging_details: { charging_state: 'Charging', time_to_full_charge: 0.5, charger_power: 7.1 }
    } },
    drives: { car: { car_id: 1 }, units: { unit_of_length: 'mi' }, drives: [trip] },
    charges: { car: { car_id: 1 }, charges: [charge] },
    '11': { car: { car_id: 1 }, units: { unit_of_length: 'mi' }, drive: { ...trip, drive_details: [{ latitude: 31.2, longitude: 121.5 }, { latitude: null, longitude: 0 }] } },
    '22': { car: { car_id: 1 }, charge: { ...charge, charge_details: [
      { date: '2026-10-20T09:05:00+08:00', charger_details: { charger_power: 120 }, fast_charger_info: { fast_charger_present: true } },
      { date: '2026-10-20T09:10:00+08:00', charger_details: {} }
    ] } },
    ...overrides
  };
  const calls = [];
  const fetch = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    const key = parsed.pathname.split('/').at(-1);
    assert.ok(key in payloads, `Unexpected upstream endpoint: ${key}`);
    return { ok: true, json: async () => ({ data: structuredClone(payloads[key]) }) };
  };
  return { fetch, calls };
}
async function request(handler, url, { method = 'GET', authorization } = {}) {
  const response = { status: 0, headers: {}, body: undefined,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
  await handler({ url, method, headers: authorization ? { authorization } : {} }, response);
  return response;
}

test('演示数据完整且每次生成独立对象', () => {
  const first = createDemoSnapshot(now), second = createDemoSnapshot(now);
  assert.equal(first.source, 'demo');
  assert.equal(first.generatedAt, now.toISOString());
  assert.equal(first.trips.length, 6);
  assert.equal(first.charges.length, 5);
  assert.ok(first.trips.every(row => row.points.length >= 2 && row.distanceKm > 0));
  assert.ok(first.charges.every(row => row.curve.length >= 2 && row.energyKwh > 0));
  first.trips[0].points[0].latitude = 0;
  assert.notEqual(second.trips[0].points[0].latitude, 0);
});

test('真实配置验证及安全默认值', () => {
  assert.equal(readConfig({}).host, '127.0.0.1');
  assert.equal(readConfig({}).port, 8776);
  assert.equal(readConfig({}).upstream, '');
  assert.throws(() => readConfig({ TESLAMATE_API_URL: config.upstream }), /APP_ACCESS_TOKEN/);
  assert.throws(() => readConfig({ TESLAMATE_API_URL: `${config.upstream}/api/v1`, APP_ACCESS_TOKEN: token }), /根地址/);
  assert.throws(() => readConfig({ TESLAMATE_API_URL: 'https://user:password@host/', APP_ACCESS_TOKEN: token }), /根地址/);
  assert.throws(() => readConfig({ CAR_ID: '1.5' }), /CAR_ID/);
  assert.throws(() => readConfig({ UPSTREAM_AUTHORIZATION: 'Bearer secret\r\ninjected' }), /无效/);
  assert.equal(readConfig({ TESLAMATE_API_URL: `${config.upstream}/`, APP_ACCESS_TOKEN: token }).upstream, config.upstream);
});

test('真实模式沿实际上游schema转换单位，保留0/false和缺失值', async () => {
  const mock = upstream();
  const result = await loadSnapshot(config, mock.fetch, now);
  assert.equal(result.source, 'teslamate');
  assert.equal(result.vehicle.rangeKm, 16.09344);
  assert.equal(result.vehicle.odometerKm, 160.9344);
  assert.equal(result.vehicle.insideTempC, 20);
  assert.equal(result.vehicle.outsideTempC, 0);
  assert.ok(Math.abs(result.vehicle.tyres.fl - 3) < 1e-8);
  assert.equal(result.vehicle.tyres.fr, null);
  assert.equal(result.vehicle.batteryPct, 0);
  assert.equal(result.vehicle.locked, false);
  assert.equal(result.vehicle.sentry, null);
  assert.equal(result.vehicle.observedAt, null);
  assert.equal(result.vehicle.charging.remainingMin, 30);
  assert.equal(result.trips[0].distanceKm, 16.09344);
  assert.equal(result.trips[0].energyKwh, 2.5);
  assert.ok(Math.abs(result.trips[0].efficiencyWhKm - 155.3428) < 0.001);
  assert.deepEqual(result.trips[0].points, []);
  assert.equal(result.charges[0].cost, 0);
  assert.equal(result.charges[0].currency, '');
  assert.equal(result.charges[0].kind, 'unknown');
  assert.equal(result.charges[0].durationMin, null);
  assert.equal(mock.calls.length, 3);
  for (const call of mock.calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.ok(call.options.signal instanceof AbortSignal);
    assert.equal(call.options.headers.Authorization, config.authorization);
    if (/drives|charges/.test(call.url.pathname)) {
      assert.equal(call.url.searchParams.get('startDate'), '2026-09-21T10:00:00.000Z');
      assert.equal(call.url.searchParams.get('show'), '100');
    }
  }
  const withoutDriveUnits = upstream({ drives: { car: { car_id: 1 }, drives: [trip] } });
  assert.equal((await loadSnapshot(config, withoutDriveUnits.fetch, now)).trips[0].distanceKm, 16.09344);
});

test('门窗与空调沿实际字段映射，保留开关、缺失和非法值，不追加车辆请求', async () => {
  const mock = upstream({ status: { car: { car_id: 1 }, status: {
    car_status: { windows_open: false, driver_front_door_open: true, driver_rear_door_open: false,
      passenger_front_door_open: false, passenger_rear_door_open: true, trunk_open: false, frunk_open: true },
    climate_details: { is_climate_on: true, is_preconditioning: false }
  } } });
  const vehicle = (await loadSnapshot(config, mock.fetch, now)).vehicle;
  assert.deepEqual(vehicle.openings, { windows: false, driverFront: true, driverRear: false,
    passengerFront: false, passengerRear: true, trunk: false, frunk: true });
  assert.deepEqual(vehicle.climate, { on: true, preconditioning: false });
  assert.equal(mock.calls.length, 3);
  const absent = (await loadSnapshot(config, upstream().fetch, now)).vehicle;
  assert.ok(Object.values(absent.openings).every(value => value === null));
  assert.deepEqual(absent.climate, { on: null, preconditioning: null });
  const invalid = upstream({ status: { car: { car_id: 1 }, status: {
    car_status: { windows_open: 'false', driver_front_door_open: 0, trunk_open: null },
    climate_details: { is_climate_on: 'true', is_preconditioning: 1 }
  } } });
  const unknown = (await loadSnapshot(config, invalid.fetch, now)).vehicle;
  assert.ok(Object.values(unknown.openings).every(value => value === null));
  assert.deepEqual(unknown.climate, { on: null, preconditioning: null });
});

test('未知单位及缺失数值留空，上游空列表正常处理', async () => {
  const mock = upstream({ status: { car: { car_id: 1 }, status: { odometer: 300, climate_details: { inside_temp: 23 }, tpms_details: { tpms_pressure_fl: 3 } } },
    drives: { car: { car_id: 1 }, drives: null }, charges: { car: { car_id: 1 }, charges: null } });
  const result = await loadSnapshot(config, mock.fetch, now);
  assert.equal(result.vehicle.odometerKm, null);
  assert.equal(result.vehicle.insideTempC, null);
  assert.equal(result.vehicle.tyres.fl, null);
  assert.equal(result.vehicle.state, 'unknown');
  assert.deepEqual(result.trips, []);
  assert.deepEqual(result.charges, []);
  assert.ok(result.notices.some(note => note.includes('单位未知')));
});

test('位置优先显示地点名，没有名称时显示有效坐标，缺失坐标不冒充位置', async () => {
  const cases = [
    [{ geofence: ' 家 ', location: { latitude: 31.2, longitude: 121.5 } }, '家'],
    [{ geofence: ' ', location: { latitude: 31.2, longitude: 121.5 } }, '纬度 31.20000 · 经度 121.50000'],
    [{ location: { latitude: 0, longitude: 121.5 } }, '纬度 0.00000 · 经度 121.50000'],
    [{ location: { latitude: 31.2, longitude: 0 } }, '纬度 31.20000 · 经度 0.00000'],
    [{ latitude: -31.2, longitude: -121.5 }, '纬度 -31.20000 · 经度 -121.50000'],
    [{ location: { latitude: 0, longitude: 0 } }, null],
    [{ location: { latitude: null, longitude: 121.5 } }, null],
    [{ location: { latitude: '31.2', longitude: 121.5 } }, null],
    [{ location: { latitude: 91, longitude: 121.5 } }, null],
    [{ location: { latitude: 31.2, longitude: -181 } }, null],
    [{}, null],
    [null, null]
  ];
  for (const [car_geodata, expected] of cases) {
    const mock = upstream({ status: { car: { car_id: 1 }, status: { car_geodata } } });
    assert.equal((await loadSnapshot(config, mock.fetch, now)).vehicle.locationName, expected);
  }
});

test('启用街道地址后使用中文地址，地点名优先，解析失败也保留真实车况', async () => {
  let calls = 0;
  const geocode = async (latitude, longitude) => { calls++; assert.equal(latitude, 31.2); assert.equal(longitude, 121.5); return '上海市 浦东新区 世纪大道 附近'; };
  const makeStatus = geofence => upstream({ status: { car: { car_id: 1 }, status: { car_geodata: { geofence, location: { latitude: 31.2, longitude: 121.5 } } } } });
  const result = await loadSnapshot(config, makeStatus('').fetch, now, geocode);
  assert.equal(result.vehicle.locationName, '上海市 浦东新区 世纪大道 附近');
  assert.ok(result.notices.some(notice => notice.includes('OpenStreetMap')));
  assert.equal((await loadSnapshot(config, makeStatus('家').fetch, now, geocode)).vehicle.locationName, '家');
  assert.equal(calls, 1);
  const failed = await loadSnapshot(config, makeStatus('').fetch, now, async () => null);
  assert.equal(failed.source, 'teslamate');
  assert.equal(failed.vehicle.locationName, '位置已收到，地址暂未解析');
});

test('真实详情按需读取坐标与充电曲线，不制造缺失采样', async () => {
  const mock = upstream();
  const drive = await loadDetail(config, 'trips', 11, mock.fetch, now);
  assert.deepEqual(drive.points, [{ latitude: 31.2, longitude: 121.5 }]);
  const charging = await loadDetail(config, 'charges', 22, mock.fetch, now);
  assert.deepEqual(charging.curve, [{ minute: 5, powerKw: 120 }]);
  assert.equal(charging.kind, 'DC');
  assert.equal(mock.calls.length, 2);
  const missing = upstream({ '11': { car: { car_id: 1 }, drive: trip } });
  assert.deepEqual((await loadDetail(config, 'trips', 11, missing.fetch, now)).points, []);
  const stale = upstream({ '11': { car: { car_id: 1 }, drive: { ...trip, start_date: '2025-01-01T00:00:00Z' } } });
  await assert.rejects(loadDetail(config, 'trips', 11, stale.fetch, now), { status: 404 });
});

test('所有真实数据请求先鉴权，不提供写车接口', async () => {
  let calls = 0;
  const handler = createHandler(config, { fetch: async () => { calls++; throw new Error('should not call'); } });
  for (const url of ['/api/dashboard', '/api/trips/11', '/api/charges/22', '/api/trips/11/locations', '/api/trips/11/map']) {
    assert.equal((await request(handler, url)).status, 401);
    assert.equal((await request(handler, url, { authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await request(handler, url, { method: 'POST', authorization: `Bearer ${token}` })).status, 405);
  }
  assert.equal(calls, 0);
  assert.equal((await request(handler, '/api/command', { authorization: `Bearer ${token}` })).status, 404);
});

test('上游鉴权/网络/JSON/schema失败不泄露凭据且不回落演示', async () => {
  const cases = [
    async () => ({ ok: false, status: 401 }),
    async () => { throw new Error(`network ${config.authorization} ${token}`); },
    async () => ({ ok: true, json: async () => { throw new Error('invalid json'); } }),
    async () => ({ ok: true, json: async () => ({ data: {} }) })
  ];
  for (const fetch of cases) {
    const result = await request(createHandler(config, { fetch }), '/api/dashboard', { authorization: `Bearer ${token}` });
    assert.equal(result.status, 502);
    assert.ok(!result.body.includes(config.authorization));
    assert.ok(!result.body.includes(token));
    assert.ok(!result.body.includes('demo'));
  }
});

test('演示API与H5静态响应，以及路径穿越和符号链接防护', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tesla-pocket-test-'));
  try {
    const staticDir = path.join(root, 'h5');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(staticDir);
    await writeFile(path.join(staticDir, 'index.html'), '<h1>demo</h1>');
    await writeFile(path.join(root, 'private.txt'), 'secret');
    const isWindows = process.platform === 'win32';
    const outsideUrl = isWindows ? '/linked/private.txt' : '/linked.txt';
    if (isWindows) {
      await symlink(root, path.join(staticDir, 'linked'), 'junction');
    } else {
      await symlink(path.join(root, 'private.txt'), path.join(staticDir, 'linked.txt'));
    }
    const handler = createHandler({ upstream: '', staticDir });
    const demo = await request(handler, '/api/dashboard');
    assert.equal(demo.status, 200);
    assert.equal(JSON.parse(demo.body).source, 'demo');
    assert.equal(demo.headers['Cache-Control'], 'no-store');
    assert.equal((await request(handler, '/api/trips/1001')).status, 200);
    assert.equal((await request(handler, '/api/charges/2001')).status, 200);
    assert.equal((await request(handler, '/api/trips/99999')).status, 404);
    const page = await request(handler, '/');
    assert.equal(page.status, 200);
    assert.equal(String(page.body), '<h1>demo</h1>');
    assert.equal((await request(handler, '/', { method: 'HEAD' })).body, undefined);
    for (const url of ['/../private.txt', '/%2e%2e/private.txt', '/%5c..%5cprivate.txt', '/%00', '/%invalid']) {
      assert.equal((await request(handler, url)).status, 400);
    }
    assert.equal((await request(handler, outsideUrl)).status, 403);
    assert.equal((await request(handler, '/missing.js')).status, 404);
  } finally { await rm(root, { recursive: true, force: true }); }
});
