import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chargeCost, chargeCostKey, parseChargeCost, loadChargeCosts, saveChargeCosts } from '../src/lib/charge-cost.ts'

test('手填费用和单价保留零，拒绝空值、负数及超出精度的输入', () => {
  assert.deepEqual(parseChargeCost(' 38.50 ', 'total'), { mode: 'total', value: 38.5 })
  assert.deepEqual(parseChargeCost('0', 'rate'), { mode: 'rate', value: 0 })
  assert.equal(parseChargeCost('1.2345', 'rate').value, 1.2345)
  for (const value of ['', ' ', '-1', 'NaN', 'Infinity', '1e2', '1.234', '1000000']) {
    assert.throws(() => parseChargeCost(value, 'total'))
  }
  assert.throws(() => parseChargeCost('1.23456', 'rate'))
})

test('单价按充入电量计算并四舍五入到分，缺失电量不冒充零', () => {
  const charge = { cost: 0, energyKwh: 34.6 }
  assert.equal(chargeCost(charge), 0)
  assert.equal(chargeCost(charge, { mode: 'total', value: 38.5 }), 38.5)
  assert.equal(chargeCost(charge, { mode: 'rate', value: 1.2 }), 41.52)
  assert.equal(chargeCost({ cost: null, energyKwh: 1.005 }, { mode: 'rate', value: 1 }), 1.01)
  assert.equal(chargeCost({ cost: null, energyKwh: null }, { mode: 'rate', value: 1.2 }), null)
  assert.equal(chargeCost({ cost: null, energyKwh: 0 }, { mode: 'rate', value: 1.2 }), 0)
  assert.equal(chargeCost({ cost: null, energyKwh: null }), null)
})

test('本地费用跨加载保留，按连接/车辆隔离并支持删除覆盖值', () => {
  const storage = new Map()
  globalThis.uni = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
  }
  try {
    const key = chargeCostKey({ id: 22, startedAt: '2026-10-30T09:35:00Z' })
    const entries = { [key]: { mode: 'rate', value: 1.2 } }
    saveChargeCosts('live:car-1', entries)
    assert.deepEqual(loadChargeCosts('live:car-1'), entries)
    assert.deepEqual(loadChargeCosts('demo:car-1'), {})
    assert.deepEqual(loadChargeCosts('live:car-2'), {})
    assert.notEqual(key, chargeCostKey({ id: 22, startedAt: '2026-10-31T09:35:00Z' }))
    saveChargeCosts('live:car-1', {})
    assert.deepEqual(loadChargeCosts('live:car-1'), {})
    saveChargeCosts('bad', { negative: { mode: 'total', value: -1 }, invalid: { mode: 'rate', value: null } })
    assert.deepEqual(loadChargeCosts('bad'), {})
    globalThis.uni.setStorageSync = () => { throw new Error('storage full') }
    assert.throws(() => saveChargeCosts('live:car-1', entries), /费用保存失败/)
  } finally { delete globalThis.uni }
})
