import test from 'node:test'
import assert from 'node:assert/strict'
import { planFailedTurnSurface, rollbackAvailability, clearRegenerationAttemptSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'

const user = (id, plugin) => ({ id, role: 'user', content: [{ type: 'text', text: id }], source: plugin ? { kind: 'plugin', plugin } : { kind: 'user' } })
const body = (id, turn) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text: id }], source: { kind: 'model', provider: 'test', model: 'test' } } })
// The terminal submit_story shape: a model call that carries the body, the durable
// call record, and the receipt whose text is the body the tool returned.
const storyCall = (id, turn, callId, content) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'tool-call', id: callId, name: 'submit_story', arguments: JSON.stringify({ content }) }], source: { kind: 'model', provider: 'test', model: 'test' } } })
const storyReceipt = (id, turn, callId, text) => ({ turn, step: 1, message: { id, role: 'user', content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text }] }], source: { kind: 'tool', callId } } })
const storyBody = (session, turn, callId, content) => {
  const call = appendSessionEvent(session, 'assistant/message', storyCall('call-' + callId, turn, callId, content), { surfaceOp: 'append' })
  appendSessionEvent(session, 'tool/call', { turn, step: 1, callId, name: 'submit_story', arguments: JSON.stringify({ content }) })
  const receipt = appendSessionEvent(session, 'tool/result', storyReceipt('receipt-' + callId, turn, callId, content), { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  return { call, receipt }
}
const storyTurn = (session, turn, callId, content) => {
  appendSessionEvent(session, 'turn/start', { turn })
  const result = storyBody(session, turn, callId, content)
  appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
  return result
}
function fixture() {
  const session = Session.create('surface-recovery')
  const context = appendSessionEvent(session, 'user/message', user('historical-context', 'context-provider'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', body('old-body', 1), { surfaceOp: 'append' })
  const start = appendSessionEvent(session, 'turn/start', { turn: 2 })
  const refreshed = replaceSessionSurface(session, 'user/message', user('refreshed-context', 'context-provider'), { start: context.seq, end: context.seq, sourceEventSeqs: [context.seq] })
  const input = appendSessionEvent(session, 'user/message', user('attempt', 'dsh-tavern-regen'), { surfaceOp: 'append' })
  const reply = appendSessionEvent(session, 'assistant/message', body('partial', 2), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'error' } })
  return { session, eventStart: start.seq, refreshed, input, reply }
}

test('归属跨回合混合或来源残缺时，清理拒绝写入', () => {
  for (const corrupt of ['mixed', 'missing', 'missing-all', 'forward']) {
    const f = fixture()
    const events = sessionEvents(f.session).map(event => structuredClone(event))
    const replacement = { seq: events.at(-1).seq + 1, type: 'assistant/message', data: body('replacement', 2),
      surfaceOp: { op: 'replace', start: f.reply.seq, end: f.reply.seq },
      sourceEventSeqs: corrupt === 'missing-all' ? [] : corrupt === 'mixed' ? [f.reply.seq, 1] : corrupt === 'missing' ? [f.reply.seq, 999] : [f.reply.seq, events.at(-1).seq + 1] }
    events.push(replacement)
    const nodes = f.session.surface.nodes.map(seq => seq === f.reply.seq ? replacement.seq : seq)
    const session = { events, surface: { nodes }, append() { assert.fail('unsafe recovery must not write') } }
    assert.throws(() => clearRegenerationAttemptSurface({ session, eventStart: f.eventStart }), /无法安全清理/)
    assert.throws(() => planFailedTurnSurface({ events, nodes, turn: 2 }), /无法安全清理/)
    const state = rollbackAvailability({ messages: [{ role: 'assistant', turn: 1 }] }, { events, nodes })
    assert.equal(state.canRollback, false)
  }
})

test('旧正文与重新生成之间夹着别处写入的消息（如卡片脚本消息）时，保留它并完成替换', async () => {
  const { planRegenerationSurface, regenerationProjection, applyRegenerationProjection } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const session = Session.create('regen-foreign')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  const input = appendSessionEvent(session, 'user/message', user('input-1'), { surfaceOp: 'append' })
  const old = appendSessionEvent(session, 'assistant/message', body('old', 1), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  const script = appendSessionEvent(session, 'user/message', user('script-message', 'dsh-tavern-helper'), { surfaceOp: 'append' })
  const eventStart = sessionEvents(session).length
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  appendSessionEvent(session, 'user/message', user('regen', 'dsh-tavern-regen'), { surfaceOp: 'append' })
  const fresh = appendSessionEvent(session, 'assistant/message', body('new', 2), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } })
  const plan = planRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes, oldAssistantSeq: old.seq, eventStart })
  assert.deepEqual([plan.start, plan.end], [old.seq, old.seq])
  assert.equal(plan.cleanups.length, 1)
  assert.equal(plan.cleanups[0].end, fresh.seq)
  const projection = regenerationProjection(plan, { turn: 1, step: 1, message: { id: 'tavern-regen:op', role: 'assistant', content: [{ type: 'text', text: 'new' }], source: { kind: 'model', provider: 'test', model: 'test' } } }, 'op')
  applyRegenerationProjection(session, projection)
  applyRegenerationProjection(session, projection) // a retry after a crash writes nothing twice
  const visible = session.surface.nodes.map(seq => sessionEvents(session).find(event => event.seq === seq))
  assert.deepEqual(visible.map(event => event.data.message?.id ?? event.data.id), ['input-1', 'tavern-regen:op', 'script-message', 'tavern-regen-cleanup:op:0'])
  assert.equal(visible[2].seq, script.seq)
  assert.equal(input.seq, session.surface.nodes[0])
  // Another round's story reply in between is still never stepped over.
  const other = Session.create('regen-story-between')
  appendSessionEvent(other, 'user/message', user('input-1'), { surfaceOp: 'append' })
  const first = appendSessionEvent(other, 'assistant/message', body('old', 1), { surfaceOp: 'append' })
  appendSessionEvent(other, 'assistant/message', body('other-round', 5), { surfaceOp: 'append' })
  const start = sessionEvents(other).length
  appendSessionEvent(other, 'turn/start', { turn: 6 })
  appendSessionEvent(other, 'user/message', user('regen', 'dsh-tavern-regen'), { surfaceOp: 'append' })
  appendSessionEvent(other, 'assistant/message', body('new', 6), { surfaceOp: 'append' })
  appendSessionEvent(other, 'turn/end', { turn: 6, reason: { kind: 'completed' } })
  assert.throws(() => planRegenerationSurface({ events: sessionEvents(other), nodes: other.surface.nodes, oldAssistantSeq: first.seq, eventStart: start }), /归属不一致/)
})

