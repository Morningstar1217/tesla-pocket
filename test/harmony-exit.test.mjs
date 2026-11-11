import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function nativeExit() {
  const source = readFileSync(new URL('../harmony/entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8')
    .split('  onBackPress(): boolean {')[1].split('\n  message(')[0].trim()
  const state = { now: 10000, exits: 0, messages: [], fail: false }
  const page = {
    firstBack: 0, detail: '', editingCost: false, closed: 0,
    closeDetail() { this.closed++ },
    getUIContext: () => ({
      getHostContext: () => ({ terminateSelf: () => { state.exits++; return state.fail ? Promise.reject(new Error()) : Promise.resolve() } }),
      getPromptAction: () => ({ showToast: options => state.messages.push(options.message) }),
    }),
  }
  const context = { Date: { now: () => state.now }, page }
  vm.createContext(context)
  vm.runInContext(ts.transpile(`function back() { ${source}`, { target: ts.ScriptTarget.ES2022 }), context)
  return { state, page, press: () => context.back.call(page) }
}

test('首次或超时返回只提示，二秒内再次返回交给系统结束 Ability', () => {
  const { state, press } = nativeExit()
  press()
  assert.equal(state.exits, 0)
  assert.deepEqual(state.messages, ['再按一次退出应用'])
  state.now += 2000
  press()
  assert.equal(state.exits, 0)
  state.now += 300
  press()
  assert.equal(state.exits, 1)
})

test('系统退出失败保留页面并允许重新确认', async () => {
  const { state, press } = nativeExit()
  state.fail = true
  press()
  press()
  await new Promise(setImmediate)
  assert.equal(state.messages.at(-1), '退出失败，请重试')
  state.fail = false
  press()
  assert.equal(state.exits, 1)
  press()
  assert.equal(state.exits, 2)
})

test('原生返回先关闭费用编辑和详情，不触发应用退出', () => {
  const { state, page, press } = nativeExit()
  page.editingCost = true
  page.detail = 'charge'
  assert.equal(press(), true)
  assert.equal(page.editingCost, false)
  assert.equal(page.closed, 0)
  press()
  assert.equal(page.closed, 1)
  assert.equal(state.exits, 0)
  assert.equal(state.messages.length, 0)
})

test('详情返回优先；鸿蒙首页消费默认退出，其他端保留原行为', () => {
  const source = readFileSync(new URL('../src/pages/index/index.vue', import.meta.url), 'utf8')
    .split('onBackPress(() => {')[1].split('\n})')[0]
  for (const harmony of [true, false]) {
    const body = source.replace(/\/\/ #ifdef APP-HARMONY([\s\S]*?)\/\/ #endif/g, (_, code) => harmony ? code : '')
      .replace(/\/\/ #ifndef APP-HARMONY([\s\S]*?)\/\/ #endif/g, (_, code) => harmony ? '' : code)
    const state = { closed: 0, exits: 0 }
    const context = { detailKind: { value: 'trip' }, closeDetail: () => state.closed++, uni: { requestChejiExit: () => state.exits++ } }
    vm.createContext(context)
    vm.runInContext(ts.transpile(`function back() { ${body} }`, { target: ts.ScriptTarget.ES2022 }), context)
    assert.equal(context.back(), true)
    assert.equal(state.closed, 1)
    assert.equal(state.exits, 0)
    context.detailKind.value = null
    assert.equal(context.back(), harmony)
    assert.equal(state.exits, harmony ? 1 : 0)
  }
})
