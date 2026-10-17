import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { floorsIndex } from '../tavern-plugin/lib/domain/conversation-fork-targets.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'

// 导入进来的聊天记录没有逐轮的 turn/start：所有玩家输入都落在同一个 native turn 上，
// 而 Chat 侧的楼层仍然按回合分成 1、2。这正是线上那局写作会话的形状。
function importedSession() {
  const session = Session.create('floors-multi-input')
  const input = (id, text) => appendSessionEvent(session, 'user/message',
    { id, turn: 1, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const reply = (id, turn, text) => appendSessionEvent(session, 'assistant/message',
    { turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } },
    { surfaceOp: 'append', sourceEventSeqs: [] })
  input('import:2', '第一条输入')
  reply('import:3', 1, '第一段正文')
  input('import:4', '第二条输入')
  reply('import:5', 2, '第二段正文')
  const chat = {
    id: 'chat', sessionId: session.id, mode: 'writing', _storageRevision: 3,
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 4, checkpoints: [], participants: {}, operations: {}, updatedAt: 0 },
    messages: [
      { role: 'user', text: '第一条输入' },
      { role: 'assistant', turn: 1, text: '第一段正文', sourceText: '第一段正文' },
      { role: 'user', text: '第二条输入' },
      { role: 'assistant', turn: 2, text: '第二段正文', sourceText: '第二段正文' }
    ]
  }
  return { session, chat }
}

function seqOf(session, id) {
  for (const event of sessionEvents(session)) {
    if (event.data?.id === id || event.data?.message?.id === id) return event.seq
  }
  throw new Error('节点不存在: ' + id)
}

test('同一 native turn 里的多条玩家输入各自成楼，后一条不会被前一条抢走', () => {
  const { session, chat } = importedSession()
  const { byMessageId, bySeq } = floorsIndex(chat, session, { busy: false })

  assert.equal(byMessageId['import:2'].index, 0)
  assert.equal(byMessageId['import:4'].index, 2, '第二条输入必须指向自己那一楼')

  // 页面上玩家节点只带 seq：按 seq 查到的楼层也必须是它自己那一条。
  assert.equal(bySeq[String(seqOf(session, 'import:2'))].index, 0)
  assert.equal(bySeq[String(seqOf(session, 'import:4'))].index, 2)

  // 两条输入分属不同回合，楼层事实不能混。
  assert.equal(byMessageId['import:2'].turn, 1)
  assert.equal(byMessageId['import:4'].turn, 2)
  assert.notEqual(byMessageId['import:2'].token, byMessageId['import:4'].token)
})

test('助手楼层不受影响：各自对上自己的回合', () => {
  const { session, chat } = importedSession()
  const { byMessageId } = floorsIndex(chat, session, { busy: false })
  assert.equal(byMessageId['import:3'].index, 1)
  assert.equal(byMessageId['import:5'].index, 3)
  assert.equal(byMessageId['import:5'].latest, true)
  assert.equal(byMessageId['import:3'].latest, false)
})

test('正文编辑替换了输入节点之后，剩下的楼层仍然各归各位', () => {
  const { session, chat } = importedSession()
  // 编辑第二条输入：宿主在 surface 上用新节点替换原节点。
  const original = seqOf(session, 'import:4')
  replaceSessionSurface(session, 'user/message',
    { id: 'tavern-body-edit:1', role: 'user', content: [{ type: 'text', text: '改过的第二条' }], source: { kind: 'user' } },
    { start: original, end: original, sourceEventSeqs: [original] })
  const edited = { ...chat, messages: chat.messages.map((message, index) =>
    index === 2 ? { ...message, text: '改过的第二条' } : message) }

  const { byMessageId, bySeq } = floorsIndex(edited, session, { busy: false })
  assert.equal(byMessageId['tavern-body-edit:1'].index, 2)
  assert.equal(bySeq[String(seqOf(session, 'tavern-body-edit:1'))].index, 2)
  // 被顶替掉的旧节点绝不能挂到第一条输入那一楼上。
  assert.notEqual(byMessageId['import:4']?.index, 0)
  assert.notEqual(bySeq[String(original)]?.index, 0)
  assert.equal(byMessageId['import:2'].index, 0)
})

