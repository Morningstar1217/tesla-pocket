import { test } from 'node:test'
import { tabForNativeIndex, updateNavigationScroll } from '../src/lib/navigation.ts'
import assert from 'node:assert/strict'
import { num, energyValue, duration, shortAddress, openingSummary } from '../src/lib/format.ts'
import { getSettings, saveSettings, resetSettings, fetchSnapshot, fetchTrip, fetchCharge } from '../src/lib/client.ts'

test('unknown metrics stay unknown and legitimate zero survives', () => {
  assert.equal(num(null), '--')
  assert.equal(num(0), '0')
  assert.equal(num(NaN), '--')
  assert.equal(duration(null), '--')
  assert.equal(duration(0), '0分钟')
  assert.equal(duration(125), '2小时5分')
})

test('能耗缺失显示待校准，保留真实零值和精度', () => {
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(energyValue(value), '待校准')
  assert.equal(energyValue(0), '0.0')
  assert.equal(energyValue(1.26), '1.3')
  assert.equal(energyValue(143.6, 0), '144')
})

test('HTTP live connections allow only exact loopback and private LAN roots', () => {
  let saved = null
  globalThis.uni = {
    getStorageSync: () => saved,
    setStorageSync: (_key, value) => { saved = value },
  }
  const token = 'a'.repeat(32)
  try {
    for (const baseUrl of ['http://localhost', 'http://localhost:8776/', 'http://127.0.0.1', 'http://127.0.0.1:8776', 'https://car.example.com/', 'http://192.168.197.125:8776', 'http://10.0.0.2:8776', 'http://172.16.0.2:8776', 'http://172.31.255.254:8776']) {
      saveSettings({ mode: 'live', baseUrl, token })
      assert.equal(getSettings().baseUrl, baseUrl.replace(/\/+$/, ''))
    }
    const previous = saved
    for (const baseUrl of [
      'http://car.example.com', 'http://8.8.8.8:8776', 'http://172.15.1.1', 'http://172.32.1.1', 'http://192.168.1.256', 'http://192.168.01.2', 'http://10.0.0.1.evil.example', 'http://10.0.0.1/api',
      'http://localhost.example.com', 'http://127.0.0.1.example.com',
      'http://127.1', 'http://2130706433', 'http://0x7f000001',
      'http://localhost:8776/api', 'http://127.0.0.1:8776?next=evil', 'http://localhost#evil',
      'http://localhost@evil.example.com', 'http://user:password@localhost:8776',
      'https://car.example.com/api', 'https://user:password@car.example.com',
    ]) {
      assert.throws(() => saveSettings({ mode: 'live', baseUrl, token }), /HTTPS/, baseUrl)
      assert.equal(saved, previous)
    }
  } finally {
    delete globalThis.uni
  }
})

test('offline demo and real connection never silently mix', async () => {
  let saved = null
  let requests = 0
  let response = {}
  globalThis.uni = {
    getStorageSync: () => saved,
    setStorageSync: (_key, value) => { saved = value },
    removeStorageSync: () => { saved = null },
    request: (options) => { requests++; options.success(response) },
  }
  assert.equal(getSettings().mode, 'demo')
  const demo = await fetchSnapshot()
  assert.equal(demo.source, 'demo')
  assert.ok(demo.trips.length >= 6)
  assert.ok(demo.charges.length >= 5)
  assert.equal((await fetchTrip(demo.trips[0].id)).id, demo.trips[0].id)
  assert.equal((await fetchCharge(demo.charges[0].id)).id, demo.charges[0].id)
  assert.equal(requests, 0)
  assert.throws(() => saveSettings({mode:'live',baseUrl:'https://car.example.com',token:'short'}), /32/)
  saveSettings({mode:'live',baseUrl:'https://car.example.com/',token:'a'.repeat(32)})
  assert.equal(getSettings().baseUrl, 'https://car.example.com')
  response = {statusCode:401,data:{}}
  await assert.rejects(fetchSnapshot(), /未授权/)
  response = {statusCode:200,data:demo}
  await assert.rejects(fetchSnapshot(), /演示数据/)
  response = {statusCode:200,data:{...demo,source:'teslamate'}}
  assert.equal((await fetchSnapshot()).source, 'teslamate')
  resetSettings()
  assert.equal(getSettings().mode, 'demo')
  delete globalThis.uni
})

test('收起门窗明细仍显示开启数量或未知，不将缺失状态当作全部关闭', () => {
  assert.equal(openingSummary([false, false]), '全部关闭')
  assert.equal(openingSummary([false, true, true]), '2处开启')
  assert.equal(openingSummary([true, null]), '1处开启')
  assert.equal(openingSummary([false, undefined]), '状态未知')
  assert.equal(openingSummary([]), '状态未知')
})


test('原生导航只接受范围内的整数页签，忽略无效桥接事件', () => {
  assert.deepEqual([0, 1, 2, 3].map(tabForNativeIndex), ['vehicle', 'charges', 'trips', 'settings'])
  for (const index of [-1, 4, 0.5, NaN, Infinity, '1', null, undefined, {}]) {
    assert.equal(tabForNativeIndex(index), null)
  }
})


test('悬浮导航跨过方向阈值才收放，惯性回弹与轻微反向滚动不重启动画', () => {
  let state = { anchorTop: 0, hidden: false }
  assert.equal(updateNavigationScroll(state, 10), state)
  assert.equal(updateNavigationScroll(state, 47), state)
  state = updateNavigationScroll(state, 60)
  assert.equal(state.hidden, true)
  state = updateNavigationScroll(state, 200)
  assert.equal(state.hidden, true)
  for (const top of [195, 183, 197, 170, 199, 160]) assert.equal(updateNavigationScroll(state, top), state)
  state = updateNavigationScroll(state, 150)
  assert.equal(state.hidden, false)
  state = updateNavigationScroll(state, 120)
  assert.equal(state.hidden, false)
  for (const top of [130, 145, 161]) assert.equal(updateNavigationScroll(state, top), state)
  state = updateNavigationScroll(state, 170)
  assert.equal(state.hidden, true)
  assert.deepEqual(updateNavigationScroll(state, -5), { anchorTop: 0, hidden: false })
  for (const value of [undefined, null, NaN, Infinity, '20']) assert.equal(updateNavigationScroll(state, value), state)
})


test('行程列表精简行政区和括号方位，保留自定义地点及未知地址', () => {
  const cases = [
    ['湖北省宜昌市西陵区唐家湾路 · 平湖馨苑(唐家湾路)', '平湖馨苑'],
    ['湖北省宜昌市西陵区西湖路 · 宜昌市西陵区唐家湾中小学(西湖路南50米)', '唐家湾中小学'],
    ['湖北省宜昌市夷陵区双河路 · 夷陵区土门馨苑(双河路北200米)', '土门馨苑'],
    ['湖北省宜昌市夷陵区 · 夷陵区龙泉镇转滩湾', '龙泉镇转滩湾'],
    ['湖北省宜昌市西陵区唐家湾路', '唐家湾路'],
    ['家 · 湖北省宜昌市西陵区唐家湾路 · 平湖馨苑', '家'],
    ['宜昌市', '宜昌市'], ['北京市朝阳区望京SOHO', '望京SOHO'],
    ['上海市浦东新区世纪大道100号', '世纪大道100号'],
    ['市民中心', '市民中心'], ['中关村科技园区', '中关村科技园区'],
    ['Tesla Supercharger', 'Tesla Supercharger'], ['  家  ', '家'],
    ['', ''], [null, ''], [undefined, ''],
  ]
  for (const [full, short] of cases) assert.equal(shortAddress(full), short, full)
})
