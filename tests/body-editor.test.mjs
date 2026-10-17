import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createBodyEditor, synchronizeBodyEdits } from '../tavern-plugin/lib/domain/body-editor.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { sessionEvents, appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'

function fixture(text = '原正文', seeded = false) {
  let session = Session.create('body-edit-test')
  appendSessionEvent(session, 'user/message', { id: 'user', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'reply', role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  if (seeded) session = Session.create(session.id, sessionEvents(session), { ...session.header, isSeeded: true }, session.seq)
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1, messages: [{ role: 'user', text: '继续' }, { role: 'assistant', turn: 2, text, sourceText: text, swipes: [text], swipeId: 0, variables: [{ hp: 9 }] }], settleStatus: 'done', posture: '原状态', scriptState: { cursor: 5 }, variables: { hp: 9 } }
  const agent = { get session() { return session }, phase: { kind: 'idle', lastTurn: 2 } }
  let busy = false, failWrite = false, failFlush = false
  const options = {
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { if (failWrite) throw Error('write failed'); chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => { if (failFlush) throw Error('flush failed') } },
    timeline: createStoryTimeline(), activity: () => ({ busy }), project: async text => projectReplyLayers(text), present: async chat => chat
  }
  return { editor: createBodyEditor(options), get chat() { return chat }, get session() { return session }, agent, options,
    busy(value) { busy = value }, failWrite(value) { failWrite = value }, failFlush(value) { failFlush = value },
    restore(events = sessionEvents(session)) { session = Session.create(session.id, events, session.header) },
    change(fn) { fn(chat) } }
}

test('stale tabs, blank text, new HTML, running turns and HTML-only replies reject without writes', async () => {
  const h = fixture(), edit = await h.editor.read(h.session.id), original = structuredClone(h.chat)
  for (const input of [{ token: 'stale', texts: ['新'] }, { token: edit.token, texts: [''] }, { token: edit.token, texts: ['<div>注入</div>'] }, { token: edit.token, texts: [] }]) await assert.rejects(h.editor.save(h.session.id, input))
  h.busy(true); await assert.rejects(h.editor.save(h.session.id, { token: edit.token, texts: ['新'] }), /等待/); h.busy(false)
  h.agent.phase.kind = 'running'; await assert.rejects(h.editor.read(h.session.id), /等待/)
  assert.deepEqual(h.chat, original)
  const html = fixture('<div>纯 HTML</div>'); await assert.rejects(html.editor.read(html.session.id), /没有可编辑文本/)
})

test('issue #72: stale bodyEdit after migration clears instead of blocking turns', async () => {
  const h = fixture('原正文')
  h.change(chat => {
    chat.messages.at(-1).text = '已编辑正文'
    chat.messages.at(-1).bodyEdit = { id: 'tavern-body-edit:gone', seq: 99999, turn: 999 }
  })
  const cleared = []
  await synchronizeBodyEdits(h.session, h.chat, h.options.sessions.flush, async (_chat, ids) => { cleared.push(...ids) })
  assert.deepEqual(cleared, ['tavern-body-edit:gone'])
  assert.equal(h.chat.messages.at(-1).bodyEdit, undefined)
  assert.equal(h.session.deriveMessages().at(-1).content[0].text, '原正文')
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createBoundedHistory } from '../tavern-plugin/lib/domain/bounded-history.js'

// The same edit through a bounded history (patch of the last floor) and through
// the complete Chat update must store the same Chat and native surface.
async function nativeEditor(t, bounded) {
  const root = await mkdtemp(join(tmpdir(), 'body-edit-native-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  const session = Session.create('body-edit-native')
  const messages = []
  for (let turn = 1; turn <= 60; turn++) {
    appendSessionEvent(session, 'user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: '行动' + turn }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '正文' + turn }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
    messages.push({ role: 'user', text: '行动' + turn }, { role: 'assistant', turn, text: '正文' + turn, sourceText: '正文' + turn, swipes: ['正文' + turn], swipeId: 0, variables: [{ hp: turn }], displayRuntime: { frames: [] } })
  }
  const timeline = createStoryTimeline({ id: prefix => prefix + '-fixed', now: () => 5 })
  const chat = timeline.apply({ chat: { id: 'chat', sessionId: session.id, mode: 'story', backgroundConfigVersion: 1, conversationFeaturesVersion: 1, settleStatus: 'done', messages }, intent: { kind: 'ensure' } }).chat
  await p.write(chat, { source: 'create' })
  const history = createBoundedHistory({ links: async () => ({ [session.id]: 'chat' }), readWindow: p.readWindow, pageSize: 8 })
  const calls = []
  const hooks = {}
  const agent = { session, phase: { kind: 'idle' } }
  const editor = createBodyEditor({
    chats: { forSession: async id => bounded ? (await history.forSession(id, { lastAssistant: true })).chat : p.read('chat'),
      update: async (...args) => { calls.push('update'); return p.update(...args) }, patch: async (...args) => { calls.push('patch'); await hooks.beforePatch?.(); hooks.beforePatch = null; return p.patch(...args) } },
    sessions: { get: () => agent, flush: async () => {} }, timeline, activity: () => ({ busy: false }), project: async text => projectReplyLayers(text), present: async chat => chat })
  return { p, editor, session, calls, hooks }
}

test('bounded body edit patches only the last floor and stores the same Chat as the complete update', async t => {
  const results = []
  for (const bounded of [true, false]) {
    const h = await nativeEditor(t, bounded)
    const edit = await h.editor.read(h.session.id)
    await h.editor.save(h.session.id, { token: edit.token, texts: ['改写后的第六十轮'] })
    const stored = await h.p.read('chat')
    const id = stored.messages.at(-1).bodyEdit.id
    results.push({ calls: h.calls, stored: JSON.parse(JSON.stringify({ ...stored, updatedAt: 0 }).replaceAll(id, 'EDIT')),
      surface: h.session.deriveMessages().at(-1).content[0].text })
  }
  assert.deepEqual(results[0].calls, ['patch'])
  assert.deepEqual(results[1].calls, ['update'])
  assert.deepEqual(results[0].stored, results[1].stored)
  assert.equal(results[0].surface, '改写后的第六十轮')
  assert.equal(results[0].stored.messages.at(-1).displayRuntime, undefined)
  assert.equal(results[0].stored.messages.length, 120)
})

test('插件整段替换正文：HTML 块必须原样保留，只改文字', async () => {
  const block = '```html\n<div class="status">体力 9</div>\n```'
  const h = fixture('雨停了。\n\n' + block)
  const original = structuredClone(h.chat)
  await assert.rejects(h.editor.replaceText(h.session.id, '雨停了。\n\n```html\n<div class="status">体力 1</div>\n```'), /HTML 块要保持原样/)
  await assert.rejects(h.editor.replaceText(h.session.id, '雨停了。'), /HTML 块要保持原样/)
  await assert.rejects(h.editor.replaceText(h.session.id, '雨停了。\n\n' + block + '\n\n多出来的一段。'), /不能在 HTML 块之间新增段落/)
  assert.deepEqual(h.chat, original)
  await h.editor.replaceText(h.session.id, '雨停了，灯亮了。\n\n' + block)
  assert.equal(h.chat.messages[1].sourceText, '雨停了，灯亮了。\n\n' + block)
})

// Three committed rounds: the middle reply, the player input that opened it and
// the card greeting are all editable; only the latest round owns the scene state.
function history() {
  let session = Session.create('body-floor-test')
  appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'opening', role: 'assistant', content: [{ type: 'text', text: '开场白' }], source: { kind: 'model', provider: 'dsh-tavern', model: 'character-card' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  for (const [turn, input, body] of [[2, '推门', '第一段正文'], [3, '继续', '第二段正文'], [4, '追问', '第三段正文']]) {
    appendSessionEvent(session, 'user/message', { id: 'u' + turn, turn, role: 'user', content: [{ type: 'text', text: input }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: body }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  }
  let chat = {
    id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1, timeline: { schemaVersion: 1, branchId: 'b1', revision: 7, checkpoints: [], participants: { background: { role: 'background', lifetime: 'chat', sessionId: 'bg', status: 'ready', boundary: 4 } }, operations: {}, updatedAt: 0 },
    posture: '第三段的姿势', settleStatus: 'done', lastSettle: { ts: 1, posture: true, raw: '第三段' }, candidates: ['继续'], variables: { hp: 31 },
    messages: [
      { role: 'assistant', greeting: true, text: '开场白', sourceText: '开场白', swipes: ['开场白', '备用开场'], swipeId: 0 },
      { role: 'user', text: '推门' },
      { role: 'assistant', turn: 2, text: '第一段正文', sourceText: '第一段正文', swipes: ['第一段正文'], swipeId: 0, variables: [{ hp: 10 }] },
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 3, text: '第二段正文', sourceText: '第二段正文', swipes: ['第二段正文'], swipeId: 0, variables: [{ hp: 20 }] },
      { role: 'user', text: '追问' },
      { role: 'assistant', turn: 4, text: '第三段正文', sourceText: '第三段正文', swipes: ['第三段正文'], swipeId: 0, variables: [{ hp: 31 }] }
    ]
  }
  const agent = { get session() { return session }, phase: { kind: 'idle', lastTurn: 4 } }
  let busy = false
  const options = {
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => {} },
    timeline: createStoryTimeline({ id: prefix => prefix + '-fixed', now: () => 5 }),
    activity: () => ({ busy }), project: async text => projectReplyLayers(text), present: async value => structuredClone(value)
  }
  return { editor: createBodyEditor(options), get chat() { return chat }, get session() { return session }, agent, busy(value) { busy = value },
    change(fn) { fn(chat) } }
}

test('编辑旧楼层只换该楼文字，当前姿势、结算与变量不动', async () => {
  const h = history()
  const edit = await h.editor.read(h.session.id, { index: 4, turn: 3, role: 'assistant' })
  assert.equal(edit.role, 'assistant')
  assert.equal(edit.latest, false)
  assert.deepEqual(edit.parts.map(part => part.kind), ['text'])
  const view = await h.editor.save(h.session.id, { index: 4, turn: 3, role: 'assistant', token: edit.token, texts: ['第二段改写'] })
  assert.equal(view.messages[4].text, '第二段改写')
  assert.equal(view.messages[4].sourceText, '第二段改写')
  assert.equal(h.chat.posture, '第三段的姿势')
  assert.equal(h.chat.settleStatus, 'done')
  assert.deepEqual(h.chat.lastSettle, { ts: 1, posture: true, raw: '第三段' })
  assert.deepEqual(h.chat.variables, { hp: 31 })
  assert.equal(h.chat.timeline.revision, 8)
  // 原生消息面只替换这一楼；后台参与者必须重新对齐到新文字。
  assert.deepEqual(h.session.deriveMessages().map(message => message.content[0].text), ['开场白', '推门', '第一段正文', '继续', '第二段改写', '追问', '第三段正文'])
  assert.equal(h.chat.timeline.participants.background.status, 'needs-rewind')
  assert.equal(h.chat.candidates, null)
})

test('分页正文缺失原生楼层时，保存成功后继续修复正确的会话', async () => {
  const { createScopedMessages } = await import('../tavern-plugin/lib/domain/scoped-messages.js')
  const { applyJsonChanges } = await import('../tavern-plugin/lib/domain/json-mutation.js')
let chat={id:'c',sessionId:'session-1',mode:'story',_storageRevision:1,settleStatus:'done',messages:[{role:'user',text:'continue'},{role:'assistant',turn:1,text:'original',sourceText:'original'}]}
const session={id:'session-1',events:[],surface:{nodes:[]}},agent={session,phase:{kind:'idle'}}
let patched=false,repairs=0
const editor=createBodyEditor({chats:{forSession:async()=>({...structuredClone(chat),messages:createScopedMessages(2,[[1,structuredClone(chat.messages[1])]])}),async patch(id,rev,changes){patched=true;chat=applyJsonChanges(chat,changes);return structuredClone(chat)}},sessions:{get:()=>agent,flush:async()=>{}},timeline:createStoryTimeline(),activity:()=>({busy:false}),project:async text=>({sessionText:text,displayText:text}),present:async c=>c,repairNative:async id=>{assert.equal(id, session.id);repairs++;return null}})
const edit=await editor.read(session.id)
const saved = await editor.save(session.id,{token:edit.token,texts:['edited']})
assert.equal(saved.messages[1].text, 'edited')
assert.equal(patched, true)
assert.equal(repairs, 3)
})

test('编辑玩家输入同步原生 user 消息，角色与轮次校验拒绝错楼层', async () => {
  const h = history()
  const edit = await h.editor.read(h.session.id, { index: 3, turn: 3, role: 'user' })
  assert.equal(edit.turn, 3)
  assert.deepEqual(edit.parts, [{ kind: 'text', text: '继续' }])
  await h.editor.save(h.session.id, { index: 3, turn: 3, role: 'user', token: edit.token, texts: ['继续走下去'] })
  assert.equal(h.chat.messages[3].text, '继续走下去')
  const texts = h.session.deriveMessages().map(message => message.content[0].text)
  assert.equal(texts[3], '继续走下去')
  // 角色与楼层不符、轮次不符都拒绝，且不写入。
  await assert.rejects(h.editor.read(h.session.id, { index: 3, turn: 3, role: 'assistant' }), /不存在或已变化/)
  await assert.rejects(h.editor.read(h.session.id, { index: 4, turn: 2, role: 'assistant' }), /不存在或已变化/)
  await assert.rejects(h.editor.read(h.session.id, { index: 5, turn: 3, role: 'assistant' }), /不存在或已变化/)
})

test('编辑开场白：开局后只换文字，版本数组与变量保持', async () => {
  const h = history()
  const edit = await h.editor.read(h.session.id, { index: 0, turn: 1, role: 'assistant' })
  assert.equal(edit.latest, false)
  await h.editor.save(h.session.id, { index: 0, turn: 1, role: 'assistant', token: edit.token, texts: ['新的开场白'] })
  assert.equal(h.chat.messages[0].text, '新的开场白')
  assert.deepEqual(h.chat.messages[0].swipes, ['新的开场白', '备用开场'])
  assert.equal(h.chat.messages[0].swipeId, 0)
  assert.equal(h.session.deriveMessages()[0].content[0].text, '新的开场白')
  assert.equal(h.chat.messages[2].text, '第一段正文')
})

test('旧楼层编辑被压缩或忙碌时拒绝，token 随楼层内容变化', async () => {
  const h = history()
  const edit = await h.editor.read(h.session.id, { index: 4, turn: 3, role: 'assistant' })
  h.busy(true)
  await assert.rejects(h.editor.save(h.session.id, { index: 4, turn: 3, role: 'assistant', token: edit.token, texts: ['并发改'] }), /等待/)
  h.busy(false)
  h.change(chat => { chat.messages[4].sourceText = '别处改过'; chat.messages[4].text = '别处改过' })
  await assert.rejects(h.editor.save(h.session.id, { index: 4, turn: 3, role: 'assistant', token: edit.token, texts: ['过时编辑'] }), /已变化/)
  assert.equal(h.chat.messages[4].text, '别处改过')
  // 楼层不在模型上下文里（这里把最后一楼的原生节点摘掉）时读写都拒绝。
  h.session.surface.nodes.splice(6, 1)
  await assert.rejects(h.editor.read(h.session.id, { index: 6, turn: 4, role: 'assistant' }), /不在当前上下文/)
})

test('未指定楼层时仍只编辑最后一轮（菜单路径向后兼容）', async () => {
  const h = history()
  const edit = await h.editor.read(h.session.id)
  assert.equal(edit.index, 6)
  assert.equal(edit.latest, true)
  await h.editor.save(h.session.id, { token: edit.token, texts: ['第四段改写'] })
  assert.equal(h.chat.messages[6].text, '第四段改写')
  assert.equal(h.chat.posture, '')
  assert.equal(h.chat.settleStatus, 'idle')
  // 之后又追加了一条玩家输入：旧菜单持有的楼层不再是最后一轮。
  h.change(chat => { chat.messages.push({ role: 'user', text: '新的行动' }) })
  await assert.rejects(h.editor.read(h.session.id), /只能编辑最后一轮/)
})

