import assert from 'node:assert/strict'
import test from 'node:test'
import { projectChatSessionState, createSessionStateView } from '../tavern-plugin/lib/domain/chat-session-state.js'

// 撤销删除的事实只存在 header 里（deletionUndo）。缓存命中那条投影路径唯一的 Chat
// 来源是这份裁剪投影：它把 deletionUndo 过滤掉之后，canUndoDeletion 恒为 false，
// 页面上「撤销删除」就永远不出现——磁盘上明明还留着撤销点。
function chat(extra = {}) {
  return {
    id: 'chat', sessionId: 'session', mode: 'story', _storageRevision: 8,
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 4, checkpoints: [], participants: {}, operations: {}, updatedAt: 0 },
    settleStatus: 'idle', settleError: null, posture: '', ledger: null,
    messages: [{ role: 'user', text: '推门' }],
    ...extra
  }
}

const deletionUndo = {
  kind: 'message', index: 4, turn: 5, role: 'assistant',
  message: { role: 'assistant', turn: 5, text: '被删掉的那段正文' },
  state: { posture: '删除前的姿势', ledger: null, lastSettle: null, settleStatus: 'done', hasVariables: false },
  nativeSeq: 21, nativeType: 'assistant/message', markerId: 'tavern-message-delete:x', at: 1
}

test('裁剪投影保留 deletionUndo：缓存命中后仍知道有撤销点', () => {
  const slim = projectChatSessionState(chat({ deletionUndo }))
  assert.ok(slim.deletionUndo, '裁剪投影不能丢掉撤销点')
  assert.equal(slim.deletionUndo.index, 4)
  assert.equal(slim.deletionUndo.message.text, '被删掉的那段正文')
  // 必须是深拷贝：视图缓存持有它，不能和存档共用同一批对象。
  assert.notEqual(slim.deletionUndo, deletionUndo)
  assert.notEqual(slim.deletionUndo.message, deletionUndo.message)
})

test('没有撤销点时裁剪投影也不凭空造一个', () => {
  const slim = projectChatSessionState(chat())
  assert.equal(Object.hasOwn(slim, 'deletionUndo'), false)
})

test('用裁剪投影算视图：canUndoDeletion 跟着 deletionUndo 走', () => {
  const view = createSessionStateView({ activity: () => ({ busy: false }), evidence: () => ({ session: null, events: [] }) })
  const withUndo = view.volatile(projectChatSessionState(chat({ deletionUndo })), { busy: false }, { baseRevision: 8, indices: [], layoutChanged: false })
  assert.equal(withUndo.canUndoDeletion, true)
  assert.equal(withUndo.deletionUndoKind, 'message')
  assert.equal(withUndo.deletionUndoable, true)

  const without = view.volatile(projectChatSessionState(chat()), { busy: false }, { baseRevision: 8, indices: [], layoutChanged: false })
  assert.equal(without.canUndoDeletion, false)
})

test('undoable 为 false 时仍然报告删除种类，但明确不可撤销', () => {
  const view = createSessionStateView({ activity: () => ({ busy: false }), evidence: () => ({ session: null, events: [] }) })
  const blocked = projectChatSessionState(chat({ deletionUndo: { ...deletionUndo, undoable: false } }))
  const fields = view.volatile(blocked, { busy: false }, { baseRevision: 8, indices: [], layoutChanged: false })
  assert.equal(fields.canUndoDeletion, true)
  assert.equal(fields.deletionUndoable, false)
})
