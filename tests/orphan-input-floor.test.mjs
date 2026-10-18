import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { createSessionSurfaceMutator } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { floorsIndex } from '../tavern-plugin/lib/domain/conversation-fork-targets.js'
import { createBodyEditor } from '../tavern-plugin/lib/domain/body-editor.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createHistoryDeletion } from '../tavern-plugin/lib/domain/history-deletion.js'

// 导入形态：输入写在 turn/start 之前，输入本身不带 turn。
function round(session, turn, input, body) {
  appendSessionEvent(session, 'user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: input }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/start', { turn })
  appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: body }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
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

// 回合 3 的回复被删掉后，玩家输入「继续」还在存档里，但下一条消息已经没有 turn 可读。
function orphanFixture() {
  const session = Session.create('orphan-input')
  round(session, 2, '推门', '第一段正文')
  round(session, 3, '继续', '第二段正文')
  marker(session, seqOf(session, 'a3'), 'mark-a3')
  let chat = {
    id: 'chat-orphan', sessionId: session.id, mode: 'story', _storageRevision: 3,
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 6, checkpoints: [], participants: {}, operations: {}, updatedAt: 0 },
    posture: '', ledger: null, lastSettle: null, settleStatus: 'idle',
    messages: [
      { role: 'user', text: '推门' },
      { role: 'assistant', turn: 2, text: '第一段正文', sourceText: '第一段正文', swipes: ['第一段正文'], swipeId: 0 },
      { role: 'user', text: '继续' }
    ]
  }
  const agent = { get session() { return session }, phase: { kind: 'idle', lastTurn: 3 } }
  const chats = {
    forSession: async () => structuredClone(chat),
    completeForSession: async () => structuredClone(chat),
    update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) }
  }
  const options = {
    chats, sessions: { get: () => agent, flush: async () => {} },
    timeline: createStoryTimeline({ id: prefix => prefix + '-fixed', now: () => 5 }),
    activity: () => ({ busy: false }),
    project: async text => projectReplyLayers(text),
    present: async value => structuredClone(value),
    queueSettlement: async () => {}, scripts: { dispatchEvent: async () => {} }
  }
  return { session, chats, options, agent, get chat() { return chat } }
}

test('回复被单独删掉后，剩下的玩家输入仍报出自己那一回合（不是 0）', () => {
  const h = orphanFixture()
  const floors = floorsIndex(h.chat, h.session, { busy: false })
  const lastInput = Object.values(floors.bySeq).find(floor => floor.index === 2 && floor.role === 'user')
  assert.ok(lastInput, '玩家输入应当仍在楼层表里')
  assert.equal(lastInput.turn, 3, '回合来自原生 turn/start，不能退化成 0')
})

test('回复被单独删掉后，这条玩家输入还能编辑', async () => {
  const h = orphanFixture()
  const editor = createBodyEditor(h.options)
  const floors = floorsIndex(h.chat, h.session, { busy: false })
  const floor = Object.values(floors.bySeq).find(item => item.index === 2 && item.role === 'user')
  const read = await editor.read(h.session.id, { index: floor.index, turn: floor.turn, role: 'user' })
  assert.equal(read.parts.filter(part => part.kind === 'text')[0].text, '继续')
  const saved = await editor.save(h.session.id, {
    token: read.token, index: read.index, turn: read.turn, role: 'user', latest: read.latest === true, texts: ['继续走']
  })
  assert.equal(saved.messages[2].text, '继续走')
})

test('回复被单独删掉后，这条玩家输入还能删除并撤销', async () => {
  const h = orphanFixture()
  const deletion = createHistoryDeletion(h.options)
  const floors = floorsIndex(h.chat, h.session, { busy: false })
  const floor = Object.values(floors.bySeq).find(item => item.index === 2 && item.role === 'user')
  await deletion.deleteMessage(h.session.id, { index: floor.index, turn: floor.turn, role: 'user', seq: floor.seq })
  assert.deepEqual(h.chat.messages.map(message => message.role), ['user', 'assistant'])
  await deletion.undo(h.session.id)
  assert.equal(h.chat.messages[2].text, '继续')
})