test('工具正文折叠成一条正文后，重新生成能整轮替换', async () => {
  const { foldStorySubmission } = await import('../tavern-plugin/lib/domain/story-tool-submission.js')
  const { planRegenerationSurface, locateRollbackSurface } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const session = Session.create('regen-story-folded')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  const input = appendSessionEvent(session, 'user/message', user('input-1'), { surfaceOp: 'append' })
  const submit = (turn, callId, text) => {
    const call = appendSessionEvent(session, 'assistant/message', storyCall('call-' + callId, turn, callId, text), { surfaceOp: 'append' })
    appendSessionEvent(session, 'tool/call', { turn, step: 1, callId, name: 'submit_story', arguments: JSON.stringify({ content: text }) })
    const receipt = appendSessionEvent(session, 'tool/result', storyReceipt('receipt-' + callId, turn, callId, text), { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    foldStorySubmission(session, { event: call, index: 0, receiptIndex: receipt.seq }, text)
    return { call, receipt }
  }
  const old = submit(1, 'old', '旧正文')
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  // 折叠后只剩玩家输入与一条普通正文，回执不再占用消息面。
  const folded = session.surface.nodes.map(Number)
  assert.equal(folded.length, 2)
  assert.ok(!folded.includes(old.call.seq) && !folded.includes(old.receipt.seq))
  const rollback = locateRollbackSurface({ events: sessionEvents(session), nodes: session.surface.nodes })
  assert.equal(rollback.endSeq, folded[1])

  const eventStart = sessionEvents(session).length
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  const regen = appendSessionEvent(session, 'user/message', user('regen', 'dsh-tavern-regen'), { surfaceOp: 'append' })
  const fresh = submit(2, 'new', '新正文')
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } })

  const nodes = session.surface.nodes.map(Number)
  assert.deepEqual(nodes, [input.seq, folded[1], regen.seq, nodes.at(-1)])
  const plan = planRegenerationSurface({ events: sessionEvents(session), nodes, oldAssistantSeq: folded[1], eventStart })
  assert.equal(plan.start, folded[1])
  assert.equal(plan.end, nodes.at(-1))
  // 旧回执早已在折叠时被遮蔽，清理范围里不得出现孤儿回执。
  assert.ok(!plan.shadowedSeqs.includes(fresh.receipt.seq))
})

