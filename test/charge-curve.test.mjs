import { test } from 'node:test'
import assert from 'node:assert/strict'
import { powerAxisMaximum, powerHeight } from '../src/lib/charge-curve.ts'

test('功率轴覆盖真实峰值并适配直流、交流和小功率', () => {
  for (const [peak, maximum] of [[71, 80], [150, 200], [7.5, 8], [0.71, 0.8], [0, 1], [null, 1], [NaN, 1]]) {
    assert.equal(powerAxisMaximum(peak), maximum)
  }
})

test('采样柱与数值刻度使用同一比例，零值和无效值不产生非法高度', () => {
  assert.equal(powerHeight(40, 80), 50)
  assert.equal(powerHeight(71, 80), 88.75)
  assert.equal(powerHeight(0, 80), 0)
  assert.equal(powerHeight(100, 80), 100)
  for (const [value, maximum] of [[NaN, 80], [-1, 80], [5, 0], [5, Infinity]]) {
    assert.equal(powerHeight(value, maximum), 0)
  }
})
