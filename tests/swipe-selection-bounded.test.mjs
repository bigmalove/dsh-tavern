import assert from 'node:assert/strict'
import test from 'node:test'
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { createSwipeSelection } from '../tavern-plugin/lib/domain/swipe-selection.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createBoundedHistory } from '../tavern-plugin/lib/domain/bounded-history.js'
import { floorToken } from '../tavern-plugin/lib/domain/floor-location.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'

// Detailed diagnostics go to a file; the console only gets the summary.
const LOG_URL = new URL('../outputs/swipe-bounded.log', import.meta.url)
mkdirSync(new URL('.', LOG_URL), { recursive: true })
writeFileSync(LOG_URL, 'swipe-selection-bounded diagnostics\n' + new Date().toISOString() + '\n')
function log(...lines) { for (const line of lines) appendFileSync(LOG_URL, line + '\n') }
function summary(text) { console.log(text); appendFileSync(LOG_URL, '\n# ' + text + '\n') }

const TOTAL_ROUNDS = 60
const TOTAL_MESSAGES = TOTAL_ROUNDS * 2

// Real persistence + real native Session, exactly like body-editor's nativeEditor:
// the same swipe runs once through a bounded (scoped) save and once through the
// complete Chat update. `chats.forSession` returns the bounded tail window
// (lastAssistant + storyRows) so select can reach the window's second-to-last
// assistant ("旧楼") as well as the latest floor.
async function fixture(t, bounded) {
  const root = await mkdtemp(join(tmpdir(), 'swipe-bounded-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  const session = Session.create('swipe-bounded')
  const messages = []
  for (let turn = 1; turn <= TOTAL_ROUNDS; turn++) {
    appendSessionEvent(session, 'user/message', { id: 'u' + turn, turn, role: 'user', content: [{ type: 'text', text: '行动' + turn }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '正文' + turn + 'B' }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
    messages.push(
      { role: 'user', text: '行动' + turn },
      {
        role: 'assistant', turn, text: '正文' + turn + 'B', sourceText: '正文' + turn + 'B',
        swipes: ['正文' + turn + 'A', '正文' + turn + 'B'], swipeId: 1,
        variables: [{ hp: turn * 10 }, { hp: turn * 10 + 1 }],
        // 最新一轮（第 60 轮）的未选中版本带已结算快照，切过去要恢复姿势。
        swipeStates: turn === TOTAL_ROUNDS
          ? [{ posture: '姿势' + turn, ledger: null, lastSettle: null, settleStatus: 'done' }, null]
          : [null, null],
        mvu: { enabled: true, pending: false }
      }
    )
  }
  const timeline = createStoryTimeline({ id: prefix => prefix + '-fixed', now: () => 5 })
  const chat = timeline.apply({
    chat: { id: 'chat', sessionId: session.id, mode: 'story', backgroundConfigVersion: 1, conversationFeaturesVersion: 1, settleStatus: 'done', posture: '', variables: { day: 1 }, messages },
    intent: { kind: 'ensure' }
  }).chat
  await p.write(chat, { source: 'create' })
  const history = createBoundedHistory({ links: async () => ({ [session.id]: 'chat' }), readWindow: p.readWindow, pageSize: 8 })
  const calls = []
  const hooks = {}
  const agent = { session, phase: { kind: 'idle' } }
  const swipe = createSwipeSelection({
    chats: {
      forSession: async id => bounded ? (await history.forSession(id, { lastAssistant: true, storyRows: 6 })).chat : p.read('chat'),
      update: async (...args) => { calls.push('update'); return p.update(...args) },
      ...(bounded ? { patch: async (...args) => { calls.push('patch'); await hooks.beforePatch?.(); hooks.beforePatch = null; return p.patch(...args) } } : {})
    },
    sessions: { get: () => agent, flush: async () => {} },
    timeline,
    activity: () => ({ busy: false }),
    project: async text => projectReplyLayers(text),
    present: async value => value,
    queueSettlement: async () => {},
    scripts: { dispatchEvent: async () => {} }
  })
  return { p, swipe, session, calls, hooks, history }
}

// Assistant message indices reachable inside a (possibly scoped) chat. The scoped
// proxy exposes the global row index for every owned floor, so this finds the
// latest and the window's second-to-last assistant without cloning anything.
function assistantIndices(chat) {
  const out = []
  for (let i = 0; i < chat.messages.length; i++) {
    const message = chat.messages[i]
    if (message && message.role === 'assistant') out.push(i)
  }
  return out
}

// Neutralize the two non-deterministic fields so bounded and complete writes
// compare field-for-field: the journal timestamp and the random bodyEdit id.
function comparable(chat) {
  const value = structuredClone({ ...chat, updatedAt: 0 })
  for (const message of value.messages) {
    if (message && message.bodyEdit) message.bodyEdit = { ...message.bodyEdit, id: 'EDIT' }
  }
  return value
}

// 先切最新再切旧楼：bounded 与 complete 必须存出同一份 Chat，且只动目标楼。
test('bounded swipe stores the same Chat as the complete update; only target floors change', async t => {
  const results = []
  for (const bounded of [true, false]) {
    const h = await fixture(t, bounded)
    const before = await h.p.read('chat')
    // 第一次读取：拿到最新楼与窗口内倒数第二轮（旧楼）。
    const win = bounded ? (await h.history.forSession(h.session.id, { lastAssistant: true, storyRows: 6 })).chat : await h.p.read('chat')
    const idx = assistantIndices(win)
    const latestIndex = idx.at(-1)
    const oldIndex = idx.at(-2)
    const latestMsg = win.messages[latestIndex]
    const oldMsg = win.messages[oldIndex]
    log(`[${bounded ? 'bounded' : 'complete'}] latestIndex=${latestIndex} oldIndex=${oldIndex} latestTurn=${latestMsg.turn} oldTurn=${oldMsg.turn}`)
    assert.equal(latestMsg.turn, TOTAL_ROUNDS, '最新楼应为第 60 轮')
    assert.equal(oldMsg.turn, TOTAL_ROUNDS - 1, '旧楼应为窗口内倒数第二轮')
    // 1) 先切最新楼到另一个版本。
    await h.swipe.select(h.session.id, { index: latestIndex, turn: latestMsg.turn, swipeId: latestMsg.swipeId === 0 ? 1 : 0, token: floorToken(win, latestMsg) })
    // 2) 再切旧楼到另一个版本（重新读取，旧楼行索引不变）。
    const win2 = bounded ? (await h.history.forSession(h.session.id, { lastAssistant: true, storyRows: 6 })).chat : await h.p.read('chat')
    const oldMsg2 = win2.messages[oldIndex]
    await h.swipe.select(h.session.id, { index: oldIndex, turn: oldMsg2.turn, swipeId: oldMsg2.swipeId === 0 ? 1 : 0, token: floorToken(win2, oldMsg2) })
    const after = await h.p.read('chat')
    results.push({ h, before, after })
  }
  const [b, c] = results
  assert.deepEqual(b.h.calls, ['patch', 'patch'], 'bounded 走 patch 而非 update')
  assert.deepEqual(c.h.calls, ['update', 'update'], 'complete 走 update')
  assert.deepEqual(comparable(b.after), comparable(c.after), 'bounded 与 complete 存出同一份 Chat')

  // 仅目标楼变了：最新楼 -> 版本 A，旧楼 -> 版本 A。
  assert.equal(b.after.messages.at(-1).text, '正文60A')
  assert.equal(b.after.messages.at(-1).swipeId, 0)
  assert.equal(b.after.messages[oldIndexOf(b.after)].text, '正文59A')
  assert.equal(b.after.messages[oldIndexOf(b.after)].swipeId, 0)

  // 最新状态：从未选中版本的结算快照恢复了姿势与 settle 状态（不排队结算）。
  assert.equal(b.after.posture, '姿势60')
  assert.equal(b.after.settleStatus, 'done')

  // 旧楼切换不影响当前（最新）楼层与聊天级状态。
  assert.equal(b.after.messages.at(-1).text, '正文60A')
  assert.equal(b.after.posture, '姿势60')
  assert.deepEqual(b.after.variables, { day: 1 })

  // 窗口外的其它楼层整段未动。
  assert.equal(b.after.messages[1].text, '正文1B')
  assert.equal(b.after.messages[1].swipeId, 1)
  assert.equal(b.after.messages[115].text, '正文58B')
  assert.equal(b.after.messages[115].swipeId, 1)

  // 模型消息面上只有那两楼被替换。
  const texts = b.after.messages.filter(m => m.role === 'assistant').map(m => m.text)
  assert.deepEqual(texts.at(-1), '正文60A')
  assert.equal(texts.at(-2), '正文59A')
  log('parity OK: calls', JSON.stringify(b.h.calls), JSON.stringify(c.h.calls))
  log('latest text=' + b.after.messages.at(-1).text + ' posture=' + b.after.posture + ' settleStatus=' + b.after.settleStatus)
  log('old text=' + b.after.messages[oldIndexOf(b.after)].text)
  summary('PASS: bounded 与 complete 对等，仅目标楼变，最新状态恢复，旧楼不影响当前')
})

function oldIndexOf(chat) {
  return assistantIndices(chat).at(-2)
}

// Scoped 窗口的 length 是全局总数，行索引与完整 Chat 一致，且不能被 structuredClone。
test('bounded 窗口：Scoped messages length 为全局总数，行索引不变，不可 structuredClone', async t => {
  const h = await fixture(t, true)
  const win = await h.history.forSession(h.session.id, { lastAssistant: true, storyRows: 6 })
  assert.equal(win.chat.messages.length, TOTAL_MESSAGES, 'length 是全局总数，不随窗口缩小')
  assert.equal(win.messageCount, TOTAL_MESSAGES)
  const idx = assistantIndices(win.chat)
  assert.equal(win.chat.messages[idx.at(-1)].turn, TOTAL_ROUNDS, '最新楼用全局行索引定位')
  assert.equal(win.chat.messages[idx.at(-2)].turn, TOTAL_ROUNDS - 1, '旧楼用全局行索引定位')
  assert.equal(win.chat.messages[0], undefined, '窗口外的楼层在代理上是空洞，不是伪造对象')
  assert.throws(() => structuredClone(win.chat.messages), undefined, 'Scoped 代理禁止被结构化克隆')
  log('scoped length=' + win.chat.messages.length + ' messageCount=' + win.messageCount + ' aIndices=' + JSON.stringify(idx))
  summary('PASS: Scoped 窗口 length 为全局总数，行索引不变，禁止 structuredClone')
})

// patch 因并发 revision 冲突失败后完整回退，仍保留非目标楼的 displayRuntime 捕获。
test('并发 displayRuntime 变动：patch 失败后完整回退仍保留 display 字段', async t => {
  const h = await fixture(t, true)
  const win = (await h.history.forSession(h.session.id, { lastAssistant: true, storyRows: 6 })).chat
  const idx = assistantIndices(win)
  const latestIndex = idx.at(-1)
  const oldIndex = idx.at(-2)
  const latestMsg = win.messages[latestIndex]
  // 切换最新楼的过程中，另一楼层（旧楼）并发捕获了 displayRuntime —— 它不在本次切换的目标上。
  h.hooks.beforePatch = () => h.p.update('chat', chat => {
    chat.messages[oldIndex].displayRuntime = { frames: [{ src: 'capture' }] }
    return chat
  }, { source: 'display.capture' })
  await h.swipe.select(h.session.id, { index: latestIndex, turn: latestMsg.turn, swipeId: latestMsg.swipeId === 0 ? 1 : 0, token: floorToken(win, latestMsg) })
  assert.deepEqual(h.calls, ['patch', 'update'], 'revision 冲突使 bounded 落到完整回退')
  const stored = await h.p.read('chat')
  // 目标（最新楼）正常完成切换。
  assert.equal(stored.messages[latestIndex].text, '正文60A')
  assert.equal(stored.posture, '姿势60')
  // 非目标楼的 displayRuntime 在完整回退后仍然保留。
  assert.ok(stored.messages[oldIndex].displayRuntime, '旧楼 displayRuntime 应保留')
  assert.deepEqual(stored.messages[oldIndex].displayRuntime.frames, [{ src: 'capture' }])
  log('conflict-display calls=' + JSON.stringify(h.calls))
  log('latest text=' + stored.messages[latestIndex].text + ' posture=' + stored.posture)
  log('old displayRuntime=' + JSON.stringify(stored.messages[oldIndex].displayRuntime))
  summary('PASS: patch 冲突后完整回退仍保留 display 字段')
})

// 并发的用户正文变动使 token 失效，完整回退拒绝覆盖并保留并发写入。
test('并发用户正文变动：完整回退拒绝覆盖', async t => {
  const h = await fixture(t, true)
  const win = (await h.history.forSession(h.session.id, { lastAssistant: true, storyRows: 6 })).chat
  const idx = assistantIndices(win)
  const latestIndex = idx.at(-1)
  const latestMsg = win.messages[latestIndex]
  // 切换最新楼的过程中，目标楼本身的正文被别处改写 —— 这会让 token 失效。
  h.hooks.beforePatch = () => h.p.update('chat', chat => {
    chat.messages[latestIndex].text = '别处改过'
    chat.messages[latestIndex].sourceText = '别处改过'
    chat.messages[latestIndex].swipes = ['别处改过', '正文60B']
    return chat
  }, { source: 'other' })
  await assert.rejects(h.swipe.select(h.session.id, { index: latestIndex, turn: latestMsg.turn, swipeId: latestMsg.swipeId === 0 ? 1 : 0, token: floorToken(win, latestMsg) }), /已变化/)
  assert.deepEqual(h.calls, ['patch', 'update'], 'revision 冲突后走到完整回退')
  const stored = await h.p.read('chat')
  // 拒绝后不覆盖：保留并发写入的正文，版本号未变。
  assert.equal(stored.messages[latestIndex].text, '别处改过')
  assert.equal(stored.messages[latestIndex].swipeId, 1)
  log('conflict-body calls=' + JSON.stringify(h.calls))
  log('rejected; latest text=' + stored.messages[latestIndex].text + ' swipeId=' + stored.messages[latestIndex].swipeId)
  summary('PASS: 并发用户正文变动导致完整回退拒绝覆盖')
})
