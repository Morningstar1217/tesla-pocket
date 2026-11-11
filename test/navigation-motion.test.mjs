import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { updateNavigationScroll } from '../src/lib/navigation.ts'

test('切页布局和旧惯性不收起导航，新手势仍能收放且卸载清理监听', () => {
  const source = readFileSync(new URL('../src/components/HarmonyMotion.vue', import.meta.url), 'utf8')
    .match(/<script module="harmonyMotion" lang="renderjs">([\s\S]*?)<\/script>/)[1]
    .replace(/import .* from .*\n/, '').replace('export default', 'globalThis.motion =')
  const listeners = new Map(), frames = new Map(), calls = []
  let id = 0
  const context = {
    updateNavigationScroll,
    window: {
      scrollY: 0,
      addEventListener(name, handler, options) { assert.equal(options.passive, true); listeners.set(name, handler) },
      removeEventListener(name, handler) { assert.equal(listeners.get(name), handler); listeners.delete(name) },
    },
    requestAnimationFrame(callback) { frames.set(++id, callback); return id },
    cancelAnimationFrame(key) { frames.delete(key) },
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  const motion = context.motion
  const instance = { ...motion.methods, $ownerInstance: { callMethod(name, hidden) { calls.push([name, hidden]) } } }
  motion.mounted.call(instance)
  function flush() { for (const [key, callback] of frames) { frames.delete(key); callback() } }
  function scroll(top) { context.window.scrollY = top; listeners.get('scroll')(); flush() }
  scroll(400)
  assert.deepEqual(calls, [])
  listeners.get('touchmove')()
  scroll(460)
  scroll(900)
  scroll(840)
  assert.deepEqual(calls, [['onVisibility', true], ['onVisibility', false]])
  context.window.scrollY = 1000
  listeners.get('scroll')()
  assert.equal(frames.size, 1)
  instance.reset()
  assert.equal(frames.size, 0)
  for (const top of [500, 0, 120, 300, 0]) scroll(top)
  assert.equal(calls.length, 2)
  listeners.get('wheel')()
  scroll(60)
  assert.deepEqual(calls.at(-1), ['onVisibility', true])
  listeners.get('scroll')()
  motion.beforeUnmount.call(instance)
  assert.equal(frames.size, 0)
  assert.equal(listeners.size, 0)
})
