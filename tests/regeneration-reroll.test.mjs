import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { projectRegenerationRequestMessages } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'

const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
const OLD_BODY = '原正文'
const NEW_BODY = '重掷后的新正文'

/**
 * One saved round (player input + body) and a foreground agent that records the
 * session messages once the new request exists. `reply` decides what the
 * provider writes back: null models a lost/empty generation.
 *
 * The provider never receives `session.deriveMessages()` as-is: the play
 * strategy runs `projectRegenerationRequestMessages` over it, and that
 * projection is what makes a regeneration a fresh sample. The assertions below
 * go through the same function instead of the raw session.
 */
async function run(t, { reply, legacyProjection = false }) {
  const root = await mkdtemp(join(tmpdir(), 'tavern-reroll-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const session = Session.create('reroll-session')
  appendSessionEvent(session, 'user/message', { id: 'original-user', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  // A reply projected by an older release sits in an edit turn and carries no
  // story turn, so only its body still identifies the round.
  appendSessionEvent(session, 'assistant/message', {
    turn: legacyProjection ? 9 : 2, step: 1,
    message: { id: 'original-assistant', role: 'assistant', content: [{ type: 'text', text: OLD_BODY }], source: model }
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  await persistence.write({ id: 'chat', sessionId: session.id, mode: 'story', messages: [{ role: 'user', text: '继续' }, { role: 'assistant', turn: 2, text: OLD_BODY }], settleStatus: 'done' })
  const seen = { messages: [], turn: 0 }
  const agent = {
    session,
    phase: { kind: 'idle', lastTurn: 2 },
    followup(message) {
      seen.turn = Math.max(2, Number(this.phase.lastTurn) || 0) + 1
      this.phase.kind = 'running'
      appendSessionEvent(session, 'turn/start', { turn: seen.turn })
      appendSessionEvent(session, 'user/message', { ...message, turn: seen.turn }, { surfaceOp: 'append' })
      appendSessionEvent(session, 'step/start', { turn: seen.turn, step: 1 })
      if (reply !== null) {
        appendSessionEvent(session, 'assistant/message', { turn: seen.turn, step: 1, message: { id: 'new-assistant', role: 'assistant', content: [{ type: 'text', text: reply }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
      }
      appendSessionEvent(session, 'step/end', { turn: seen.turn, step: 1 })
      appendSessionEvent(session, 'turn/end', { turn: seen.turn, reason: { kind: 'completed' } })
    },
    async whenIdle() {
      // The attempt's own input is on the surface now: this is the message list
      // the play strategy projects for the provider.
      seen.messages = session.deriveMessages()
      this.phase = { kind: 'idle', lastTurn: seen.turn }
      if (reply === null) return
      await persistence.update('chat', chat => {
        chat.messages.push({ role: 'user', text: this.inputText }, { role: 'assistant', turn: seen.turn, text: reply })
        return chat
      })
    }
  }
  const history = createRoundHistory({
    chats: { ...persistence, forSession: () => persistence.read('chat'), readCard: async () => ({}) },
    sessions: { get: () => agent, flush: async () => {} },
    scripts: {}, timeline: createStoryTimeline(),
    queueSettlement: async () => {},
    present: async chat => chat
  })
  return { history, persistence, session, seen }
}

const requestText = seen => JSON.stringify(projectRegenerationRequestMessages(seen.messages))

test('重掷：发给模型的请求里没有旧正文，提交后仍是同一个剧情轮次', async t => {
  const { history, persistence, session, seen } = await run(t, { reply: NEW_BODY })
  const view = await history.regenerate('chat', '', 'reroll-session')
  assert.equal(view.adopted.text, NEW_BODY)
  const sent = requestText(seen)
  assert.doesNotMatch(sent, new RegExp(OLD_BODY), '旧正文不能跟着重掷请求发给模型')
  assert.match(sent, /继续/, '玩家输入仍要在上下文里')
  const chat = await persistence.read('chat')
  assert.equal(chat.messages.at(-1).text, NEW_BODY)
  assert.deepEqual(chat.messages.at(-1).swipes, [OLD_BODY, NEW_BODY], '旧版本保留为可切回的历史版本')
  // The native surface ends with exactly one body for this turn: the new one.
  const bodies = session.deriveMessages().filter(message => message.role === 'assistant').map(message => JSON.stringify(message))
  assert.equal(bodies.some(text => text.includes(OLD_BODY)), false)
  assert.equal(bodies.some(text => text.includes(NEW_BODY)), true)
})

test('参考旧正文重写：旧正文作为底稿进入本轮输入', async t => {
  const { history, seen } = await run(t, { reply: NEW_BODY })
  await history.regenerate('chat', '再写长一点', 'reroll-session', { rewrite: true })
  const sent = requestText(seen)
  assert.match(sent, new RegExp(OLD_BODY), '重写要把当前这一版交给模型当底稿')
  assert.match(sent, /再写长一点/)
})

test('重掷没有产出正文时旧正文原样留在上下文里', async t => {
  const { history, persistence, session } = await run(t, { reply: null })
  await assert.rejects(history.regenerate('chat', '', 'reroll-session'), /没有完成|未产生正文/)
  const saved = await persistence.read('chat')
  assert.equal(saved.messages.at(-1).text, OLD_BODY)
  assert.equal(saved.regenInProgress, undefined)
  assert.equal(saved.regenRecovery, undefined)
  const visible = JSON.stringify(session.deriveMessages())
  assert.match(visible, new RegExp(OLD_BODY), '撤销后模型必须重新看得到原正文')
  assert.equal(sessionEvents(session).some(event =>
    event.type === 'assistant/message' && JSON.stringify(event.data?.message?.content || '').includes(NEW_BODY)), false)
})

test('连续重掷：投影后的正文仍然能定位到同一剧情轮次', async t => {
  const { history, persistence, session } = await run(t, { reply: NEW_BODY })
  await history.regenerate('chat', '', 'reroll-session')
  // The projected body lives in an edit turn on the surface; its source keeps
  // the story turn so the next reroll finds it without guessing.
  const projected = session.snapshotEvents().filter(event => event.type === 'assistant/message' && event.surfaceOp?.op === 'replace').at(-1)
  assert.equal(projected.data.message.source.tavernStoryTurn, 2)
  assert.notEqual(projected.data.turn, 2)
  const view = await history.regenerate('chat', '', 'reroll-session')
  assert.equal(view.adopted.text, NEW_BODY)
  assert.equal((await persistence.read('chat')).messages.at(-1).turn, 2)
})

test('老存档的投影没记剧情轮次，也能靠正文找回并重掷', async t => {
  const { history, seen } = await run(t, { reply: NEW_BODY, legacyProjection: true })
  const view = await history.regenerate('chat', '', 'reroll-session')
  assert.equal(view.adopted.text, NEW_BODY)
  assert.equal(view.adopted.hiddenTurn, 2)
  assert.doesNotMatch(requestText(seen), new RegExp(OLD_BODY))
})
