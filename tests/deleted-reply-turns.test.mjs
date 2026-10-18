import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { deletedReplyTurnKeys, deletedReplyTurns, deletedSurfaceSeqs } from '../tavern-plugin/lib/domain/deleted-surface-nodes.js'
import { createSessionSurfaceMutator } from '../tavern-plugin/lib/domain/session-surface-mutations.js'

function round(session, turn, input, body) {
  appendSessionEvent(session, 'user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: input }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/start', { turn })
  appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: body }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

function marker(session, seq, id) {
  const appended = createSessionSurfaceMutator(session).replace('user/message', {
    id, role: 'user', content: [], source: { kind: 'plugin', plugin: 'dsh-tavern-deletion' }
  }, { start: seq, end: seq, sourceEventSeqs: [seq] })
  return Number(typeof appended === 'object' && appended !== null ? appended.seq : appended)
}

const seqOf = (session, id) => session.surface.nodes
  .map(seq => session.eventAt(seq))
  .find(event => String(event?.data?.message?.id || event?.data?.id) === id).seq

test('删掉一回合的最后一条回复：这一回合的尾行要一起藏起来', () => {
  const session = Session.create('deleted-tail')
  round(session, 2, '推门', '第一段正文')
  round(session, 3, '继续', '第二段正文')
  const seq = seqOf(session, 'a3')
  marker(session, seq, 'mark-a3')
  assert.deepEqual(deletedSurfaceSeqs(session), [seq])
  assert.deepEqual(deletedReplyTurns(session), [3])
})

test('删的是同回合较早的步骤：尾行还归最后那条，不能动', () => {
  const session = Session.create('deleted-step')
  round(session, 2, '推门', '第一段正文')
  // 同一回合里两个助手步骤：只有最后一条承载尾行。
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 2, message: { id: 'a2-b', role: 'assistant', content: [{ type: 'text', text: '第二段正文' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const early = seqOf(session, 'a2')
  marker(session, early, 'mark-a2')
  assert.deepEqual(deletedSurfaceSeqs(session), [early])
  assert.deepEqual(deletedReplyTurns(session), [], '最后一条还在，尾行要留着')
})

test('删玩家输入不藏尾行；撤销后两个列表都清空', () => {
  const session = Session.create('deleted-input')
  round(session, 2, '推门', '第一段正文')
  round(session, 3, '继续', '第二段正文')
  const inputSeq = seqOf(session, 'u3')
  const markerSeq = marker(session, inputSeq, 'mark-u3')
  assert.deepEqual(deletedSurfaceSeqs(session), [inputSeq])
  assert.deepEqual(deletedReplyTurns(session), [])

  // 撤销：把标记再顶替回原文，两个列表都该回空。
  const original = session.snapshotEvents().find(event => Number(event.seq) === inputSeq)
  createSessionSurfaceMutator(session).replace('user/message', structuredClone(original.data), {
    start: markerSeq, end: markerSeq, sourceEventSeqs: [markerSeq]
  })
  assert.deepEqual(deletedSurfaceSeqs(session), [])
  assert.deepEqual(deletedReplyTurns(session), [])
})

// 页面上的尾行行带的是宿主 Chat 的 turn，存档记的是剧情 turn，重新生成过就会分叉。
// 只发一套编号时，「这一套对不上」就等于彻底不生效——所以两套都要给。
test('重新生成过的回合：native 与 story 两套编号都发出来', () => {
  const session = Session.create('deleted-mapped')
  round(session, 2, '推门', '第一段正文')
  round(session, 3, '继续', '第二段正文')
  marker(session, seqOf(session, 'a3'), 'mark-a3')
  // 剧情第 3 回合被重新生成到 native 第 5 回合。
  assert.deepEqual(deletedReplyTurnKeys(session, { 3: 5 }), [3, 5])
  // 反过来也一样：事件里是 3，映射表说它显示成 5。
  assert.deepEqual(deletedReplyTurnKeys(session, { 7: 3 }), [3, 7])
  // 无关映射不影响结果。
  assert.deepEqual(deletedReplyTurnKeys(session, { 1: 9 }), [3])
  assert.deepEqual(deletedReplyTurnKeys(session), [3])
})
