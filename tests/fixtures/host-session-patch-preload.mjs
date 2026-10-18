// Native Session tests need the same host surface relaxation Tavern installs
// at runtime: assistant/message replacements may cite shadowed nodes. Without it,
// real Session.append rejects Tavern rollback/edit tombstones.
// The dedicated installer test verifies unpatched rejection itself, so skip there.
// 0.2.0-rc.2 适配：不再写死 0.1.5-rc.2，跟随 host-session-patch.js 的
// SESSION_PATCH_VERSION，这样重钉版本后这里不会静默跳过（表面放宽没装上，
// 用真实 Session 的用例会以难以定位的方式失败）。
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { prepareExpandedPatch, SESSION_PATCH_VERSIONS } from '../../tavern-plugin/lib/domain/host-session-patch.js'

const APPLIED = Symbol.for('dsh-tavern.host-session-patch-preload.v1')

if (!globalThis[APPLIED] && !process.argv.some(arg => arg.endsWith('/host-session-patch.test.mjs'))) {
  let runtimeRoot
  let version
  if (process.env.DSH_BOOT_MODULE) {
    const anchor = new URL('../../dsh-session/package.json', pathToFileURL(process.env.DSH_BOOT_MODULE))
    const require = createRequire(anchor)
    version = require('@deepseek-ai/dsh-session/package.json').version
    runtimeRoot = new URL('../../../', anchor).pathname
  } else {
    const pluginRequire = createRequire(new URL('../../tavern-plugin/package.json', import.meta.url))
    const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
    version = hostRequire('@deepseek-ai/dsh-session/package.json').version
    const sessionPath = hostRequire.resolve('@deepseek-ai/dsh-session')
    runtimeRoot = sessionPath.split(/[/\\]node_modules[/\\]/)[0]
  }
  if (SESSION_PATCH_VERSIONS.includes(version)) {
    await prepareExpandedPatch(runtimeRoot, { version })
    globalThis[APPLIED] = true
  }
}
