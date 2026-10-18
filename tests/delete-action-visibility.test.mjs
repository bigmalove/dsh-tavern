import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// 删掉的那一楼，宿主仍然渲染它的操作栏。按钮必须自己藏起来（否则页面上留一个
// 点不动的垃圾桶），并且删除时把节点身份带给服务端（index 在删除后会前移）。
const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function floorOf(')
const end = source.indexOf('function TavernSwipeControl(')
const component = source.slice(start, end)
assert.ok(component.includes('function TavernDeleteMessageAction('), 'client.js 结构已变化，测试切片需要更新')

function harness({ view }) {
  const calls = []
  let cursor = 0
  const states = []
  const context = {
    React: {
      Fragment: 'fragment',
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = initial
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
      }
    },
    DshUi: {
      Tooltip: 'tooltip',
      IconTrashOutline16: 'trash',
      IconCheckOutline16: 'check',
      IconCopyOutline16: 'copy'
    },
    useScopedLiveTavernView: (sessionId, key, paths) => { calls.push(['subscribe', sessionId, key, paths]); return { view: current.view } },
    useTavernConfirm: () => async () => true,
    isPlayMode: () => true,
    rpc: async (method, args) => { calls.push(['rpc', method, args]); return { ok: true, view: {} } },
    applyTavernResultView: () => calls.push(['apply']),
    notifyTavernDataChanged: () => calls.push(['notify']),
    tavernCoordination: { invalidate: () => calls.push(['coordination']) },
    tavernErrorHub: { report: (name, error) => calls.push(['error', name, String(error && error.message || error)]) },
    liveTavernView: { invalidate: () => calls.push(['invalidate']) },
    setTavernBodyEditPanel: () => calls.push(['open-editor'])
  }
  const current = { view }
  const actions = vm.runInNewContext(component + '; ({ TavernDeleteMessageAction, TavernFloorEditButton })', context)
  return {
    calls,
    set(next) { current.view = next },
    render(props) { cursor = 0; return actions.TavernDeleteMessageAction(Object.assign({ sessionId: 'session' }, props)) },
    renderEdit(props) { cursor = 0; return actions.TavernFloorEditButton(Object.assign({ sessionId: 'session' }, props)) }
  }
}

const floor = { index: 4, turn: 2, role: 'assistant', seq: 21, editable: true, swipeCount: 1 }

test('删除按钮跟着楼层走：消息已删除（deletedSeqs 命中）时不再渲染', () => {
  const h = harness({ view: { mode: 'story', floorsByMessageId: { reply: floor }, deletedSeqs: {} } })
  assert.ok(h.render({ messageId: 'reply' }), '未删除时应该出现')
  h.set({ mode: 'story', floorsByMessageId: { reply: floor }, deletedSeqs: { 21: true } })
  assert.equal(h.render({ messageId: 'reply' }), null, '已删除的楼层不该留下删除按钮')
  // 订阅里要带上 deletedSeqs，否则视图更新时这一格不会重渲染。
  assert.ok(h.calls.some(call => call[0] === 'subscribe' && call[3].some(path => path[0] === 'deletedSeqs')), '缺少 deletedSeqs 订阅')
})

test('楼层已从视图里消失时按钮也消失', () => {
  const h = harness({ view: { mode: 'story', floorsByMessageId: {}, deletedSeqs: {} } })
  assert.equal(h.render({ messageId: 'reply' }), null)
})

test('删除时把消息 id 与原生 seq 一起发给服务端（index 会前移，身份不会）', async () => {
  const h = harness({ view: { mode: 'story', floorsByMessageId: { reply: floor }, deletedSeqs: {} } })
  const tree = h.render({ messageId: 'reply' })
  const button = tree.children[0]
  await button.props.onClick()
  const call = h.calls.find(entry => entry[0] === 'rpc')
  assert.ok(call, '应该发起删除请求')
  assert.equal(call[1], 'deleteFloorMessage')
  assert.equal(call[2].messageId, 'reply')
  assert.equal(call[2].seq, 21)
  assert.equal(call[2].index, 4)
})

test('玩家气泡：按 seq 订阅，已删除时隐藏，请求带 seq', async () => {
  const h = harness({ view: { mode: 'story', floorsBySeq: { 31: { index: 3, turn: 2, role: 'user', seq: 31, editable: true } }, deletedSeqs: {} } })
  const tree = h.render({ seq: 31, variant: 'user' })
  assert.ok(tree)
  await tree.children[0].props.onClick()
  const call = h.calls.find(entry => entry[0] === 'rpc')
  assert.equal(call[2].seq, 31)
  assert.equal(call[2].messageId, '')
  h.set({ mode: 'story', floorsBySeq: { 31: { index: 3, turn: 2, role: 'user', seq: 31, editable: true } }, deletedSeqs: { 31: true } })
  assert.equal(h.render({ seq: 31, variant: 'user' }), null)
})

test('编辑按钮同样不给已删除的楼层留入口', () => {
  const h = harness({ view: { mode: 'story', floorsByMessageId: { reply: floor }, deletedSeqs: { 21: true } } })
  assert.equal(h.renderEdit({ messageId: 'reply' }), null)
})
