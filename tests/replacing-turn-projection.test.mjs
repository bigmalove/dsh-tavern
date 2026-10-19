import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionStateView } from '../tavern-plugin/lib/domain/chat-session-state.js'

const events = [
  { seq: 0, type: 'user/message', data: { role: 'user', source: { kind: 'user' } } },
  { seq: 1, type: 'assistant/message', data: { turn: 1, message: { source: { kind: 'model', provider: 'p', model: 'm' } } } }
]
const session = { id: 's', events, surface: { nodes: [0, 1] } }
const fields = createSessionStateView({ activity: () => ({ busy: false }), evidence: () => ({ session, events }) })

function viewOf(chat) {
  return fields.rollback({ id: 'c', sessionId: 's', mode: 'story', messages: [], ...chat }, { session, events })
}

test('重生成只藏被替换的正文：replacingDshTurns 与 suppressedDshTurns 是两件事', () => {
  const view = viewOf({ replacingDshTurns: [2], suppressedDshTurns: [5] })
  assert.deepEqual(view.replacingDshTurns, [2])
  assert.deepEqual(view.suppressedDshTurns, [5])
})

test('同一回合不会同时出现在两个列表里，否则玩家输入会被连带隐藏', () => {
  const view = viewOf({ replacingDshTurns: [3], suppressedDshTurns: [3, 6] })
  assert.deepEqual(view.replacingDshTurns, [3])
  assert.deepEqual(view.suppressedDshTurns, [6])
})

test('中断在生成中的存档按恢复记录读回：重启后输入仍然可见', () => {
  const view = viewOf({ regenInProgress: true, regenRecovery: { id: 'op', temporaryReplacingTurn: 1 } })
  assert.deepEqual(view.replacingDshTurns, [1])
  assert.deepEqual(view.suppressedDshTurns, [])
})

test('没在重生成时，残留的恢复记录不再生效', () => {
  const view = viewOf({ suppressedDshTurns: [3], regenRecovery: { temporaryReplacingTurn: 1 } })
  assert.deepEqual(view.replacingDshTurns, [])
  assert.deepEqual(view.suppressedDshTurns, [3])
})

// 存档记的是生成期的合成回合，实际正文在提交之后才投影进另一个编辑回合。
// 视图必须以日志为准，否则旧回合会被当成当前正文继续显示。
const projectedEvents = [
  { seq: 0, type: 'user/message', data: { role: 'user', source: { kind: 'user' } } },
  { seq: 1, type: 'assistant/message', data: { turn: 1, message: { source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '开场' }] } } },
  { seq: 2, type: 'assistant/message', data: { turn: 11, message: { source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '被替换的正文' }] } } },
  { seq: 3, type: 'assistant/message', surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 }, sourceEventSeqs: [2],
    data: { turn: 12, message: { source: { kind: 'model', provider: 'p', model: 'm', tavernStoryTurn: 4 }, content: [{ type: 'text', text: '新正文' }] } } }
]
const projectedSession = { id: 's', events: projectedEvents, surface: { nodes: [0, 1, 3] } }

test('投影记在哪个原生回合，视图就指向哪个回合', () => {
  const view = fields.rollback({ id: 'c', sessionId: 's', mode: 'story', messages: [],
    regeneratedDshTurns: { 4: 11 }, suppressedDshTurns: [11] }, { session: projectedSession, events: projectedEvents })
  assert.equal(view.regeneratedDshTurns[4], 12, '存档里的 11 是生成期回合，正文实际在 12')
  // 这条链路里没有任何 append 副本，宿主对话视图画不出「新正文」；此时隐藏 11
  // 只会让整轮变成空白，所以必须留着。补上副本后才会隐藏（见下一条用例）。
  assert.deepEqual(view.supersededDshTurns, [], '没有可画副本时不能隐藏旧回合')
})

test('没有投影时保持存档里的映射与空的待清理列表', () => {
  const view = viewOf({ regeneratedDshTurns: { 4: 11 } })
  assert.equal(view.regeneratedDshTurns[4], 11)
  assert.deepEqual(view.supersededDshTurns, [])
})

// 宿主对话视图只画 append 来源的事件，替换节点对它不可见。没有可画的副本时若照旧
// 隐藏被替换的回合，页面就是一片空白（「重生成后什么都没有」就是这样来的）。
test('替换正文没有可画的副本时，不隐藏被替换的回合', async () => {
  const { Session } = await import('./fixtures/dsh-session-host.mjs')
  const { appendSessionEvent, sessionEvents } = await import('../tavern-plugin/lib/domain/session-events.js')
  const { supersededRegenerationTurns } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const source = { kind: 'model', provider: 'test', model: 'test' }
  const session = Session.create('superseded-guard')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  appendSessionEvent(session, 'user/message', { id: 'in-1', role: 'user', content: [{ type: 'text', text: '输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const old = appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'old', role: 'assistant', content: [{ type: 'text', text: '旧正文' }], source } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  appendSessionEvent(session, 'assistant/message', {
    turn: 2, step: 1,
    message: { id: 'tavern-regen:op', role: 'assistant', content: [{ type: 'text', text: '新正文' }], source: { ...source, tavernStoryTurn: 1 } },
  }, { surfaceOp: { op: 'replace', startSeq: old.seq, endSeq: old.seq }, sourceEventSeqs: [old.seq] })
  assert.deepEqual(supersededRegenerationTurns({ events: sessionEvents(session), nodes: session.surface.nodes.map(Number) }), [],
    '没有可画副本时必须保留旧回合，否则整轮空白')

  appendSessionEvent(session, 'assistant/message', {
    turn: 2, step: 1,
    message: { id: 'tavern-transcript:copy', role: 'assistant', content: [{ type: 'text', text: '新正文' }], source: { ...source, tavernStoryTurn: 1 } },
  }, { surfaceOp: 'append' })
  assert.deepEqual(supersededRegenerationTurns({ events: sessionEvents(session), nodes: session.surface.nodes.map(Number) }), [1])
})
