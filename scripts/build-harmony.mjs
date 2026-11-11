import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createDemoSnapshot } from '../shared/demo.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const project = join(root, 'harmony')
const deveco = process.env.DEVECO_HOME || '/Applications/DevEco-Studio.app/Contents'
assert(existsSync(join(deveco, 'tools/hvigor/bin/hvigorw')), '请安装 DevEco Studio，或设置 DEVECO_HOME 为其 Contents 目录')
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const appPath = join(project, 'AppScope/app.json5')
const app = readJson(appPath)
assert.match(app.app.bundleName, /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/)
assert.equal(app.app.versionName, '2.0.0')
assert.equal(app.app.versionCode, 200)
const raw = join(project, 'entry/src/main/resources/rawfile')
mkdirSync(raw, { recursive: true })
writeFileSync(join(raw, 'demo.json'), JSON.stringify(createDemoSnapshot(new Date('2026-10-30T00:00:00Z'))))
for (const asset of ['model-y.png', 'vehicle-top.svg']) cpSync(join(root, 'src/static', asset), join(raw, asset))
// Generated mixed-app resources are obsolete; native pages must not ship a second WebView app.
rmSync(join(project, 'entry/src/main/resources/resfile/apps/HBuilder'), { recursive: true, force: true })
const env = {
  ...process.env,
  PATH: [join(deveco, 'tools/node/bin'), join(deveco, 'tools/ohpm/bin'), process.env.PATH].join(delimiter),
  JAVA_HOME: join(deveco, 'jbr'), DEVECO_SDK_HOME: join(deveco, 'sdk'),
}
for (const [tool, args] of [
  ['tools/ohpm/bin/ohpm', ['install']],
  ['tools/hvigor/bin/hvigorw', ['assembleHap', '--mode', 'module', '-p', 'product=default', '-p', 'buildMode=release', '--no-daemon']],
]) {
  const result = spawnSync(join(deveco, tool), args, { cwd: project, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
const hap = join(project, 'entry/build/default/outputs/default/entry-default-unsigned.hap')
assert(statSync(hap).size > 0, '未生成 HAP')
console.log(`未签名原生 HAP：${hap}\n使用包含目标手机的开发签名后再安装。`)
