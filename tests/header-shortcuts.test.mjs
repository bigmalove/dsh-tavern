import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { DEFAULT_HEADER_ITEMS, applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

test('顶栏默认值与改动前一致：酒馆状态、导出，图标加文字', () => {
  assert.deepEqual({ display: DEFAULT_HEADER_ITEMS.display, items: [...DEFAULT_HEADER_ITEMS.items] }, { display: 'icon-text', items: ['dsh-tavern:status', 'header:export'] })
  assert.deepEqual(presentTavernSettings({}, {}).headerItems, { display: 'icon-text', items: ['dsh-tavern:status', 'header:export'] })
})

test('顶栏设置去重并按上限截断', () => {
  const saved = applyTavernSettingsPatch({}, { headerItems: { display: 'icon', items: ['dsh-tavern:cards', 'dsh-tavern:cards', 'header:export'] } })
  assert.deepEqual(saved.headerItems, { display: 'icon', items: ['dsh-tavern:cards', 'header:export'] })
  assert.deepEqual(presentTavernSettings(saved, {}).headerItems, { display: 'icon', items: ['dsh-tavern:cards', 'header:export'] })

  const many = Array.from({ length: 30 }, (_, index) => 'dsh-tavern:page-' + index)
  const capped = applyTavernSettingsPatch({}, { headerItems: { display: 'icon-text', items: many } })
  assert.equal(capped.headerItems.items.length, 24)
  assert.deepEqual(capped.headerItems.items.slice(0, 2), ['dsh-tavern:page-0', 'dsh-tavern:page-1'])
})

test('非法顶栏设置被拒绝', () => {
  for (const bad of [
    { display: 'large', items: [] },
    { display: 'icon', items: 'dsh-tavern:status' },
    { display: 'icon', items: ['dsh-tavern:status', 'bad id'] },
    { display: 'icon', items: [1] },
    { display: 'icon', items: [null] },
    []
  ]) assert.throws(() => applyTavernSettingsPatch({}, { headerItems: bad }), /无效的顶栏设置/)
  assert.throws(() => applyTavernSettingsPatch({}, { headerItems: { items: [{ id: 'dsh-tavern:status' }] } }), /无效的顶栏设置/)
})

test('传 null 恢复默认顶栏', () => {
  let document = applyTavernSettingsPatch({}, { headerItems: { display: 'icon', items: ['dsh-tavern:cards'] } })
  assert.deepEqual(document.headerItems, { display: 'icon', items: ['dsh-tavern:cards'] })
  document = applyTavernSettingsPatch(document, { headerItems: null })
  assert.equal(Object.hasOwn(document, 'headerItems'), false)
  assert.deepEqual(presentTavernSettings(document, {}).headerItems, { display: 'icon-text', items: ['dsh-tavern:status', 'header:export'] })
  // 存档里损坏的值不会让读取失败。
  assert.deepEqual(presentTavernSettings({ headerItems: { display: 'nope', items: ['bad id'] } }, {}).headerItems, { display: 'icon-text', items: ['dsh-tavern:status', 'header:export'] })
})

test('getDisplayPreferences 一并返回顶栏设置', async () => {
  const line = server.split('\n').find(source => source.includes("case 'getDisplayPreferences':"))
  const body = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'))
  const run = new Function('readTavernSettings', 'return async () => {' + body + '}')
  const preferences = await run(async () => ({ hideContextAndReasoning: false, renderDepth: 5, headerItems: { display: 'icon', items: ['header:export'] } }))()
  assert.deepEqual(preferences, { hideContextAndReasoning: false, renderDepth: 5, headerItems: { display: 'icon', items: ['header:export'] } })
})

test('客户端顶栏默认值与服务端一致，设置在首次读取前就用默认值', async () => {
  const declaration = client.match(/const TAVERN_HEADER_DEFAULT = (.*?);\n/)[1]
  const value = vm.runInNewContext('(' + declaration + ')', { Object })
  assert.deepEqual({ display: value.display, items: [...value.items] }, { display: DEFAULT_HEADER_ITEMS.display, items: [...DEFAULT_HEADER_ITEMS.items] })
  assert.match(client, /function useTavernHeaderItems\(\)[\s\S]*?TAVERN_HEADER_DEFAULT/)

  const dom = new JSDOM('<html><body></body></html>')
  const source = client.match(/const displayPreferences = \(\(\) => \{[\s\S]*?\}\)\(\);/)[0].replace('const displayPreferences = ', '')
  const store = vm.runInNewContext(source, {
    document: dom.window.document,
    window: dom.window,
    rpc: async () => ({ hideContextAndReasoning: true, headerItems: { display: 'icon', items: ['dsh-tavern:cards'] } })
  })
  assert.equal(store.snapshot(), null, '第一次读取前没有快照，顶栏回落到默认值')
  const stop = store.start()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(JSON.parse(JSON.stringify(store.snapshot().headerItems)), { display: 'icon', items: ['dsh-tavern:cards'] })
  stop()
  dom.window.close()
})

test('顶栏落成一个插槽，旧的两个插槽已移除', () => {
  assert.match(client, /id: "dsh-tavern-header-items", order: 80/)
  assert.doesNotMatch(client, /id: "dsh-tavern-conversation-settings", order: 80/)
  assert.doesNotMatch(client, /id: "dsh-tavern-conversation-export", order: 90/)
  assert.match(client, /tavernHeaderCatalog/)
  assert.match(client, /function tavernStartIcon\(/)
  assert.match(client, /function tavernStartGroups\(/)
})

test('默认对小白无感：开始页没有图钉，「⋯」只在有按钮收起时出现，配置放在高级里', () => {
  assert.doesNotMatch(client, /dsh-tavern-start-pin/)
  assert.doesNotMatch(client, /dsh-tavern-header-divider/)
  assert.match(client, /foldedEntries\.length \? h\("div", \{ className: "dsh-tavern-more-actions dsh-tavern-header-more" \}/)
  const advanced = client.slice(client.indexOf('group("高级"'))
  assert.match(advanced.slice(0, advanced.indexOf('state.error ?')), /h\(HeaderItemsSettings\)/)
  assert.doesNotMatch(client.slice(client.indexOf('group("显示与交互"'), client.indexOf('group("高级"')), /HeaderItemsSettings/)
})

test('手机上两个例外规则都放行新的顶栏容器', () => {
  assert.equal((css.match(/:not\(\.dsh-tavern-header-items\)/g) || []).length, 2)
  assert.match(css, /\[class\*="_headerUtilities"\] > :not\(\.dsh-tavern-header-settings\):not\(\.dsh-tavern-export-menu\):not\(\.dsh-tavern-header-items\)/)
  assert.match(css, /\[data-slot="conversation\.session\.header\.utilities"\] > :not\(\.dsh-tavern-header-settings\):not\(\.dsh-tavern-export-menu\):not\(\.dsh-tavern-header-items\)/)
})

test('空间不足时从尾部收起页面，酒馆状态和导出永不收起', () => {
  const source = client.match(/function tavernHeaderFold\(ids[\s\S]*?\n\t\t\}/)[0]
  const fold = vm.runInNewContext('(' + source + ')')
  const width = value => value
  // 都放得下时不收起任何按钮。
  assert.deepEqual(Array.from(fold(['a', 'b'], width, 400, { gap: 2 })), [])
  // 从尾部连续收起。
  assert.deepEqual(Array.from(fold(['a', 'b', 'c', 'd', 'e'], () => 100, 300, { gap: 2, moreWidth: 34 })), ['c', 'd', 'e'])
  // 固定按钮不参与收起，也不会挡住它前面的页面。
  assert.deepEqual(Array.from(fold(['a', 'b', 'c'], id => (id === 'c' ? 100 : 100), 250, { gap: 2, moreWidth: 34, fixed: ['c'] })), ['b'])
  assert.deepEqual(Array.from(fold(['dsh-tavern:status', 'dsh-tavern:cards', 'dsh-tavern:worldbooks', 'header:export'], () => 100, 260, { gap: 2, moreWidth: 34, fixed: ['dsh-tavern:status', 'header:export'] })), ['dsh-tavern:cards', 'dsh-tavern:worldbooks'])
})

test('会话模式还没加载时顶栏仍然渲染', () => {
  // 模式的发布者是左侧栏；手机上它要打开抽屉才挂载，所以顶栏首次渲染时
  // mode 通常是空的。空 mode 是「还没加载」，不能当成「不是酒馆会话」，
  // 否则整排按钮在手机上一律消失（桌面侧栏常驻，看不出来）。
  assert.doesNotMatch(client, /if \(!mode\) return null/)
  assert.doesNotMatch(client, /if \(!isPlayMode\(mode\)\) return null/)
  assert.equal((client.match(/if \(mode && !is(?:Body|Play)Mode\(mode\)\) return null/g) || []).length, 2)
  assert.match(client, /function ensureTavernSessionModes\(\)/)
  assert.match(client, /function useTavernSessionMode\(sessionId\)[\s\S]*?ensureTavernSessionModes\(\)/)

  // 行为：同一段包装组件，mode 为空时渲染、知道不是正文模式时才返回 null。
  const tail = client.slice(client.indexOf('id: "dsh-tavern-header-items", order: 80'))
  const start = tail.indexOf('function (slotProps) {')
  const body = tail.slice(start, start + balancedLength(tail.slice(start)))
  // 包装体依赖同文件里的两个辅助：slot 解析与错误边界。
  const helpersStart = client.indexOf('function resolveTavernHeaderSlot(')
  const helpersEnd = client.indexOf('// One slot for every top-bar shortcut', helpersStart)
  const helpers = client.slice(helpersStart, helpersEnd)
  const wrap = vm.runInNewContext('(function(){' + helpers + '\nreturn (' + body + ');})', {
    ctx: { sessions: { subagentAddress: () => null } },
    useTavernSessionMode: () => current,
    isBodyMode: mode => mode === 'story' || mode === 'script',
    isPlayMode: mode => mode === 'story' || mode === 'script',
    React: { createElement: (type, props) => ({ rendered: type.name || 'element', props }), Component: class { constructor(props) { this.props = props } } },
    TavernHeaderItems: function TavernHeaderItems() {},
    TavernHeaderBoundary: class TavernHeaderBoundary { constructor(props) { this.props = props } render() { return this.props.children } },
    tavernErrorHub: { report() {} },
    openTavernSidebarTab: () => {}
  })()
  let current = ''
  assert.ok(wrap({ sessionId: 's1' }), 'mode 还没加载时必须渲染')
  assert.ok(wrap({}), '没有 sessionId 也不能崩（宿主 slot props 可能为空）')
  current = 'story'
  assert.ok(wrap({ sessionId: 's1' }), '正文模式渲染')
  current = 'card'
  assert.equal(wrap({ sessionId: 's1' }), null, '卡片工作台不显示顶栏')
})

test('顶栏不把宿主 slot props 当必定完整', () => {
  // 0.2.1 的 header slot 注入 sessions；0.2.0 只给 sessionId，甚至可能为空对象。
  // 直接 props.sessions.subagentAddress(...) 会抛 TypeError，而宿主的
  // SlotErrorBoundary 会把异常吞掉 —— 表现就是整排按钮消失，且没有任何报错。
  assert.doesNotMatch(client, /const owner = props\.sessions\.subagentAddress\(/)
  assert.doesNotMatch(client, /const address = props\.sessions\.subagentAddress\(/)
  assert.match(client, /function resolveTavernHeaderSlot\(/)
  assert.match(client, /class TavernHeaderBoundary extends React\.Component/)
  assert.match(client, /SlotErrorBoundary|静默吞|吞成空白/)
})

test('shell 标记不依赖左侧栏挂载，移动端顶栏有独立兜底', () => {
  // 手机上的左侧栏是抽屉，不打开就不挂载；以前 dsh-tavern-shell-active 只在
  // 它挂载时加，于是 body 上没有这个类，所有以它为前缀的移动端覆盖全部失效，
  // 宿主 header:has(_headerLeading) 的 display:none 就把整排顶栏吃掉。
  assert.match(client, /function markTavernShellActive\(\)/)
  assert.match(client, /markTavernShellActive\(\);/)
  // 兜底规则不依赖 body 类，只认「里面装着酒馆按钮」。
  assert.match(css, /header:has\(\[class\*="_headerLeading"\]\) \[class\*="_headerUtilities"\]:has\(\.dsh-tavern-header-items\)/)
  assert.match(css, /display: flex !important; flex: 0 1 auto !important; min-width: 0 !important;/)
})

// 从 `function (props) {` 起按大括号配对取完整函数源码。
function balancedLength(source) {
  let depth = 0
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  throw new Error('unbalanced function body')
}
