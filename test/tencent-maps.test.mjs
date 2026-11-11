import test from 'node:test';
import assert from 'node:assert/strict';
import { createTencentMaps, simplifyRoute } from '../server/tencent-maps.mjs';
import { readConfig } from '../server/config.mjs';
import { createHash } from 'node:crypto';

const key = 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF';
const secret = 's'.repeat(32);
const points = [{ latitude: 31.2, longitude: 121.5 }, { latitude: 31.3, longitude: 121.6 }, { latitude: 31.4, longitude: 121.7 }];
const trip = { id: 11, startedAt: '2026-10-20T00:00:00Z', from: '上海市', to: '家', points };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function mockProvider() {
  const calls = [];
  let previousRequestAt = 0;
  const fetcher = async (url, options) => {
    assert.ok(Date.now() - previousRequestAt >= 200, 'batch enrichment must avoid bursts that exhaust request-per-second quota');
    previousRequestAt = Date.now();
    calls.push(url);
    assert.equal(url.origin, 'https://apis.map.qq.com');
    assert.equal(url.searchParams.get('key'), key);
    const unsigned = new URLSearchParams(url.searchParams);
    unsigned.delete('sig');
    assert.equal(url.searchParams.get('sig'), createHash('md5').update(`${url.pathname}?${[...unsigned].map(([name, value]) => `${name}=${value}`).join('&')}${secret}`).digest('hex'));
    const names = [...unsigned.keys()];
    assert.deepEqual(names, [...names].sort());
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    if (url.pathname === '/ws/coord/v1/translate') {
      assert.equal(url.searchParams.get('type'), '1');
      assert.ok(url.searchParams.get('locations').length < 2048);
      return json({ status: 0, locations: url.searchParams.get('locations').split(';').map(coordinate => {
        const [lat, lng] = coordinate.split(',').map(Number);
        assert.ok(lat < 90 && lng > 90, 'latitude must precede longitude');
        return { lat: lat - 0.002, lng: lng + 0.004 };
      }) });
    }
    if (url.pathname === '/ws/geocoder/v1/') {
      assert.equal(url.searchParams.get('get_poi'), '1');
      return json({ status: 0, result: { address: '上海市浦东新区世纪大道1号', pois: [
        { title: '远处商场', _distance: 200 }, { title: '示例大厦', _distance: 30 }, { title: '错误坐标', _distance: null },
      ] } });
    }
    assert.equal(url.pathname, '/ws/staticmap/v2/');
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  };
  return { provider: createTencentMaps(key, secret, fetcher), calls };
}

test('轨迹简化保留真实端点、转弯与顺序，过滤非法坐标，限制转换请求大小', () => {
  const route = Array.from({ length: 1000 }, (_, i) => ({ latitude: 31, longitude: 121 + i / 10000 }));
  const corner = route.at(-1);
  route.push(...Array.from({ length: 1000 }, (_, i) => ({ latitude: 31 + i / 10000, longitude: corner.longitude })));
  const before = structuredClone(route);
  const result = simplifyRoute([...route, { latitude: 0, longitude: 0 }, { latitude: NaN, longitude: 120 }]);
  assert.ok(result.length <= 120);
  assert.equal(result[0], route[0]);
  assert.equal(result.at(-1), route.at(-1));
  assert.ok(result.some(point => point.longitude === corner.longitude && point.latitude === 31));
  assert.ok(result.every(point => route.includes(point)));
  assert.deepEqual(route, before);
  assert.deepEqual(simplifyRoute([]), []);
});

test('端点先转换 GPS 再解析腾讯地址，保留自定义名称，地址查询合并并缓存', async () => {
  const { provider, calls } = mockProvider();
  const [first, concurrent] = await Promise.all([provider.locations(trip), provider.locations(trip)]);
  assert.equal(first.from, '上海市浦东新区世纪大道1号 · 示例大厦附近');
  assert.equal(first.to, '家 · 上海市浦东新区世纪大道1号 · 示例大厦附近');
  assert.deepEqual(concurrent, first);
  assert.deepEqual(await provider.locations(trip), first);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].searchParams.get('location'), '31.198000,121.504000');
});

test('腾讯街道底图使用转换后的实际轨迹及起终点，不泄露密钥或替换为规划路线', async () => {
  const { provider, calls } = mockProvider();
  const first = await provider.map(trip);
  assert.ok(first.image.startsWith('data:image/png;base64,'));
  assert.equal(first.sampled, false);
  assert.equal(first.image.includes(key), false);
  const url = calls.at(-1);
  assert.equal(url.searchParams.get('markers'), 'size:mid|color:blue|31.198000,121.504000|31.398000,121.704000');
  assert.ok(url.searchParams.get('labels').includes('起点|31.198000,121.504000|终点|31.398000,121.704000'));
  assert.equal(url.searchParams.get('path'), 'color:0x168B7500|weight:5|31.198000,121.504000|31.298000,121.604000|31.398000,121.704000');
  assert.equal(url.searchParams.get('size'), '750*480');
  assert.equal(url.searchParams.has('center'), false);
  await provider.map(trip);
  assert.equal(calls.length, 2);
});

test('腾讯失败、异常坐标和非 PNG 响应不冒充地图，地址降级到上游原值且不泄密', async () => {
  for (const fetcher of [
    async () => { throw new Error(`network ${key}`); },
    async () => json({ status: 311, message: `key ${key}` }),
    async () => json({ status: 0, locations: [{ lat: null, lng: 120 }] }),
    async () => json({ status: 0, locations: [{ lat: 31, lng: 121 }, { lat: 32, lng: 122 }, { lat: 33, lng: 123 }] }),
  ]) {
    const provider = createTencentMaps(key, secret, fetcher);
    assert.deepEqual(await provider.locations(trip), { from: trip.from, to: trip.to });
    await assert.rejects(provider.map(trip), error => !error.message.includes(key));
  }
  await assert.rejects(createTencentMaps(key, secret).map({ ...trip, points: [] }), { status: 404 });
});

test('腾讯 Key 仅接受预期格式，未配置时保持原有功能', () => {
  assert.equal(readConfig({}).tencentMapKey, '');
  assert.equal(readConfig({ TENCENT_MAP_KEY: key, TENCENT_MAP_SECRET: secret }).tencentMapKey, key);
  assert.throws(() => readConfig({ TENCENT_MAP_KEY: key }), /TENCENT_MAP_SECRET/);
  for (const value of ['bad', `${key}\nother`, 'x'.repeat(32)]) assert.throws(() => readConfig({ TENCENT_MAP_KEY: value }), /TENCENT_MAP_KEY/);
});
