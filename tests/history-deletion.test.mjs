import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { createHistoryDeletion } from '../tavern-plugin/lib/domain/history-deletion.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { floorToken } from '../tavern-plugin/lib/domain/floor-location.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'

function round(session, turn, input, body) {
  appendSessionEvent(session, 'user/message', { id: 'u' + turn, turn, role: 'user', content: [{ type: 'text', text: input }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: body }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

// greeting (two openings) + two rounds; the latest round has two versions and
// its first version already settled.
function fixture({ greeting = true } = {}) {
  const session = Session.create('delete-test')
  if (greeting) appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'opening', role: 'assistant', content: [{ type: 'text', text: '开场白' }], source: { kind: 'model', provider: 'dsh-tavern', model: 'character-card' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  round(session, 2, '推门', '第一段正文')
  round(session, 3, '继续', '第三段版本B')
  let chat = {
    id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 3,
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 6, checkpoints: [], participants: { background: { role: 'background', lifetime: 'chat', sessionId: 'bg', status: 'ready', boundary: 4 } }, operations: {}, updatedAt: 0 },
    posture: '', ledger: null, lastSettle: null, settleStatus: 'idle', variables: { hp: 31 },
    ...(greeting ? { openingText: '开场白' } : {}),
    messages: [
      ...(greeting ? [{ role: 'assistant', greeting: true, text: '开场白', sourceText: '开场白', swipes: ['开场白', '备用开场'], swipeId: 0 }] : []),
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
  const base = greeting ? 1 : 0
  return {
    deletion: createHistoryDeletion(options),
    get chat() { return chat },
    get session() { return session },
    settled, dispatched, base
  }
}

const texts = session => session.deriveMessages().map(message => message.content[0]?.text)

test('删除最新回复：只移除这一条，玩家输入保留，状态回落到上一条回复的快照', async () => {
  const h = fixture()
  const before = structuredClone(h.chat)
  const view = await h.deletion.deleteMessage(h.session.id, { index: 4, turn: 3, role: 'assistant' })
  // 这一轮只少了回复，玩家输入「继续」仍在。
  assert.deepEqual(view.messages.map(message => message.role), ['assistant', 'user', 'assistant', 'user'])
  assert.equal(view.messages[3].text, '继续')
  assert.equal(view.messages.length, 4)
  assert.equal(h.chat.posture, '第一段姿势')
  assert.equal(h.chat.settleStatus, 'done')
  assert.deepEqual(h.chat.variables, { hp: 10 })
  assert.equal(h.chat.deletionUndo.kind, 'message')
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', '继续', undefined])
  assert.deepEqual(h.dispatched.map(event => event.name), ['MESSAGE_DELETED'])

  const restored = await h.deletion.undo(h.session.id)
  assert.equal(restored.messages.length, 5)
  assert.equal(restored.messages[4].text, '第三段版本B')
  assert.deepEqual(restored.messages[4].swipes, before.messages[4].swipes)
  assert.equal(restored.posture, before.posture)
  assert.equal(restored.settleStatus, before.settleStatus)
  assert.deepEqual(restored.variables, before.variables)
  assert.equal(h.chat.deletionUndo, undefined)
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', '继续', '第三段版本B'])
})

test('删除旧回复：只移除这一楼，当前姿势、结算与变量不动', async () => {
  const h = fixture()
  h.chat.posture = '当前姿势'
  h.chat.settleStatus = 'done'
  await h.deletion.deleteMessage(h.session.id, { index: 2, turn: 2, role: 'assistant' })
  assert.deepEqual(h.chat.messages.map(message => message.role), ['assistant', 'user', 'user', 'assistant'])
  assert.equal(h.chat.posture, '当前姿势')
  assert.equal(h.chat.settleStatus, 'done')
  assert.equal(h.chat.messages.at(-1).text, '第三段版本B')
  assert.deepEqual(texts(h.session), ['开场白', '推门', undefined, '继续', '第三段版本B'])
})

test('删除玩家输入：回复和相邻楼层都保留', async () => {
  const h = fixture()
  h.chat.posture = '当前姿势'
  h.chat.settleStatus = 'done'
  await h.deletion.deleteMessage(h.session.id, { index: 3, turn: 3, role: 'user' })
  assert.deepEqual(h.chat.messages.map(message => message.role), ['assistant', 'user', 'assistant', 'assistant'])
  assert.equal(h.chat.messages.at(-1).text, '第三段版本B')
  assert.equal(h.chat.posture, '当前姿势')
  assert.equal(h.chat.settleStatus, 'done')
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', undefined, '第三段版本B'])

  await h.deletion.undo(h.session.id)
  assert.deepEqual(h.chat.messages.map(message => message.role), ['assistant', 'user', 'assistant', 'user', 'assistant'])
  assert.equal(h.chat.messages[3].text, '继续')
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', '继续', '第三段版本B'])
})

test('删除开场白：只移除开场白，版本与后续楼层不动', async () => {
  const h = fixture()
  const before = structuredClone(h.chat)
  await h.deletion.deleteMessage(h.session.id, { index: 0, turn: 1, role: 'assistant' })
  assert.deepEqual(h.chat.messages.map(message => message.role), ['user', 'assistant', 'user', 'assistant'])
  assert.deepEqual(h.chat.messages[1].swipes, ['第一段正文'])
  assert.equal(h.chat.posture, before.posture)
  assert.equal(h.chat.openingText, '')
  assert.deepEqual(texts(h.session), [undefined, '推门', '第一段正文', '继续', '第三段版本B'])

  await h.deletion.undo(h.session.id)
  assert.deepEqual(h.chat.messages[0].swipes, ['开场白', '备用开场'])
  assert.equal(h.chat.openingText, '开场白')
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', '继续', '第三段版本B'])
})

test('唯一版本提示改为删除整条消息，不会动别的楼层', async () => {
  const h = fixture()
  await assert.rejects(h.deletion.deleteVersion(h.session.id, { index: 2, turn: 2, swipeId: 0, token: floorToken(h.chat, h.chat.messages[2]) }), /请删除这条消息/)
  assert.equal(h.chat.messages.length, 5)
})

test('忙碌、过期 token 与不在上下文里的消息都拒绝删除', async () => {
  const h = fixture()
  const message = h.chat.messages[4]
  await assert.rejects(h.deletion.deleteVersion(h.session.id, { index: 4, turn: 3, swipeId: 0, token: 'stale' }), /已变化/)
  // 摘掉这一楼的原生节点：既是压缩后的情形，也让定位失败。
  const seq = h.session.surface.nodes[4]
  h.session.surface.nodes.splice(4, 1)
  await assert.rejects(h.deletion.deleteMessage(h.session.id, { index: 4, turn: 3, role: 'assistant' }), /不在当前模型上下文/)
  assert.equal(h.chat.messages.length, 5)
  assert.ok(seq >= 0)
  assert.deepEqual(h.chat.messages[4].swipes, message.swipes)
})

test('撤销版本删除：版本、选中项与文字一起回到删除前', async () => {
  const h = fixture()
  const original = structuredClone(h.chat.messages[4])
  await h.deletion.deleteVersion(h.session.id, { index: 4, turn: 3, swipeId: 1, token: floorToken(h.chat, original) })
  assert.equal(h.chat.messages[4].swipeId, 0)
  assert.equal(h.chat.posture, '版本A的姿势')
  assert.deepEqual(h.settled, [])
  await h.deletion.undo(h.session.id)
  const message = h.chat.messages[4]
  assert.deepEqual(message.swipes, original.swipes)
  assert.equal(message.swipeId, 1)
  assert.equal(message.text, '第三段版本B')
  assert.equal(message.bodyEdit.id.startsWith('tavern-swipe-restore:'), true)
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', '继续', '第三段版本B'])
  assert.equal(h.chat.deletionUndo, undefined)
})

test('删除版本后仍然只影响这一楼：玩家输入与其它楼层都在', async () => {
  const h = fixture()
  await h.deletion.deleteVersion(h.session.id, { index: 4, turn: 3, swipeId: 1, token: floorToken(h.chat, h.chat.messages[4]) })
  assert.deepEqual(h.chat.messages.map(message => message.role), ['assistant', 'user', 'assistant', 'user', 'assistant'])
  assert.equal(h.chat.messages[3].text, '继续')
  assert.equal(h.chat.messages[2].text, '第一段正文')
})

test('新回合开始后删除撤销点失效', async () => {
  const h = fixture()
  await h.deletion.deleteMessage(h.session.id, { index: 4, turn: 3, role: 'assistant' })
  assert.ok(h.chat.deletionUndo)
  const timeline = createStoryTimeline({ id: prefix => prefix + '-x', now: () => 9 })
  const next = timeline.apply({ chat: h.chat, intent: { kind: 'body.begin', turn: 4, userText: '再走一步' } }).chat
  assert.equal(next.deletionUndo, undefined)
})

// 导入/救援的存档：原生节点是「先 append 一条不带 turn 的 player 输入，再开回合」，
// 与真实会话一致。删除玩家输入必须按楼层表定位，不能拿上一个 turn/start 当回合。
function importedRound(session, turn, text, body) {
  appendSessionEvent(session, 'user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/start', { turn })
  appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: body }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
}

// 两段玩家输入连着写、后面才开一个回合：导入记录的另一种常见形状。
function importedRunRound(session, turn, inputs, body) {
  for (const [offset, text] of inputs.entries()) {
    appendSessionEvent(session, 'user/message', { id: 'u' + turn + '-' + offset, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  }
  appendSessionEvent(session, 'turn/start', { turn })
  appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: body }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
}

function importedFixture({ inputs }) {
  const session = Session.create('delete-import')
  appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'opening', role: 'assistant', content: [{ type: 'text', text: '开场白' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  importedRound(session, 2, '推门', '第一段正文')
  if (inputs.length > 1) importedRunRound(session, 3, inputs, '第二段正文')
  else importedRound(session, 3, inputs[0], '第二段正文')
  let chat = {
    id: 'chat-import', sessionId: session.id, mode: 'story', _storageRevision: 3,
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 6, checkpoints: [], participants: { background: { role: 'background', lifetime: 'chat', sessionId: 'bg', status: 'ready', boundary: 4 } }, operations: {}, updatedAt: 0 },
    posture: '', ledger: null, lastSettle: null, settleStatus: 'idle', variables: { hp: 31 },
    openingText: '开场白',
    messages: [
      { role: 'assistant', greeting: true, text: '开场白', sourceText: '开场白', swipes: ['开场白'], swipeId: 0 },
      { role: 'user', text: '推门' },
      { role: 'assistant', turn: 2, text: '第一段正文', sourceText: '第一段正文', swipes: ['第一段正文'], swipeId: 0 },
      ...inputs.map(text => ({ role: 'user', text })),
      { role: 'assistant', turn: 3, text: '第二段正文', sourceText: '第二段正文', swipes: ['第二段正文'], swipeId: 0 }
    ]
  }
  const agent = { get session() { return session }, phase: { kind: 'idle', lastTurn: 3 } }
  const options = {
    // 生产装配里删除也会拿到完整 Chat（completeForSession），楼层表按它的下标配对。
    chats: { forSession: async () => structuredClone(chat), completeForSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => {} },
    timeline: createStoryTimeline({ id: prefix => prefix + '-fixed', now: () => 5 }),
    activity: () => ({ busy: false }),
    project: async text => projectReplyLayers(text),
    present: async value => structuredClone(value),
    queueSettlement: async () => {},
    scripts: { dispatchEvent: async () => {} }
  }
  return {
    deletion: createHistoryDeletion(options),
    get chat() { return chat },
    get session() { return session }
  }
}

test('导入存档：输入写在 turn/start 之前，删除玩家输入照样定位到这一条', async () => {
  const h = importedFixture({ inputs: ['继续'] })
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', '继续', '第二段正文'])
  await h.deletion.deleteMessage(h.session.id, { index: 3, turn: 3, role: 'user' })
  assert.deepEqual(h.chat.messages.map(message => message.role), ['assistant', 'user', 'assistant', 'assistant'])
  // 删掉的是「继续」，相邻的推门与两段正文都还在。
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', undefined, '第二段正文'])
  assert.equal(h.chat.messages[3].text, '第二段正文')

  await h.deletion.undo(h.session.id)
  assert.deepEqual(h.chat.messages.map(message => message.role), ['assistant', 'user', 'assistant', 'user', 'assistant'])
  assert.equal(h.chat.messages[3].text, '继续')
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', '继续', '第二段正文'])
})

test('导入存档：同一回合连着两条玩家输入，删除靠前那条不会打到后面一条', async () => {
  const h = importedFixture({ inputs: ['继续', '再来'] })
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', '继续', '再来', '第二段正文'])
  await h.deletion.deleteMessage(h.session.id, { index: 3, turn: 3, role: 'user' })
  assert.deepEqual(h.chat.messages.map(message => message.role), ['assistant', 'user', 'assistant', 'user', 'assistant'])
  assert.equal(h.chat.messages[3].text, '再来')
  assert.deepEqual(texts(h.session), ['开场白', '推门', '第一段正文', undefined, '再来', '第二段正文'])

  await h.deletion.undo(h.session.id)
  assert.equal(h.chat.messages[3].text, '继续')
  assert.equal(h.chat.messages[4].text, '再来')
})
