import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { updateWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function WorldBookEditor(props)')
const end = source.indexOf('function WorldBookLibraryTab(props)', start)

const entry = { ref: 'entry:8', comment: '视频9:16', title: '视频9:16', content: '正文', enabled: true, constant: true, primaryKeys: [], secondaryKeys: [], selective: false, selectiveLogic: 0, order: 100, displayIndex: 8, position: 0, depth: 4, role: 0, probabilityEnabled: true, probability: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null, excludeRecursion: false, preventRecursion: false, group: '', groupOverride: false, groupWeight: 100, useGroupScoring: null, delayUntilRecursion: 0 }
const view = { displayName: '常用设置', description: '', entries: [entry], diagnostics: [] }

function render({ fail = false, constant = true } = {}) {
  const calls = [], saved = [], errors = []
  const item = Object.assign({}, entry, { constant })
  const Panel = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', {
    React: {
      useState: initial => { const value = typeof initial === 'function' ? initial() : initial; const isSet = value && typeof value.has === 'function' && typeof value.add === 'function'; return [isSet ? new Set(['entry:8']) : value, () => {}] },
      useRef: value => ({ current: value }),
      useEffect() {},
      useDeferredValue: value => value,
      createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }),
    },
    useTavernConfirm: () => async () => true,
    usePersistentError: () => ['', value => { errors.push(value) }],
    groupWorldBookEditorEntries: entries => ({ constant: entries.map((item, index) => ({ entry: item, index })), dynamic: [] }),
    rpc: async (...args) => { calls.push(args); if (fail) throw Error('写入失败'); return { view: Object.assign({}, view, { entries: [Object.assign({}, item, args[1].update.operations[0].patch)] }) } },
    notifyTavernDataChanged() {},
  })
  const tree = Panel({
    record: { source: { kind: 'standalone', path: 'worldbooks/常用设置.json' }, view: Object.assign({}, view, { entries: [item] }) },
    sessionId: 'session', onBack() {}, onSaved: result => saved.push(result), onDirty() {}, actions: null, bindingPanel: null,
  })
  function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(nodes)] }
  return { tree, nodes: nodes(tree), calls, saved, errors }
}

test('条目“启用”开关即时落盘，不依赖底部保存按钮', async () => {
  const { nodes, calls, saved } = render()
  const toggle = nodes.find(node => node.tag === 'input' && node.props.type === 'checkbox' && node.props.checked === true)
  assert.ok(toggle, '应渲染启用开关')
  toggle.props.onChange({ target: { checked: false } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'updateWorldBook')
  assert.equal(calls[0][1].source.path, 'worldbooks/常用设置.json')
  assert.equal(JSON.stringify(calls[0][1].update.operations), JSON.stringify([{ op: 'update', ref: 'entry:8', patch: { enabled: false } }]))
  assert.equal(saved.length, 1)
})

test('“常驻”开关即时落盘', async () => {
  const { nodes, calls } = render({ constant: true })
  const kind = nodes.find(node => node.tag === 'button' && node.children.includes('常驻'))
  assert.ok(kind, '应渲染常驻按钮')
  kind.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 1)
  assert.equal(JSON.stringify(calls[0][1].update.operations), JSON.stringify([{ op: 'update', ref: 'entry:8', patch: { constant: false } }]))
  assert.equal(calls[0][1].update.operations[0].patch.constant, false)
})

test('即时写入失败时回滚开关并提示错误', async () => {
  const { nodes, errors, saved } = render({ fail: true })
  const toggle = nodes.find(node => node.tag === 'input' && node.props.type === 'checkbox' && node.props.checked === true)
  toggle.props.onChange({ target: { checked: false } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(errors[errors.length - 1], '写入失败')
  assert.equal(saved.length, 0)
})

test('服务端把启用开关写成 SillyTavern 的 disable 字段', () => {
  const document = { entries: { 8: { uid: 8, comment: '视频9:16', content: '', disable: false, constant: true } } }
  const result = updateWorldBookDocument(document, { operations: [{ op: 'update', ref: 'entry:8', patch: { enabled: false } }] })
  assert.equal(result.document.entries[8].disable, true)
  assert.equal(result.view.entries[0].enabled, false)
})

test('内置格式保留 enabled 字段', () => {
  const document = { entries: [{ id: 0, comment: '条目', content: '', enabled: true, constant: true }] }
  const result = updateWorldBookDocument(document, { operations: [{ op: 'update', ref: 'entry:0', patch: { enabled: false } }] })
  assert.equal(result.document.entries[0].enabled, false)
  assert.equal(result.view.entries[0].enabled, false)
})
