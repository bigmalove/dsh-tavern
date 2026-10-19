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

test('旧存档把临时压制写在 suppressedDshTurns 里，视图按"只换正文"读回来', () => {
  // 0.2.1 之前的存档形状：临时压制混进了整轮作废列表。
  const view = viewOf({
    suppressedDshTurns: [1], regenInProgress: true,
    regenRecovery: { id: 'op', temporarySuppressedTurn: 1 }
  })
  assert.deepEqual(view.replacingDshTurns, [1])
  assert.deepEqual(view.suppressedDshTurns, [], '整轮作废列表里不能再留着这一楼，否则输入会被一起收掉')
})

test('没在重生成时，旧的 temporarySuppressedTurn 不再生效', () => {
  const view = viewOf({ suppressedDshTurns: [3], regenRecovery: { temporarySuppressedTurn: 1 } })
  assert.deepEqual(view.replacingDshTurns, [])
  assert.deepEqual(view.suppressedDshTurns, [3])
})
