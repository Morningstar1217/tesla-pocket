import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function page() {
  const source = readFileSync(new URL('../src/pages/index/index.vue', import.meta.url), 'utf8')
  const functions = source.slice(source.indexOf('async function scrollToTop()'), source.indexOf('async function applySettings('))
  const state = { top: 960, requests: [], scrolls: [], fail: false }
  const ref = value => ({ value })
  const context = {
    detailSequence: 0, tab: ref('vehicle'), detailKind: ref(null), detailId: ref(null),
    selectedTrip: ref(null), selectedCharge: ref(null), snapshot: ref({ trips: [] }),
    editingCost: ref(false), costMessage: ref(''), costError: ref(''), detailLoading: ref(false), detailError: ref(''),
    nextTick: async () => {}, revealNavigation() {}, errorMessage: error => error.message,
    fetchTrip: async id => { if (state.fail) throw new Error('offline'); return { id, from: 'A', to: 'B' } },
    fetchCharge: async id => ({ id }),
    uni: {
      createSelectorQuery() {
        const query = { selectViewport: () => query, scrollOffset(callback) { state.requests.push(() => callback({ scrollTop: state.top })); return query }, exec() {} }
        return query
      },
      pageScrollTo(options) { state.top = options.scrollTop; state.scrolls.push(options.scrollTop) },
    },
  }
  vm.createContext(context)
  vm.runInContext(ts.transpile(functions, { target: ts.ScriptTarget.ES2022 }), context)
  return { context, state }
}

test('最近一程与充电列表详情回顶，返回恢复原位置', async () => {
  for (const [tab, kind] of [['vehicle', 'trip'], ['charges', 'charge']]) {
    const { context: c, state } = page()
    c.tab.value = tab
    const pending = c.openDetail(kind, 1)
    state.requests.shift()()
    await pending
    assert.equal(state.top, 0)
    state.top = 250
    await c.closeDetail()
    assert.equal(state.top, 960)
    assert.equal(c.tab.value, tab)
    c.switchTab('trips')
    await new Promise(setImmediate)
    assert.equal(state.top, 0)
  }
})

test('详情加载失败后重试不覆盖入口位置', async () => {
  const { context: c, state } = page()
  state.fail = true
  const pending = c.openDetail('trip', 1)
  state.requests.shift()()
  await pending
  assert.equal(c.detailError.value, 'offline')
  state.fail = false
  state.top = 120
  await c.openDetail('trip', 1)
  assert.equal(state.requests.length, 0)
  await c.closeDetail()
  assert.equal(state.top, 960)
})

test('捕获位置或返回期间切换页签，不让旧异步操作覆盖新页面', async () => {
  const { context: c, state } = page()
  const pending = c.openDetail('trip', 1)
  c.switchTab('charges')
  state.requests.shift()()
  await pending
  assert.equal(c.detailKind.value, null)
  assert.equal(c.tab.value, 'charges')
  const closing = c.closeDetail()
  c.switchTab('trips')
  await closing
  await new Promise(setImmediate)
  assert.equal(state.top, 0)
})
