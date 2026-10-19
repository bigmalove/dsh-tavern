import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { TAVERN_COMPATIBILITY_CAPABILITIES } from '../../tavern-plugin/lib/domain/tavern-compatibility-diagnostics.js'
import { clientModuleStub } from './client-module-stub.mjs'

let descriptor
vm.runInNewContext(await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
})
// 客户端在模块求值期就会定义 React 类组件（顶栏错误边界等），桩不能只是空对象：
// 类字段需要 Component，其余宿主模块在加载期只被解构，给个惰性函数即可。
const moduleStub = new Proxy({}, {
  get: (target, key) => key === 'Component' || key === 'PureComponent'
    ? class {}
    : () => null
})
export const helperClient = descriptor.factory(() => moduleStub)

export function helperHostHarness(context = {}, options = {}) {
  const scripts = options.scripts || [{ id: 'a', content: '' }, { id: 'b', content: '' }]
  const html = helperClient.buildTavernHelperScriptDocument({ token: 'host-test', scripts, context: { compatibilityCapabilities: TAVERN_COMPATIBILITY_CAPABILITIES, ...context } })
  let source = html.match(/<script data-dsh-tavern-helper-script>([\s\S]*?)<\/script>/)[1]
  const downloads = [
    'import(new URL("/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs",document.baseURI).href)',
    'import(new URL("/api/dsh-tavern/vendor/runtime-assets/yaml/index.mjs",document.baseURI).href)'
  ]
  for (const download of downloads) {
    assert(source.includes(download))
    // The host implementation is real; only packaged module loading is stubbed.
    source = source.replace(download, 'Promise.resolve({})')
  }
  const sent = [], listeners = new Map()
  const parent = { postMessage(message) { sent.push(message); options.onCall?.(message) } }
  const window = { parent, structuredClone, setTimeout, clearTimeout, localStorage: {},
    console: { info() {}, warn() {}, error() {} },
    addEventListener(name, listener) { listeners.set(name, listener) },
    _: {
      mergeWith(...args) { return Object.assign({}, ...args.slice(0, -1)) },
      unset(target, path) { return delete target[String(path)] }
    }
  }
  window.jQuery = options.jQuery
  window.XMLHttpRequest = options.XMLHttpRequest
  window.fetch = options.fetch
  window.location = { href: "http://localhost/" }
  window.URL = URL
  window.document = { baseURI: 'http://localhost/' }
  window.window = window
  vm.runInNewContext(source, window)
  function receive(data) { listeners.get('message')({ source: parent, data: { token: 'host-test', ...data } }) }
  return { window, sent, receive,
    reply(call, result, ok = true) { receive({ type: 'dsh-tavern-helper-response', requestId: call.requestId, ok, result, error: ok ? undefined : result }) },
    calls() { return sent.filter(message => message.type === 'dsh-tavern-helper-call') }
  }
}
