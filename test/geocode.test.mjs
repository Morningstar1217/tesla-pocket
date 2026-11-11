import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeocoder } from '../server/geocode.mjs';
import { readConfig } from '../server/config.mjs';

const response = { ok: true, json: async () => ({ features: [{ properties: {
  state: '上海市', city: '上海市', district: '浦东新区', street: '世纪大道', housenumber: '1号', name: '示例大厦'
} }] }) };

test('街道解析格式、缓存及并发去重，不向地址服务发送应用凭据', async () => {
  let calls = 0;
  const geocode = createGeocoder('https://photon.example', async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://photon.example');
    assert.equal(url.pathname, '/reverse');
    assert.equal(url.searchParams.get('lat'), '31.2');
    assert.equal(url.searchParams.get('lon'), '121.5');
    assert.equal(url.searchParams.get('radius'), '0.2');
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(options.headers['User-Agent'].includes('TeslaPocket'));
    assert.equal(options.headers.Authorization, undefined);
    return response;
  });
  const [first, concurrent] = await Promise.all([geocode(31.2, 121.5), geocode(31.2, 121.5)]);
  assert.equal(first, '上海市 浦东新区 世纪大道 1号 示例大厦 附近');
  assert.equal(concurrent, first);
  assert.equal(await geocode(31.2, 121.5), first);
  assert.equal(calls, 1);
});

test('缓存过期重新解析，不把旧地点地址用于新位置，调用节流', async () => {
  let time = 1000, calls = 0;
  const geocode = createGeocoder('https://photon.example', async () => { calls++; return response; }, () => time);
  await geocode(31.2, 121.5);
  assert.equal(await geocode(32.2, 121.5), null);
  assert.equal(calls, 1);
  time += 10001;
  assert.ok(await geocode(32.2, 121.5));
  assert.equal(calls, 2);
  time += 86400001;
  assert.ok(await geocode(31.2, 121.5));
  assert.equal(calls, 3);
});

test('地址服务错误、空结果、异常格式均降级并短暂缓存，不影响车辆数据', async () => {
  for (const fetch of [
    async () => { throw new Error('network'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } }),
    async () => ({ ok: true, json: async () => ({ features: [] }) }),
    async () => ({ ok: true, json: async () => ({ features: [{ properties: { street: 1 } }] }) })
  ]) {
    let calls = 0, time = 1000;
    const geocode = createGeocoder('https://photon.example', (...args) => { calls++; return fetch(...args); }, () => time);
    assert.equal(await geocode(31.2, 121.5), null);
    assert.equal(await geocode(31.2, 121.5), null);
    assert.equal(calls, 1);
    time += 60001;
    assert.equal(await geocode(31.2, 121.5), null);
    assert.equal(calls, 2);
  }
});

test('无效坐标不触发外部请求；地址服务配置只允许 HTTPS 根地址', async () => {
  const geocode = createGeocoder('https://photon.example', async () => { assert.fail('unexpected network'); });
  for (const point of [[0, 0], [91, 1], [1, 181], [null, 1], ['1', 2], [NaN, 1], [1, Infinity]]) {
    assert.equal(await geocode(...point), null);
  }
  assert.equal(readConfig({}).geocoderUrl, '');
  assert.equal(readConfig({ GEOCODER_URL: 'https://photon.example' }).geocoderUrl, 'https://photon.example');
  for (const url of ['http://photon.example', 'https://user:pass@photon.example', 'https://photon.example/api', 'https://photon.example?a=1', 'invalid']) {
    assert.throws(() => readConfig({ GEOCODER_URL: url }), /GEOCODER_URL/);
  }
});