// 端到端：一个「正文走工具调用」的回合被重新生成后，新正文必须有一份 append
// 原件留在表面上 —— 对话页只画 append，替换件它不画。
test('工具回合重新生成后，新正文在对话页可画', async () => {
  const { foldStorySubmission } = await import('../tavern-plugin/lib/domain/story-tool-submission.js')
  const { planRegenerationSurface, applyRegenerationProjection, regenerationProjection } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const session = Session.create('tool-round-regen')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  const input = appendSessionEvent(session, 'user/message', user('input-1'), { surfaceOp: 'append' })
  const submit = (turn, callId, text) => {
    const call = appendSessionEvent(session, 'assistant/message', storyCall('call-' + callId, turn, callId, text), { surfaceOp: 'append' })
    appendSessionEvent(session, 'tool/call', { turn, step: 1, callId, name: 'submit_story', arguments: JSON.stringify({ content: text }) })
    const receipt = appendSessionEvent(session, 'tool/result', storyReceipt('receipt-' + callId, turn, callId, text), { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    foldStorySubmission(session, { event: call, index: 0, receiptIndex: receipt.seq }, text)
    return { call, receipt }
  }
  submit(1, 'old', '旧正文')
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  const folded = session.surface.nodes.map(Number)

  const eventStart = sessionEvents(session).length
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  appendSessionEvent(session, 'user/message', user('regen', 'dsh-tavern-regen'), { surfaceOp: 'append' })
  submit(2, 'new', '新正文')
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } })

  const replacement = planRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes,
    oldAssistantSeq: folded[1], eventStart })
  const projection = regenerationProjection(replacement, {
    turn: 1, step: 1,
    message: { id: 'tavern-regen:op', role: 'assistant', content: [{ type: 'text', text: '新正文' }],
      source: { kind: 'model', provider: 'test', model: 'test', tavernStoryTurn: 1 } },
  }, 'op')
  applyRegenerationProjection(session, projection)

  const events = sessionEvents(session)
  // 对话页取的是 append 原件（即便随后被 replace 遮蔽，宿主仍为它建过行），
  // 所以判据是「日志里存在带这段正文的 append」，不看它还在不在表面上。
  const drawable = events.filter(event => event.type === 'assistant/message' && event.surfaceOp === 'append' &&
    (event.data?.message?.content || []).some(block => block?.type === 'text' && block.text === '新正文'))
  assert.equal(drawable.length, 1, '必须恰好有一份可画的「新正文」')
})

// 折叠输给写入句柄时会缺席：那一轮只有 replace，日志里没有任何 append 正文。
// 这时重新生成必须自己补一份，否则对话页两边都看不见（原来的 bug）。
test('工具回合折叠缺席时，重新生成补出可画正文', async () => {
  const { planRegenerationSurface, applyRegenerationProjection, regenerationProjection } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const session = Session.create('tool-round-no-fold')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  const input = appendSessionEvent(session, 'user/message', user('input-1'), { surfaceOp: 'append' })
  // 只有替换件，没有 append 副本 —— 正是折叠缺席的样子。
  const call = appendSessionEvent(session, 'assistant/message', storyCall('call-old', 1, 'c1', '旧正文'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'submit_story', arguments: '{"content":"旧正文"}' })
  const receipt = appendSessionEvent(session, 'tool/result', storyReceipt('receipt-old', 1, 'c1', '旧正文'), { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  const shadow = { start: call.seq, end: receipt.seq, sourceEventSeqs: [call.seq, receipt.seq] }
  replaceSessionSurface(session, 'assistant/message', { turn: 1, step: 1,
    message: { id: 'fold-only', role: 'assistant', content: [{ type: 'text', text: '旧正文' }],
      source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' } } }, shadow)
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(sessionEvents(session).filter(e => e.type === 'assistant/message' && e.surfaceOp === 'append' &&
    (e.data?.message?.content || []).some(b => b?.type === 'text' && b.text === '旧正文')).length, 0)

  const eventStart = sessionEvents(session).length
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  appendSessionEvent(session, 'user/message', user('regen', 'dsh-tavern-regen'), { surfaceOp: 'append' })
  const freshCall = appendSessionEvent(session, 'assistant/message', storyCall('call-new', 2, 'c2', '新正文'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'tool/call', { turn: 2, step: 1, callId: 'c2', name: 'submit_story', arguments: '{"content":"新正文"}' })
  const freshReceipt = appendSessionEvent(session, 'tool/result', storyReceipt('receipt-new', 2, 'c2', '新正文'), { surfaceOp: 'append', sourceEventSeqs: [freshCall.seq] })
  replaceSessionSurface(session, 'assistant/message', { turn: 2, step: 1,
    message: { id: 'fold-new', role: 'assistant', content: [{ type: 'text', text: '新正文' }],
      source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' } } },
    { start: freshCall.seq, end: freshReceipt.seq, sourceEventSeqs: [freshCall.seq, freshReceipt.seq] })
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } })

  const oldFold = session.surface.nodes.map(Number).find(seq => seq === sessionEvents(session)
    .find(e => e.data?.message?.id === 'fold-only')?.seq)
  const replacement = planRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes,
    oldAssistantSeq: oldFold, eventStart })
  const projection = regenerationProjection(replacement, {
    turn: 1, step: 1,
    message: { id: 'tavern-regen:op', role: 'assistant', content: [{ type: 'text', text: '重写正文' }],
      source: { kind: 'model', provider: 'test', model: 'test', tavernStoryTurn: 1 } },
  }, 'op')
  applyRegenerationProjection(session, projection)

  const drawable = sessionEvents(session).filter(e => e.type === 'assistant/message' && e.surfaceOp === 'append' &&
    (e.data?.message?.content || []).some(b => b?.type === 'text' && b.text === '重写正文'))
  assert.equal(drawable.length, 1, '折叠缺席时投影必须补出唯一一份可画正文')
  assert.ok(input.seq > 0)
})
