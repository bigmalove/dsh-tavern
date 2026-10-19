// 世界书切换器面板：桌面三栏、条目开关与详情、两段式删除、大窗编辑、设置、文件夹、常用条目、手机标签页。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = client.indexOf('const WBSW_STORAGE_KEY')
const marker = 'const worldBookSwitcherFeature = createWorldBookSwitcherFeatureModule();'
const end = client.indexOf(marker) + marker.length
const source = client.slice(start, end)

function setup() {
	const dom = new JSDOM('<!doctype html><html><body><div id="anchor" style="position:fixed;top:10px;left:400px;width:80px;height:32px"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
	return dom
}

test('世界书切换器面板：渲染、开关、详情、删除与配置', async () => {
	assert.ok(start >= 0 && end > marker.length, '客户端 bundle 应包含世界书切换器')
	const dom = setup()
	globalThis.window = dom.window
	globalThis.document = dom.window.document
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
	globalThis.HTMLElement = dom.window.HTMLElement
	globalThis.Element = dom.window.Element
	globalThis.Node = dom.window.Node
	globalThis.IS_REACT_ACT_ENVIRONMENT = true

	const React = (await import('react')).default
	const ReactDOMClient = await import('react-dom/client')
	const { act } = await import('react')

	let current = {
		format: 'sillytavern-worldbook', displayName: '测试世界书', description: '',
		entries: [
			{ ref: 'entry:0', title: '王城设定', comment: '王城设定', content: '王城位于大陆中央。', enabled: true, constant: true, selective: false, vectorized: false, position: 1, depth: 4, primaryKeys: [], secondaryKeys: [], order: 100 },
			{ ref: 'entry:1', title: '雨季', comment: '雨季', content: '每年七月进入雨季。', enabled: true, constant: false, selective: true, vectorized: false, position: 0, depth: 3, primaryKeys: ['雨'], secondaryKeys: [], order: 90 }
		],
		diagnostics: []
	}
	const view = () => Object.assign({}, current, { entryCount: current.entries.length, enabledCount: current.entries.filter(entry => entry.enabled).length })
	const calls = []
	const rpc = async (method, args) => {
		calls.push([method, args])
		if (method === 'listWorldBooks') {
			return {
				standalone: [
					{ kind: 'standalone', path: 'worldbooks/测试.json', name: '测试世界书', globalEnabled: true, entryCount: current.entries.length, enabledCount: view().enabledCount, diagnostics: 0 },
					{ kind: 'standalone', path: 'worldbooks/备用.json', name: '备用世界书', globalEnabled: false, entryCount: 0, enabledCount: 0, diagnostics: 0 }
				],
				embedded: [], diagnostics: []
			}
		}
		if (method === 'getWorldBook') return { source: args.source, view: view(), globalEnabled: true }
		if (method === 'updateWorldBook') {
			const operation = args.update.operations[0]
			if (operation.op === 'delete') current = Object.assign({}, current, { entries: current.entries.filter(entry => entry.ref !== operation.ref) })
			else current = Object.assign({}, current, { entries: current.entries.map(entry => entry.ref === operation.ref ? Object.assign({}, entry, operation.patch) : entry) })
			return { source: args.source, view: view(), globalEnabled: true }
		}
		if (method === 'setGlobalWorldBook') return { source: args.source, view: view(), globalEnabled: args.enabled }
		if (method === 'deleteWorldBook') return { ok: true }
		throw new Error('未预期的 RPC：' + method)
	}
	const requireShim = name => {
		if (name === 'react-dom') return { createPortal: node => node }
		if (name === 'react-dom/client') return ReactDOMClient
		throw new Error('未预期的 require：' + name)
	}
	const factory = new Function('React', 'rpc', 'rpcWithTimeout', 'notifyTavernDataChanged', 'require', 'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'requestAnimationFrame',
		source + '\nreturn worldBookSwitcherFeature;')
	const feature = factory(React, rpc, rpc, () => {}, requireShim, dom.window, dom.window.document, console, setTimeout, clearTimeout, dom.window.requestAnimationFrame.bind(dom.window))
	const tick = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)) }) }
	const query = selector => dom.window.document.querySelector(selector)
	const queryAll = selector => Array.from(dom.window.document.querySelectorAll(selector))
	const localConfig = () => JSON.parse(dom.window.localStorage.getItem('dsh-tavern-worldbook-switcher'))
	const setTextarea = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
	const setInput = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set

	// 纯函数先验。
	const defaults = feature.normalizeConfig({})
	assert.equal(defaults.desktopVisibleRows, 12)
	assert.equal(defaults.toggleStyle, 'default')
	assert.equal(feature.rowsConfig('2', 12), 4)
	assert.equal(feature.rowsConfig('99', 12), 40)
	assert.equal(feature.sourceKey({ kind: 'card', cardPath: 'cards/a.png' }), 'card:cards/a.png')
	assert.equal(feature.sourceKey({ kind: 'standalone', path: 'worldbooks/a.json' }), 'standalone:worldbooks/a.json')
	assert.equal(feature.strategyOf({ constant: true }), 'constant')
	assert.equal(feature.strategyOf({ vectorized: true }), 'vectorized')
	assert.equal(feature.strategyOf({ selective: true }), 'selective')
	assert.equal(feature.positionValue({ position: 1 }), 'after_char')
	assert.equal(feature.positionValue({ position: 4 }), 'at_depth')
	assert.equal(feature.positionValue({ position: 'after_example_messages' }), 'after_example')
	assert.equal(feature.positionValue({ position: 'before_char' }), 'before_char')
	assert.equal(feature.positionPatch('after_char'), 1)
	assert.equal(feature.positionPatch('at_depth'), 4)
	assert.equal(feature.positionPatch('outlet'), 7)
	assert.equal(feature.positionPatch('不认识的'), 0)
	assert.equal(feature.panelHeight(12, false, 720), 520)
	const wide = feature.columnWidths({ available: 1264, all: true, frequent: true, pane: true })
	assert.equal(wide.widths.main, 300)
	assert.equal(wide.widths.all, 250)
	assert.equal(wide.widths.frequent, 280)
	assert.equal(wide.widths.side, 340)
	assert.equal(wide.total, 300 + 250 + 280 + 340 + 24)
	const tightColumns = feature.columnWidths({ available: 1100, all: true, frequent: true, pane: true })
	assert.ok(tightColumns.total <= 1100, '三栏放不下时应收窄到可用宽度：' + tightColumns.total)
	assert.ok(tightColumns.widths.main >= 264 && tightColumns.widths.side >= 300, '收窄后应保住可读宽度')
	const floorColumns = feature.columnWidths({ available: 900, all: true, frequent: true, pane: true })
	assert.equal(floorColumns.total, 264 + 214 + 236 + 300 + 24, '空间不足时退到最小宽度')
	const grouped = feature.groupRows([
		{ kind: 'standalone', path: 'a.json', name: 'A' },
		{ kind: 'standalone', path: 'b.json', name: 'B' }
	], { folders: [{ id: 'f1', name: '主线' }], folderAssignments: { 'standalone:b.json': 'f1' }, pinnedWorldbooks: [] })
	assert.equal(grouped[0].name, '主线')
	assert.equal(grouped[0].rows.length, 1)
	assert.equal(grouped[1].rows[0].name, 'A')

	// 挂载并打开。
	let librarySource = null
	await act(async () => { feature.register({ ctx: {}, openLibrary: value => { librarySource = value } }) })
	const anchor = dom.window.document.getElementById('anchor')
	await act(async () => { feature.open(anchor, 'session-1') })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-shell'), '打开后应渲染面板')
	assert.ok(query('.dsh-tavern-wbsw-main'), '应渲染主面板列')
	assert.equal(queryAll('.dsh-tavern-wbsw-main .dsh-tavern-wbsw-row').length, 2)
	assert.match(query('.dsh-tavern-wbsw-main').textContent, /王城设定/)
	assert.ok(queryAll('.dsh-tavern-wbsw-select option').some(option => option.textContent === '测试世界书'))

	// 条目开关立即落盘。
	await act(async () => { query('.dsh-tavern-wbsw-main .dsh-tavern-wbsw-switch input').click() })
	await tick()
	const updateCall = calls.filter(call => call[0] === 'updateWorldBook').pop()
	assert.ok(updateCall, '切换条目应调用 updateWorldBook')
	assert.equal(updateCall[1].update.operations[0].op, 'update')
	assert.equal(updateCall[1].update.operations[0].ref, 'entry:0')
	assert.equal(updateCall[1].update.operations[0].patch.enabled, false)
	assert.equal(current.entries.find(entry => entry.ref === 'entry:0').enabled, false)

	// 详情：只读正文、三个策略按钮、八个插入位置。
	await act(async () => { query('.dsh-tavern-wbsw-main .dsh-tavern-wbsw-row').click() })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-detail'), '点击条目应打开详情')
	assert.equal(queryAll('.dsh-tavern-wbsw-strategy-btn').length, 3)
	assert.equal(query('.dsh-tavern-wbsw-content').readOnly, true)
	assert.equal(queryAll('.dsh-tavern-wbsw-field select option').length, 8, '插入位置应与 ST 一致有八项')
	assert.deepEqual(queryAll('.dsh-tavern-wbsw-field select option').map(option => option.textContent), ['角色定义前', '角色定义后', '示例消息前', '示例消息后', '作者注释前', '作者注释后', '指定深度', 'Outlet'])
	assert.equal(query('.dsh-tavern-wbsw-field-depth input').disabled, true, '非“指定深度”时深度不可编辑')
	await act(async () => { queryAll('.dsh-tavern-wbsw-strategy-btn')[2].click() })
	await tick()
	const strategyCall = calls.filter(call => call[0] === 'updateWorldBook').pop()
	assert.equal(strategyCall[1].update.operations[0].patch.vectorized, true)

	// 插入位置：选“指定深度”写 4，深度随之可用；再选“示例消息前”写 5。
	const positionSelect = query('.dsh-tavern-wbsw-detail select')
	await act(async () => {
		positionSelect.value = 'at_depth'
		positionSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
	})
	await tick()
	const atDepthCall = calls.filter(call => call[0] === 'updateWorldBook').pop()
	assert.equal(atDepthCall[1].update.operations[0].patch.position, 4)
	assert.equal(query('.dsh-tavern-wbsw-field-depth input').disabled, false, '选“指定深度”后深度应可编辑')
	await act(async () => {
		query('.dsh-tavern-wbsw-detail select').value = 'before_example'
		query('.dsh-tavern-wbsw-detail select').dispatchEvent(new dom.window.Event('change', { bubbles: true }))
	})
	await tick()
	const beforeExampleCall = calls.filter(call => call[0] === 'updateWorldBook').pop()
	assert.equal(beforeExampleCall[1].update.operations[0].patch.position, 5)
	assert.equal(query('.dsh-tavern-wbsw-field-depth input').disabled, true)

	// 两段式删除。
	await act(async () => { query('.dsh-tavern-wbsw-detail .dsh-tavern-wbsw-danger').click() })
	assert.ok(query('.dsh-tavern-wbsw-confirm'), '第一次点删除应出现确认/取消')
	assert.equal(queryAll('.dsh-tavern-wbsw-detail .dsh-tavern-wbsw-confirm button').length, 2)
	const deletes = () => calls.filter(call => call[0] === 'updateWorldBook' && call[1].update.operations[0].op === 'delete').length
	const beforeDelete = deletes()
	await act(async () => { query('.dsh-tavern-wbsw-confirm-yes').click() })
	await tick()
	assert.equal(deletes(), beforeDelete + 1, '点确认后应执行删除')
	assert.equal(current.entries.length, 1)

	// 全部世界书：列表与开关状态记忆。
	await act(async () => { query('.dsh-tavern-wbsw-main-head .dsh-tavern-wbsw-icon').click() })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-all'))
	assert.equal(localConfig().panelState.allWorldbooks, true)
	assert.equal(queryAll('.dsh-tavern-wbsw-all .dsh-tavern-wbsw-book-row').length, 2)
	await act(async () => { feature.close() })
	assert.ok(!query('.dsh-tavern-wbsw-shell'))
	await act(async () => { feature.open(anchor, 'session-1') })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-all'), '重新打开应恢复全部世界书面板')
	assert.ok(queryAll('.dsh-tavern-wbsw-all .dsh-tavern-wbsw-switch input').some(input => input.checked))

	// 大窗编辑：三组工具栏、Ctrl+S、未保存确认。
	await act(async () => { query('.dsh-tavern-wbsw-main .dsh-tavern-wbsw-row').click() })
	await tick()
	await act(async () => { query('.dsh-tavern-wbsw-detail .dsh-tavern-wbsw-head-actions .dsh-tavern-wbsw-icon').click() })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-editor-layer'), '应打开大窗编辑器')
	assert.equal(queryAll('.dsh-tavern-wbsw-toolgroup').length, 3)
	const area = query('.dsh-tavern-wbsw-editor-textarea')
	await act(async () => {
		setTextarea.call(area, '改写后的正文')
		area.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
	})
	await tick()
	assert.equal(queryAll('.dsh-tavern-wbsw-editor-actions .dsh-tavern-wbsw-btn')[0].disabled, false)
	await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })) })
	await tick()
	assert.ok(calls.some(call => call[0] === 'updateWorldBook' && call[1].update.operations[0].patch && call[1].update.operations[0].patch.content === '改写后的正文'), 'Ctrl+S 应保存正文')

	// 查找替换：先在正文里把“正文”换成“文本”。
	await act(async () => { queryAll('.dsh-tavern-wbsw-tool').find(button => button.textContent === '查找替换').click() })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-finder'), '应打开查找替换条')
	const [findInput, replaceInput] = queryAll('.dsh-tavern-wbsw-finder-input')
	await act(async () => {
		setInput.call(findInput, '正文')
		findInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
	})
	await tick()
	assert.match(query('.dsh-tavern-wbsw-finder-count').textContent, /共 1 处/)
	await act(async () => {
		setInput.call(replaceInput, '文本')
		replaceInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
	})
	await tick()
	await act(async () => { queryAll('.dsh-tavern-wbsw-finder-btn').find(button => button.textContent === '全部替换').click() })
	await tick()
	assert.equal(query('.dsh-tavern-wbsw-editor-textarea').value, '改写后的文本', '全部替换应改写正文')
	assert.match(query('.dsh-tavern-wbsw-finder-count').textContent, /已全部替换 1 处/)
	// 单个替换：先定位，再替换。
	await act(async () => {
		setInput.call(findInput, '文本')
		findInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
		setInput.call(replaceInput, '正文')
		replaceInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
	})
	await tick()
	await act(async () => { queryAll('.dsh-tavern-wbsw-finder-btn').find(button => button.textContent === '下一个').click() })
	await tick()
	assert.match(query('.dsh-tavern-wbsw-finder-count').textContent, /1 \/ 1/)
	await act(async () => { queryAll('.dsh-tavern-wbsw-finder-btn').find(button => button.textContent === '替换').click() })
	await tick()
	assert.equal(query('.dsh-tavern-wbsw-editor-textarea').value, '改写后的正文', '单个替换应只改选中处')
	// 找不到时给出提示，不写坏正文。
	await act(async () => {
		setInput.call(findInput, '不存在的词')
		findInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
	})
	await tick()
	await act(async () => { queryAll('.dsh-tavern-wbsw-finder-btn').find(button => button.textContent === '全部替换').click() })
	await tick()
	assert.match(query('.dsh-tavern-wbsw-finder-count').textContent, /没有找到/)
	assert.equal(query('.dsh-tavern-wbsw-editor-textarea').value, '改写后的正文')
	// Esc 先关查找条，再关编辑器。
	await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
	await tick()
	assert.ok(!query('.dsh-tavern-wbsw-finder'), 'Esc 应先关闭查找替换条')
	assert.ok(query('.dsh-tavern-wbsw-editor-layer'), 'Esc 关查找条时不应关闭编辑器')

	await act(async () => {
		setTextarea.call(area, '第二次修改')
		area.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
	})
	await tick()
	await act(async () => { queryAll('.dsh-tavern-wbsw-editor-actions .dsh-tavern-wbsw-btn')[1].click() })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-confirm-text'), '未保存关闭应提示确认')
	await act(async () => { query('.dsh-tavern-wbsw-editor-layer .dsh-tavern-wbsw-confirm-no').click() })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-editor-layer'), '取消后编辑器应保留')
	await act(async () => { queryAll('.dsh-tavern-wbsw-editor-actions .dsh-tavern-wbsw-btn')[1].click() })
	await tick()
	await act(async () => { query('.dsh-tavern-wbsw-editor-layer .dsh-tavern-wbsw-confirm-yes').click() })
	await tick()
	assert.ok(!query('.dsh-tavern-wbsw-editor-layer'), '确认后编辑器应关闭')

	// 设置：开关样式、显示元素。
	await act(async () => { query('.dsh-tavern-wbsw-main .dsh-tavern-wbsw-footer .dsh-tavern-wbsw-icon').click() })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-settings'))
	const styleSelect = queryAll('.dsh-tavern-wbsw-settings select')[0]
	await act(async () => {
		styleSelect.value = 'simple'
		styleSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
	})
	await tick()
	assert.equal(localConfig().toggleStyle, 'simple')
	const iconsBefore = queryAll('.dsh-tavern-wbsw-main .dsh-tavern-wbsw-row .dsh-tavern-wbsw-icon').length
	await act(async () => { queryAll('.dsh-tavern-wbsw-toggles .dsh-tavern-wbsw-toggle-row input')[3].click() })
	await tick()
	assert.ok(queryAll('.dsh-tavern-wbsw-main .dsh-tavern-wbsw-row .dsh-tavern-wbsw-icon').length < iconsBefore, '关闭“查看详情”后行内详情按钮应消失')

	// 文件夹管理。
	await act(async () => { query('.dsh-tavern-wbsw-wide-btn').click() })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-folders'))
	const folderInput = query('.dsh-tavern-wbsw-folders .dsh-tavern-wbsw-search')
	await act(async () => {
		setInput.call(folderInput, '主线')
		folderInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
	})
	await tick()
	await act(async () => { query('.dsh-tavern-wbsw-folders .dsh-tavern-wbsw-wide-btn.is-compact').click() })
	await tick()
	assert.equal(localConfig().folders.length, 1)
	assert.equal(localConfig().folders[0].name, '主线')
	const assignSelect = query('.dsh-tavern-wbsw-assign select')
	await act(async () => {
		assignSelect.value = localConfig().folders[0].id
		assignSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
	})
	await tick()
	assert.ok(Object.values(localConfig().folderAssignments).includes(localConfig().folders[0].id))
	await act(async () => { query('.dsh-tavern-wbsw-folders .dsh-tavern-wbsw-head .dsh-tavern-wbsw-icon').click() })
	await tick()
	await act(async () => { query('.dsh-tavern-wbsw-settings .dsh-tavern-wbsw-head .dsh-tavern-wbsw-icon').click() })
	await tick()

	// 常用条目：使用记录与置顶。
	await act(async () => { query('.dsh-tavern-wbsw-main .dsh-tavern-wbsw-switch input').click() })
	await tick()
	await act(async () => { queryAll('.dsh-tavern-wbsw-main-head .dsh-tavern-wbsw-icon')[1].click() })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-frequent'))
	assert.equal(queryAll('.dsh-tavern-wbsw-frequent-row').length, 1)
	await act(async () => { query('.dsh-tavern-wbsw-frequent-row .dsh-tavern-wbsw-icon').click() })
	await tick()
	assert.equal(localConfig().pinnedEntries.length, 1)

	// 「完整」进入右侧栏世界书库。
	await act(async () => { query('.dsh-tavern-wbsw-main-head .dsh-tavern-wbsw-btn').click() })
	await tick()
	assert.ok(librarySource && librarySource.path === 'worldbooks/测试.json', '完整按钮应带上当前世界书')
	assert.ok(!query('.dsh-tavern-wbsw-shell'), '完整按钮后应关闭面板')

	// 手机：宽 600 时改为标签页；设置双窗口后左栏固定世界书。
	Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 600 })
	await act(async () => { dom.window.dispatchEvent(new dom.window.Event('resize')) })
	await act(async () => { feature.open(anchor, 'session-1') })
	await tick()
	assert.ok(query('.dsh-tavern-wbsw-shell.is-mobile'), '窄屏应使用手机布局')
	const tabs = queryAll('.dsh-tavern-wbsw-tab').map(tab => tab.textContent)
	assert.ok(tabs.includes('世界书') && tabs.includes('条目') && tabs.includes('常用'), '手机应有三个标签页：' + tabs.join(','))
	await act(async () => { queryAll('.dsh-tavern-wbsw-tab')[0].click() })
	await tick()
	assert.ok(queryAll('.dsh-tavern-wbsw-book-row').length > 0, '世界书标签页应列出世界书')
	await act(async () => { feature.close() })
})

test('顶栏世界书按钮接管为弹出切换面板，其余入口保持打开侧栏', async () => {
	assert.match(client, /if \(id === "dsh-tavern:worldbooks" && node\) \{\s*worldBookSwitcherFeature\.open\(node, owner\);/)
	assert.match(client, /onClick: function \(event\) \{ activate\(id, event\.currentTarget\); \}/)
	assert.match(client, /activate\(entry\.id, host\.current\)/)
	assert.match(client, /worldBookSwitcherFeature\.register\(\{/)
	assert.match(client, /openTavernSidebarTab\(ctx, \{ type: "dsh-tavern:worldbooks", meta: source \? \{ worldBookSource: source \} : null \}/)
	assert.match(client, /\.dsh-tavern-wbsw-shell \{ position: fixed; z-index: 3000;/)
})
