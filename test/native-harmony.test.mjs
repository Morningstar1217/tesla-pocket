import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createDemoSnapshot } from '../shared/demo.mjs'
import * as webCost from '../src/lib/charge-cost.ts'
import * as webFormat from '../src/lib/format.ts'

const nativeRoot = new URL('../harmony/entry/src/main/ets/', import.meta.url)
function compile(path, require = () => ({})) {
  const context = { exports: {}, require, console, Date, setTimeout }
  vm.createContext(context)
  vm.runInContext(ts.transpile(readFileSync(new URL(path, nativeRoot), 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), context)
  return context.exports
}
const model = compile('data/Model.ets')

test('原生数值与旧版一致，缺失值不变成零', () => {
  for (const value of [null, undefined, NaN, Infinity, 0, 1.256, -3]) {
    assert.equal(model.num(value, 1), webFormat.num(value, 1))
    assert.equal(model.energy(value), webFormat.energyValue(value))
    assert.equal(model.duration(value), webFormat.duration(value))
  }
  for (const address of ['湖北省宜昌市西陵区唐家湾路 · 平湖馨苑(唐家湾路)', '家 · 湖北省宜昌市', '市民中心', '']) assert.equal(model.shortAddress(address), webFormat.shortAddress(address))
})

test('原生费用精度、零元、未知电量和旧 scope 完全兼容', () => {
  const snapshot = createDemoSnapshot(new Date('2026-10-30T00:00:00Z'))
  for (const source of ['demo', 'teslamate']) {
    snapshot.source = source
    const settings = { mode: source === 'demo' ? 'demo' : 'live', baseUrl: 'https://car.example.com', token: '' }
    assert.equal(model.costScope(snapshot, settings), JSON.stringify([source, source === 'demo' ? '' : settings.baseUrl, snapshot.vehicle.id]))
  }
  const charge = snapshot.charges[0]
  assert.equal(model.costKey(charge), webCost.chargeCostKey(charge))
  for (const [value, mode] of [['0', 'total'], ['38.50', 'total'], ['1.2345', 'rate'], ['999999', 'total']]) {
    const entry = model.parseCost(value, mode)
    assert.equal(JSON.stringify(entry), JSON.stringify(webCost.parseChargeCost(value, mode)))
    for (const energyKwh of [null, 0, 24.6, -1, NaN]) assert.equal(model.effectiveCost({ ...charge, energyKwh }, entry), webCost.chargeCost({ ...charge, energyKwh }, entry))
  }
  for (const [value, mode] of [['', 'total'], ['-1', 'total'], ['1.001', 'total'], ['1.23456', 'rate'], ['1000000', 'total'], ['NaN', 'rate']]) assert.throws(() => model.parseCost(value, mode))
})

test('原生连接只允许 HTTPS 或精确的本机及私网 HTTP 根地址', () => {
  const token = 'x'.repeat(32)
  for (const baseUrl of ['https://car.example.com/', 'http://localhost:8776', 'http://127.0.0.1', 'http://192.168.1.2:8776', 'http://172.31.0.1', 'http://10.0.0.1']) assert.equal(model.validateSettings({ mode: 'live', baseUrl, token }).baseUrl, baseUrl.replace(/\/+$/, ''))
  for (const baseUrl of ['http://8.8.8.8', 'http://192.168.01.2', 'http://172.32.1.1', 'http://127.1', 'http://localhost.evil.com', 'https://a.com/api', 'https://user:pass@a.com', 'https://a.com?token=a']) assert.throws(() => model.validateSettings({ mode: 'live', baseUrl, token }))
  assert.throws(() => model.validateSettings({ mode: 'live', baseUrl: 'https://a.com', token: 'short' }))
})

test('原生过滤、轨迹、功率和数据契约边界', () => {
  assert.equal(model.inRange('2026-10-22T00:00:00Z', '2026-10-30T00:00:00Z', 7), false)
  assert.equal(model.inRange('2026-10-23T00:00:00Z', '2026-10-30T00:00:00Z', 7), true)
  assert.equal(model.sumKnown([null, NaN]), null)
  assert.equal(model.sumKnown([null, 0]), 0)
  assert.equal(model.powerMaximum(143), 200)
  assert.equal(model.peakIndex([{ minute: 0, powerKw: 1 }, { minute: 1, powerKw: 143 }, { minute: 2, powerKw: 10 }]), 1)
  assert.equal(model.validPoints([{ latitude: 0, longitude: 0 }, { latitude: 91, longitude: 1 }, { latitude: 31, longitude: 121 }]).length, 1)
  assert.equal(model.openingSummary([false, null]), '状态未知')
  assert.equal(model.openingSummary([true, null]), '1处开启')
  assert.throws(() => model.validateSnapshot(createDemoSnapshot(), true))
  assert.throws(() => model.validateTrip({ id: 1, startedAt: '', from: '', to: '', points: null }))
})

function repositoryHarness() {
  const values = new Map()
  let failFlush = false
  let response = { responseCode: 200, result: JSON.stringify({ ...createDemoSnapshot(), source: 'teslamate' }) }
  let lastRequest
  let destroyed = 0
  const store = {
    getSync: (key, fallback) => values.get(key) ?? fallback,
    putSync: (key, value) => values.set(key, value), deleteSync: key => values.delete(key),
    flush: async () => { if (failFlush) throw new Error('disk full') },
  }
  const native = compile('data/Repository.ets', name => {
    if (name === './Model') return model
    if (name === '@kit.ArkData') return { preferences: { getPreferencesSync: (_context, options) => { assert.equal(options.name, 'storage.HBuilder'); return store } } }
    if (name === '@kit.NetworkKit') return { http: { RequestMethod: { GET: 'GET' }, HttpDataType: { STRING: 'string' }, createHttp: () => ({
      request: async (url, options) => { lastRequest = { url, options }; return response }, destroy: () => destroyed++,
    }) } }
    return {}
  })
  const repository = new native.Repository({})
  return { repository, values, setFail: value => { failFlush = value }, setResponse: value => { response = value }, request: () => lastRequest, destroyed: () => destroyed }
}

test('直接读写已安装版 Preferences 格式，清连接保留所有费用', async () => {
  const h = repositoryHarness()
  const settings = { mode: 'live', baseUrl: 'https://car.example.com', token: 'x'.repeat(32) }
  h.values.set(model.CONNECTION_KEY, JSON.stringify({ type: 'object', data: settings }))
  const scope = '["teslamate","https://car.example.com",1]'
  const key = '23:2026-10-30T00:00:00Z'
  h.values.set(model.COST_PREFIX + scope, JSON.stringify({ type: 'object', data: { [key]: { mode: 'total', value: 0 } } }))
  assert.equal(JSON.stringify(h.repository.settings()), JSON.stringify(settings))
  assert.equal(h.repository.costs(scope)[key].value, 0)
  await h.repository.saveCosts(scope, { [key]: { mode: 'rate', value: 1.2345 } })
  assert.equal(JSON.parse(h.values.get(model.COST_PREFIX + scope)).data[key].value, 1.2345)
  await h.repository.resetConnection()
  assert.equal(h.repository.settings().mode, 'demo')
  assert.equal(h.repository.costs(scope)[key].value, 1.2345)
})

test('存储读取或落盘失败不覆盖既有数据', async () => {
  const h = repositoryHarness()
  h.values.set(model.CONNECTION_KEY, '{broken')
  assert.throws(() => h.repository.settings(), /未覆盖/)
  assert.equal(h.values.get(model.CONNECTION_KEY), '{broken')
  h.values.set(model.COST_PREFIX + 'scope', '{broken')
  assert.throws(() => h.repository.costs('scope'))
  h.setFail(true)
  await assert.rejects(h.repository.saveCosts('scope', {}), /保存失败/)
  assert.equal(h.values.get(model.COST_PREFIX + 'scope'), '{broken')
})

test('原生 HTTP 保留鉴权、只读请求和错误语义，拒绝携令牌重定向', async () => {
  const h = repositoryHarness()
  const settings = { mode: 'live', baseUrl: 'https://car.example.com', token: 'x'.repeat(32) }
  assert.equal((await h.repository.snapshot(settings)).source, 'teslamate')
  assert.equal(h.request().url, 'https://car.example.com/api/dashboard')
  assert.equal(h.request().options.method, 'GET')
  assert.equal(h.request().options.header.Authorization, `Bearer ${settings.token}`)
  assert.equal(h.request().options.maxRedirects, 0)
  assert.equal(h.destroyed(), 1)
  for (const code of [401, 403]) {
    h.setResponse({ responseCode: code, result: '{}' })
    await assert.rejects(h.repository.snapshot(settings), /未授权/)
  }
  h.setResponse({ responseCode: 500, result: '{}' })
  await assert.rejects(h.repository.snapshot(settings), /服务暂不可用/)
  h.setResponse({ responseCode: 200, result: JSON.stringify(createDemoSnapshot()) })
  await assert.rejects(h.repository.snapshot(settings), /数据来源不正确/)
})

function controllerMethods(methodNames) {
  const source = readFileSync(new URL('pages/Index.ets', nativeRoot), 'utf8')
  const methods = methodNames.map(name => {
    const start = source.search(new RegExp(`^  (?:async )?${name}\\(`, 'm'))
    assert.ok(start >= 0, name)
    const end = source.indexOf('\n  }', start) + 4
    return source.slice(start, end)
  }).join('\n')
  const context = { exports: {}, Date, console, setTimeout }
  vm.createContext(context)
  vm.runInContext(ts.transpile(`class Controller { ${methods} } exports.Controller = Controller`, { target: ts.ScriptTarget.ES2022 }), context)
  return new context.exports.Controller()
}
function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

test('原生刷新忽略过期响应，连接读取失败时不自动降级演示', async () => {
  const page = controllerMethods(['refresh'])
  const first = deferred(), second = deferred()
  let calls = 0
  Object.assign(page, { loadSequence: 0, connectionSequence: 0, connectionReady: true, located: new Set(),
    settings: { mode: 'live' }, repository: { snapshot: () => [first.promise, second.promise][calls++], costs: () => ({}) },
    scope: () => 'scope', enrichLocations: () => {}, message: e => e.message,
  })
  const old = page.refresh(), current = page.refresh()
  const currentSnapshot = { vehicle: { id: 2 } }
  second.resolve(currentSnapshot)
  assert.equal(await current, true)
  first.resolve({ vehicle: { id: 1 } })
  assert.equal(await old, false)
  assert.equal(page.snapshot, currentSnapshot)
  assert.equal(page.loading, false)
  page.connectionReady = false
  assert.equal(await page.refresh(), false)
  assert.equal(calls, 2)
  assert.equal(page.snapshot, currentSnapshot)
})

test('原生中文地址最多两个并发，切换连接后旧响应不写回', async () => {
  const page = controllerMethods(['enrichLocations', 'runLocations'])
  const snapshot = { ...createDemoSnapshot(), source: 'teslamate' }
  let active = 0, maximum = 0
  const pending = []
  Object.assign(page, { tab: 2, connectionSequence: 0, loadSequence: 1, locationWorkers: 0, located: new Set(), snapshot,
    settings: { mode: 'live' }, locationQueue: [], repository: { locations: async () => {
      active++; maximum = Math.max(maximum, active)
      const job = deferred(); pending.push(job)
      try { return await job.promise } finally { active-- }
    } },
  })
  page.enrichLocations(snapshot, 0)
  assert.equal(active, 2)
  page.enrichLocations(snapshot, 0)
  assert.equal(active, 2)
  const original = snapshot.trips[0].from
  page.connectionSequence++
  pending.splice(0).forEach(job => job.resolve({ from: '过期地址', to: '过期终点' }))
  await new Promise(setImmediate)
  assert.equal(maximum, 2)
  assert.equal(page.locationWorkers, 0)
  assert.equal(snapshot.trips[0].from, original)
})
