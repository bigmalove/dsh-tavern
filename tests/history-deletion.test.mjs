import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { createHistoryDeletion } from '../tavern-plugin/lib/domain/history-deletion.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { floorToken } from '../tavern-plugin/lib/domain/floor-location.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'

function round(session, turn, input, body) {
  appendSessionEvent(session, 'user/message', { id: 'u' + turn, turn, role: 'user', content: [{ type: 'text', text: input }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: body }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

// Two rounds; the latest has two versions and its first version already settled.
function fixture() {
  const session = Session.create('delete-test')
  round(session, 2, '推门', '第一段正文')
  round(session, 3, '继续', '第三段版本B')
  let chat = {
    id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 3,
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 6, checkpoints: [], participants: {}, operations: {}, updatedAt: 0 },
    posture: '', ledger: null, lastSettle: null, settleStatus: 'idle', variables: { hp: 31 },
    messages: [
      { role: 'user', text: '推门' },
      { role: 'assistant', turn: 2, text: '第一段正文', sourceText: '第一段正文', swipes: ['第一段正文'], swipeId: 0, variables: [{ hp: 10 }], swipeStates: [{ posture: '第一段姿势', ledger: null, lastSettle: { ts: 1 }, settleStatus: 'done' }] },
      { role: 'user', text: '继续' },
      {
        role: 'assistant', turn: 3, text: '第三段版本B', sourceText: '第三段版本B',
        swipes: ['第三段版本A', '第三段版本B'], swipeId: 1,
        variables: [{ hp: 20 }, { hp: 31 }],
        swipeStates: [{ posture: '版本A的姿势', ledger: null, lastSettle: null, settleStatus: 'done' }, null]
      }
    ]
  }
  const agent = { get session() { return session }, phase: { kind: 'idle', lastTurn: 3 } }
  const settled = []
  const dispatched = []
  const options = {
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => {} },
    timeline: createStoryTimeline({ id: prefix => prefix + '-fixed', now: () => 5 }),
    activity: () => ({ busy: false }),
    project: async text => projectReplyLayers(text),
    present: async value => structuredClone(value),
    queueSettlement: async id => { settled.push(id) },
    scripts: { dispatchEvent: async event => { dispatched.push(event) } }
  }
  return {
    deletion: createHistoryDeletion(options),
    get chat() { return chat },
    get session() { return session },
    settled, dispatched
  }
}

test('删除最新楼的一个版本：选中邻版本并恢复它自己的结算，不重复结算', async () => {
  const h = fixture()
  const before = structuredClone(h.chat.messages[3])
  await h.deletion.deleteVersion(h.session.id, { index: 3, turn: 3, swipeId: 1, token: floorToken(h.chat, before) })
  const message = h.chat.messages[3]
  assert.deepEqual(message.swipes, ['第三段版本A'])
  assert.equal(message.swipeId, 0)
  assert.equal(message.text, '第三段版本A')
  assert.equal(h.chat.posture, '版本A的姿势')
  assert.equal(h.chat.settleStatus, 'done')
  assert.deepEqual(h.settled, [])
  assert.deepEqual(h.chat.deletionUndo.removed.source, '第三段版本B')
  assert.equal(h.chat.deletionUndo.previousSwipeId, 1)
  assert.equal(h.session.deriveMessages().at(-1).content[0].text, '第三段版本A')
  assert.deepEqual(h.dispatched.map(event => event.name), ['MESSAGE_DELETED'])
})

test('删除旧楼的一个版本只动这一楼，当前姿势与结算不动', async () => {
  const h = fixture()
  h.chat.messages[1].swipes = ['第一段正文', '第一段备选']
  h.chat.messages[1].variables = [{ hp: 10 }, { hp: 11 }]
  h.chat.posture = '当前姿势'
  h.chat.settleStatus = 'done'
  await h.deletion.deleteVersion(h.session.id, { index: 1, turn: 2, swipeId: 1, token: floorToken(h.chat, h.chat.messages[1]) })
  assert.deepEqual(h.chat.messages[1].swipes, ['第一段正文'])
  assert.equal(h.chat.messages[1].text, '第一段正文')
  assert.equal(h.chat.posture, '当前姿势')
  assert.equal(h.chat.settleStatus, 'done')
  assert.equal(h.chat.messages[3].text, '第三段版本B')
})

test('唯一版本、忙碌与过期 token 都拒绝删除版本', async () => {
  const h = fixture()
  const message = h.chat.messages[1]
  await assert.rejects(h.deletion.deleteVersion(h.session.id, { index: 1, turn: 2, swipeId: 0, token: floorToken(h.chat, message) }), /唯一的版本/)
  const latest = h.chat.messages[3]
  await assert.rejects(h.deletion.deleteVersion(h.session.id, { index: 3, turn: 3, swipeId: 0, token: 'stale' }), /已变化/)
  assert.deepEqual(h.chat.messages[3].swipes, ['第三段版本A', '第三段版本B'])
  assert.equal(latest.swipeId, 1)
})

test('删除最后一轮：连同玩家输入一起移除，状态回落到上一轮的快照，可撤销恢复', async () => {
  const h = fixture()
  const before = structuredClone(h.chat)
  const view = await h.deletion.deleteRound(h.session.id, { index: 3, turn: 3, role: 'assistant' })
  assert.equal(view.messages.length, 2)
  assert.deepEqual(h.chat.messages.map(message => message.role), ['user', 'assistant'])
  assert.equal(h.chat.posture, '第一段姿势')
  assert.equal(h.chat.settleStatus, 'done')
  assert.deepEqual(h.chat.variables, { hp: 10 })
  assert.equal(h.chat.deletionUndo.undoable, true)
  assert.deepEqual(h.session.deriveMessages().map(message => message.content[0]?.text), ['推门', '第一段正文', undefined])
  assert.deepEqual(h.dispatched.map(event => event.name), ['MESSAGE_DELETED'])

  const restored = await h.deletion.undo(h.session.id)
  assert.equal(restored.messages.length, 4)
  assert.equal(h.chat.messages[3].text, '第三段版本B')
  assert.equal(h.chat.posture, before.posture)
  assert.deepEqual(h.chat.variables, before.variables)
  assert.equal(h.chat.deletionUndo, undefined)
  assert.deepEqual(h.session.deriveMessages().map(message => message.content[0].text), ['推门', '第一段正文', '继续', '第三段版本B'])
})

test('删除较早的回合不提供撤销（原生消息面无法原地恢复两条消息）', async () => {
  const h = fixture()
  await h.deletion.deleteRound(h.session.id, { index: 1, turn: 2, role: 'assistant' })
  assert.deepEqual(h.chat.messages.map(message => message.role), ['user', 'assistant'])
  assert.equal(h.chat.messages[0].text, '继续')
  assert.equal(h.chat.deletionUndo.undoable, false)
  await assert.rejects(h.deletion.undo(h.session.id), /无法恢复/)
})

test('撤销版本删除：版本、选中项与文字一起回到删除前', async () => {
  const h = fixture()
  const original = structuredClone(h.chat.messages[3])
  await h.deletion.deleteVersion(h.session.id, { index: 3, turn: 3, swipeId: 1, token: floorToken(h.chat, original) })
  assert.equal(h.chat.messages[3].swipeId, 0)
  await h.deletion.undo(h.session.id)
  const message = h.chat.messages[3]
  assert.deepEqual(message.swipes, original.swipes)
  assert.equal(message.swipeId, 1)
  assert.equal(message.text, '第三段版本B')
  assert.equal(message.bodyEdit.id.startsWith('tavern-swipe-restore:'), true)
  assert.equal(h.session.deriveMessages().at(-1).content[0].text, '第三段版本B')
  assert.equal(h.chat.deletionUndo, undefined)
})

test('新回合开始后删除撤销点失效', async () => {
  const h = fixture()
  await h.deletion.deleteVersion(h.session.id, { index: 3, turn: 3, swipeId: 1, token: floorToken(h.chat, h.chat.messages[3]) })
  assert.ok(h.chat.deletionUndo)
  const timeline = createStoryTimeline({ id: prefix => prefix + '-x', now: () => 9 })
  const next = timeline.apply({ chat: h.chat, intent: { kind: 'body.begin', turn: 4, userText: '再走一步' } }).chat
  assert.equal(next.deletionUndo, undefined)
})