// 回归：替换节点追加在日志末尾（seq 最大），在 surface 上却顶替中间那一条。
// 按事件序号配对会把它排到最后，之后每条输入都错开一格——下一次编辑就打到邻层。
test('编辑中间一条输入之后，后面的输入楼层不错位', () => {
  const session = Session.create('floors-middle-edit')
  const input = (id, text) => appendSessionEvent(session, 'user/message',
    { id, turn: 1, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const reply = (id, turn, text) => appendSessionEvent(session, 'assistant/message',
    { turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } },
    { surfaceOp: 'append', sourceEventSeqs: [] })
  input('in:1', '一'); reply('re:1', 1, '甲')
  input('in:2', '二'); reply('re:2', 2, '乙')
  input('in:3', '三'); reply('re:3', 3, '丙')
  const middle = seqOf(session, 'in:2')
  replaceSessionSurface(session, 'user/message',
    { id: 'tavern-body-edit:mid', role: 'user', content: [{ type: 'text', text: '改过的二' }], source: { kind: 'user' } },
    { start: middle, end: middle, sourceEventSeqs: [middle] })
  const chat = {
    id: 'chat', sessionId: session.id, mode: 'writing', _storageRevision: 3,
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 4, checkpoints: [], participants: {}, operations: {}, updatedAt: 0 },
    messages: [
      { role: 'user', text: '一' }, { role: 'assistant', turn: 1, text: '甲' },
      { role: 'user', text: '改过的二' }, { role: 'assistant', turn: 2, text: '乙' },
      { role: 'user', text: '三' }, { role: 'assistant', turn: 3, text: '丙' }
    ]
  }
  const { bySeq } = floorsIndex(chat, session, { busy: false })
  assert.ok(seqOf(session, 'tavern-body-edit:mid') > seqOf(session, 'in:3'), '前提：替换节点的 seq 排在后面的输入之后')
  assert.equal(bySeq[String(seqOf(session, 'in:1'))].index, 0)
  assert.equal(bySeq[String(seqOf(session, 'tavern-body-edit:mid'))].index, 2)
  assert.equal(bySeq[String(seqOf(session, 'in:3'))].index, 4, '第三条输入必须仍指向自己那一楼')
})

// 宿主聊天页只渲染 append 来源的节点，替换副本只给模型看。页面上那一楼带的永远是
// 原始 seq：楼层表必须按原始 seq 也查得到，并把编辑后的文字带给页面。
// 否则改完页面不变，刷新后按钮消失（线上会话 session-90a0bc15 正是这样）。
test('编辑过的玩家输入：按页面上的原始 seq 查得到楼层，并带回编辑后的文字', () => {
  const { session, chat } = importedSession()
  const original = seqOf(session, 'import:4')
  replaceSessionSurface(session, 'user/message',
    { id: 'tavern-body-edit:2', role: 'user', content: [{ type: 'text', text: '改过的第二条' }], source: { kind: 'user' } },
    { start: original, end: original, sourceEventSeqs: [original] })
  const edited = { ...chat, messages: chat.messages.map((message, index) => index === 2 ? { ...message, text: '改过的第二条' } : message) }
  const { bySeq } = floorsIndex(edited, session, { busy: false })
  assert.equal(bySeq[String(original)]?.index, 2, '页面节点的原始 seq 必须查得到这一楼')
  assert.equal(bySeq[String(original)].text, '改过的第二条')
  assert.equal(bySeq[String(seqOf(session, 'import:2'))].text, undefined, '没编辑过的楼层不带文字，照常显示原节点')
})
