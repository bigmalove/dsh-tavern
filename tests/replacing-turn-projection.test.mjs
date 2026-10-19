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
