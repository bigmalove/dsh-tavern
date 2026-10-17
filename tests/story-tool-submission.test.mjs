import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { createStorySubmissionTool, storySubmissionForTurn, storySubmissionSurfaceRange, activeStoryTurn, storyToolCallEnabled } from '../tavern-plugin/lib/domain/story-tool-submission.js'
import { assistantResultForTurn } from '../tavern-plugin/lib/domain/session-turn-result.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { createNativePlayOrchestrationStrategy } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'

function fixture(content = '<game>正文\\引号"\n新行</game>', { error = false, result = content, turn = 2 } = {}) {
  const raw = JSON.stringify({ content })
  const session = { id: 'game', surface: { nodes: [] }, events: [
    { seq: 0, type: 'turn/start', data: { turn } },
    { seq: 1, type: 'assistant/message', data: { turn, message: { id: 'model-1', source: { kind: 'model' }, content: [
      { type: 'reasoning', text: '思考' }, { type: 'text', text: '不应覆盖提交的杂话' },
      { type: 'tool-call', id: 'submit-1', name: 'submit_story', arguments: raw }
    ] } } },
    { seq: 2, type: 'tool/call', data: { turn, callId: 'submit-1', name: 'submit_story', arguments: raw } },
    { seq: 3, type: 'tool/result', data: { turn, message: { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'submit-1', isError: error, content: [{ type: 'text', text: result }] }] } } }
  ] }
  session.surface.nodes = session.events.map(event => event.seq)
  // The host owns the surface: an append extends it, a replace splices its range in place.
  session.append = function (type, data, intent) {
    const event = { seq: this.events.length, type, data, ...intent }
    this.events.push(event)
    const op = intent && intent.surfaceOp
    if (op && typeof op === 'object' && op.op === 'replace') {
      const from = this.surface.nodes.indexOf(op.start ?? op.startSeq)
      const to = this.surface.nodes.indexOf(op.end ?? op.endSeq)
      if (from >= 0 && to >= from) this.surface.nodes.splice(from, to - from + 1, event.seq)
      else this.surface.nodes.push(event.seq)
    } else this.surface.nodes.push(event.seq)
    return event
  }
  return session
}

test('只消费同回合已执行成功且匹配模型调用的提交，保留正文格式', () => {
  const session = fixture()
  const result = assistantResultForTurn(session, 2)
  assert.equal(result.storyToolSubmission, true)
  assert.equal(result.text, '<game>正文\\引号"\n新行</game>')
  assert.equal(result.reasoningText, '思考')
  assert.equal(result.event.data.message.id, 'model-1')
  assert.equal(storySubmissionForTurn(session, 1), null)
  assert.equal(storySubmissionForTurn(fixture('正文', { error: true }), 2), null)
  assert.equal(storySubmissionForTurn(fixture('正文', { result: '其他结果' }), 2), null)
  for (const remove of [1, 2, 3]) {
    const incomplete = fixture(); incomplete.events.splice(remove, 1)
    assert.equal(storySubmissionForTurn(incomplete, 2), null)
  }
  const mismatch = fixture(); mismatch.events[3].data.message.content[0].toolCallId = 'other'
  assert.equal(storySubmissionForTurn(mismatch, 2), null)
  const plugin = fixture(); plugin.events[1].data.message.source.kind = 'plugin'
  assert.equal(storySubmissionForTurn(plugin, 2), null)
  const invalid = fixture(); invalid.events[1].data.message.content[2].arguments = '{bad'
  assert.equal(storySubmissionForTurn(invalid, 2), null)
})

test('回滚或重新生成遮蔽的旧工具提交不会重新成为正文', () => {
  const session = fixture('旧正文')
  session.surface = { nodes: [0, 4] }
  session.events.push({ type: 'assistant/message', data: { turn: 2, message: { source: { kind: 'model' }, content: [{ type: 'text', text: '重新生成的正文' }] } } })
  assert.equal(storySubmissionForTurn(session, 2), null)
  assert.equal(assistantResultForTurn(session, 2).text, '重新生成的正文')
})

test('提交区间覆盖调用消息到回执之间的全部 surface 节点', () => {
  const direct = fixture('正文')
  assert.deepEqual(storySubmissionSurfaceRange(direct, storySubmissionForTurn(direct, 2)), { start: 1, end: 3, sourceEventSeqs: [1, 2, 3] })

  // A second tool call rides the same model message; its receipt lands between
  // the call and the submission's receipt and is replaced together with them.
  const raw = JSON.stringify({ content: '正文' })
  const between = { id: 'game', events: [
    { seq: 0, type: 'turn/start', data: { turn: 2 } },
    { seq: 1, type: 'assistant/message', data: { turn: 2, message: { id: 'model-1', source: { kind: 'model' }, content: [
      { type: 'tool-call', id: 'recall-1', name: 'tavern_recall_history', arguments: '{"query":"背景"}' },
      { type: 'tool-call', id: 'submit-1', name: 'submit_story', arguments: raw }
    ] } } },
    { seq: 2, type: 'tool/call', data: { turn: 2, callId: 'recall-1', name: 'tavern_recall_history', arguments: '{"query":"背景"}' } },
    { seq: 3, type: 'tool/result', data: { turn: 2, message: { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'recall-1', isError: false, content: [{ type: 'text', text: '背景资料' }] }] } } },
    { seq: 4, type: 'tool/call', data: { turn: 2, callId: 'submit-1', name: 'submit_story', arguments: raw } },
    { seq: 5, type: 'tool/result', data: { turn: 2, message: { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'submit-1', isError: false, content: [{ type: 'text', text: '正文' }] }] } } }
  ] }
  between.surface = { nodes: between.events.map(event => event.seq) }
  const riding = storySubmissionForTurn(between, 2)
  assert.equal(riding.receiptSeq, 5)
  assert.deepEqual(storySubmissionSurfaceRange(between, riding), { start: 1, end: 5, sourceEventSeqs: [1, 2, 3, 4, 5] })

  // A receipt outside the surface, or one preceding its call, has no range to replace.
  const hidden = fixture('正文')
  hidden.surface.nodes = [0, 1, 2]
  assert.equal(storySubmissionSurfaceRange(hidden, { storyToolSubmission: true, index: 1, event: hidden.events[1], receiptSeq: 3 }), null)
  assert.equal(storySubmissionSurfaceRange(fixture('正文'), { storyToolSubmission: true, index: 3, event: { seq: 3 }, receiptSeq: 1 }), null)
  assert.equal(storySubmissionSurfaceRange(fixture('正文'), null), null)
  assert.equal(storySubmissionSurfaceRange({ events: [] }, { storyToolSubmission: true, index: 0, event: { seq: 0 }, receiptSeq: 0 }), null)
})

test('Session 快照重放和结束事件仍可提取正文，不依赖内存提交状态', () => {
  const session = fixture('正文')
  assert.equal(activeStoryTurn(session), 2)
  session.events.push({ type: 'turn/end', data: { turn: 2 } })
  const copy = JSON.parse(JSON.stringify(session.events))
  assert.equal(activeStoryTurn({ snapshotEvents: () => copy }), null)
  assert.equal(assistantResultForTurn({ snapshotEvents: () => copy }, 2).text, '正文')
})

test('工具仅允许已开启的前台 story/script，拒绝空正文、后台、失效宿主和已结束回合', async () => {
  let chat = { mode: 'story', storyToolCallEnabled: true }, background = false, concluded = 0
  const tool = createStorySubmissionTool({ chatForSession: async () => chat, isBackground: () => background })
  const session = { id: 'game', events: [{ type: 'turn/start', data: { turn: 1 } }] }
  const exec = { agent: { session }, signal: new AbortController().signal, concludeTurn() { concluded++ } }
  assert.equal(await tool.execute({ content: '正文' }, exec), '正文')
  assert.equal(concluded, 1)
  assert.equal(tool.isConcurrencySafe(), false)
  for (const content of ['', '  ', null, 123]) await assert.rejects(tool.execute({ content }, exec), /正文不能为空/)
  for (chat of [{}, { mode: 'card', storyToolCallEnabled: true }, { mode: 'story', storyToolCallEnabled: false }]) await assert.rejects(tool.execute({ content: '正文' }, exec), /未开启/)
  chat = { mode: 'script', storyToolCallEnabled: true }
  assert.equal(await tool.execute({ content: '剧本正文' }, exec), '剧本正文')
  background = true
  await assert.rejects(tool.execute({ content: '正文' }, exec), /前台游玩/)
  background = false
  await assert.rejects(tool.execute({ content: '正文' }, { ...exec, concludeTurn: undefined }), /DSH 版本/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(tool.execute({ content: '正文' }, { ...exec, signal: controller.signal }), { name: 'AbortError' })
  session.events.push({ type: 'turn/end', data: { turn: 1 } })
  await assert.rejects(tool.execute({ content: '正文' }, exec), /没有正在生成/)
})

test('同轮重放相同正文幂等，冲突正文不覆盖已成功提交内容', async () => {
  const session = fixture('已提交')
  const tool = createStorySubmissionTool({ chatForSession: async () => ({ mode: 'story', storyToolCallEnabled: true }) })
  let concluded = 0
  const exec = { agent: { session }, concludeTurn() { concluded++ } }
  assert.equal(await tool.execute({ content: '已提交' }, exec), '已提交')
  await assert.rejects(tool.execute({ content: '不同正文' }, exec), /不允许重复覆盖/)
  assert.equal(concluded, 1)
  assert.equal(storySubmissionForTurn(session, 2).text, '已提交')
})

test('系统指令只随游玩开关启用，不影响 card 或旧存档', async () => {
  for (const mode of ['story', 'script', 'card']) for (const enabled of [false, true]) {
    const chat = { mode, storyToolCallEnabled: enabled }
    const strategy = createNativePlayOrchestrationStrategy({ modeFor: async () => mode, visibleTools: async () => storyToolCallEnabled(chat) ? ['submit_story', 'tavern_recall_history'] : ['tavern_recall_history'], controlledToolNames: new Set(['submit_story']), modePrompt: () => 'card', cardSystemPrompt: () => '卡片', workspaceContext: () => '', resolvePreset: async () => null })
    const assembly = await strategy.assembleSystemPrompt({ tools: [{ name: 'submit_story' }, { name: 'tavern_recall_history' }], sections: [], fixedSystemSections: [{ name: 'tavern:base', text: '底座' }] }, { chat, sessionId: 'game' })
    assert.equal(assembly.tools.some(tool => tool.name === 'submit_story'), mode !== 'card' && enabled)
    assert.equal(assembly.sections.some(section => section.name === 'tavern:story-tool-submission'), mode !== 'card' && enabled)
    assert.equal(assembly.tools.some(tool => tool.name === 'tavern_recall_history'), true)
  }
  assert.equal(storyToolCallEnabled({ mode: 'story' }), false)
})

test('会话状态投影保留正文工具开关，工具可见性判定不受收窄读取影响', async () => {
  const { projectChatSessionState } = await import('../tavern-plugin/lib/domain/chat-session-state.js')
  // The foreground orchestrator reads its chats through the scoped state
  // projection; a header-only toggle must survive that whitelist.
  assert.equal(projectChatSessionState({ id: 'c', mode: 'story', storyToolCallEnabled: true, messages: [] }).storyToolCallEnabled, true)
  assert.equal(projectChatSessionState({ id: 'c', mode: 'story', storyToolCallEnabled: false, messages: [] }).storyToolCallEnabled, false)
  assert.equal(projectChatSessionState({ id: 'c', mode: 'story', messages: [] }).storyToolCallEnabled, undefined)
  assert.equal(storyToolCallEnabled(projectChatSessionState({ id: 'c', mode: 'script', storyToolCallEnabled: true, messages: [] })), true)
})

const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const hooks = await readFile(new URL('../tavern-plugin/lib/hooks/turn-lifecycle.js', import.meta.url), 'utf8')
const client = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
// The production rewrite helper, extracted with its real collaborators.
const replaceAssistantReplyContext = { storySubmissionSurfaceRange, replaceSessionSurface, appendSessionEvent, randomUUID }
vm.runInNewContext(
  server.slice(server.indexOf('  function replaceAssistantReply('), server.indexOf('  // A game keeps a snapshot of its preset')) + '; this.replace = replaceAssistantReply',
  replaceAssistantReplyContext
)
const replaceAssistantReply = replaceAssistantReplyContext.replace

test('真实 setter 独立保存当前对话，拒绝错误参数、工作台和运行中修改', async () => {
  const chats = new Map([['a', { mode: 'story' }], ['b', { mode: 'script' }], ['card', { mode: 'card' }]])
  const sessions = new Map(), writes = []
  const context = { chatForSession: async id => chats.get(id), agentRegistry: new Map(), sessionStore: sessions, activeStoryTurn, writeChat: async (chat, options) => writes.push([chat, options]) }
  const start = server.indexOf('  async function setStoryToolCallEnabled(')
  vm.runInNewContext(server.slice(start, server.indexOf('  async function setRequestMode(', start)) + '; this.toggle = setStoryToolCallEnabled', context)
  assert.equal(await context.toggle('a', true), true)
  assert.equal(chats.get('a').storyToolCallEnabled, true)
  assert.equal(chats.get('b').storyToolCallEnabled, undefined)
  assert.equal(writes[0][1].source, 'story-tool-call.set')
  assert.equal(await context.toggle('a', false), false)
  await assert.rejects(context.toggle('a', 'true'), /布尔值/)
  await assert.rejects(context.toggle('missing', true), /没有绑定/)
  await assert.rejects(context.toggle('card', true), /卡片工作台/)
  sessions.set('a', { events: [{ type: 'turn/start', data: { turn: 2 } }] })
  await assert.rejects(context.toggle('a', true), /等待当前生成/)
  assert.equal(chats.get('a').storyToolCallEnabled, false)
  assert.match(server, /case 'setStoryToolCallEnabled':/)
  assert.match(server, /storyToolCallEnabled: chat.storyToolCallEnabled === true/)
})

test('真实收尾 hook 把工具提交回合改写为普通文字回复', async () => {
  let hook, saved
  const session = fixture('最终正文')
  const context = { ctx: { on(_name, handler) { hook = handler } }, clearRuntimePresetRequestState() {},
    backgroundAgentRunner: { owns: () => false, requestContext: () => undefined }, fullTemplateRuntime: { cancel() {} },
    userMessageForTurn: () => ({ content: [{ type: 'text', text: '玩家输入' }] }),
    contentText: message => (Array.isArray(message?.content) ? message.content.filter(block => block?.type === 'text').map(block => block.text).join('') : ''),
    inputAttachments: content => (Array.isArray(content) ? content.filter(block => block?.type === 'image') : []),
    requestIdForTurn: () => 'rpc-1', roundAnchor: () => null, inputEventForTurn: () => null,
    assistantResultForTurn, turnOrchestrator: { recordFailure() { throw new Error('不应误判空正文') } },
    foregroundHandoff: { async finalize(input) { saved = input; return { reply: { sessionText: '正则投影正文' } } } },
    replaceAssistantReply }
  const start = hooks.indexOf("  ctx.on('agent/turn-stopping'")
  const end = hooks.indexOf("  ctx.on('agent/error'", start)
  vm.runInNewContext(hooks.slice(start, end), context)
  const assistant = assistantResultForTurn(session, 2)
  assert.equal(assistant.storyToolSubmission, true)
  await hook({ agent: { session }, turn: 2 })
  assert.equal(saved.assistantText, '最终正文')
  assert.equal(saved.requestId, 'rpc-1')
  // The call message through its receipt is replaced by one plain text reply.
  const surfaceEvents = session.surface.nodes.map(seq => session.events.find(event => event.seq === seq))
  const projections = surfaceEvents.filter(event => event.type === 'assistant/message')
  assert.equal(projections.length, 1)
  const projectionMessage = projections[0].data.message
  assert.equal(projectionMessage.source.model, 'reply-projection')
  assert.equal(projectionMessage.content.length, 1)
  assert.equal(projectionMessage.content[0].type, 'text')
  assert.equal(projectionMessage.content[0].text, '正则投影正文')
  assert.ok(!surfaceEvents.some(event => JSON.stringify(event).includes('submit_story')), 'surface 上不应再留下 submit_story 的调用或回执')
  const read = assistantResultForTurn(session, 2)
  assert.equal(read.text, '正则投影正文')
  assert.notEqual(read.storyToolSubmission, true)
  // Replaying the same replacement is a no-op, never an error.
  replaceAssistantReply(session, assistant, '正则投影正文')
  assert.deepEqual(session.surface.nodes, [0, 5])
  assert.equal(session.events.length, 6)
})

test('正文未被正则改变时仍消除工具调用与回执，普通文字回复保持不动', () => {
  const session = fixture('原样正文')
  const assistant = assistantResultForTurn(session, 2)
  replaceAssistantReply(session, assistant, assistant.text)
  const replies = session.surface.nodes.map(seq => session.events.find(event => event.seq === seq))
    .filter(event => event.type === 'assistant/message')
  assert.equal(replies.length, 1)
  assert.equal(replies[0].data.message.content[0].type, 'text')
  assert.equal(replies[0].data.message.content[0].text, '原样正文')
  const count = session.events.length
  replaceAssistantReply(session, assistantResultForTurn(session, 2), '原样正文')
  assert.equal(session.events.length, count, '普通文字的相同正文不再追加事件')
})

test('工具回执已不在 surface 时不会追加孤立文字', () => {
  const session = fixture('原样正文')
  const assistant = assistantResultForTurn(session, 2)
  session.surface.nodes = [0]
  replaceAssistantReply(session, assistant, assistant.text)
  assert.equal(session.events.length, 4)
  assert.deepEqual(session.surface.nodes, [0])
})

test('菜单开关携带 sessionId，加载或生成中禁用，失败不改变服务端值', async () => {
  let current = { mode: 'story', storyToolCallEnabled: false }, running = false, calls = [], errors = [], busy = false
  const context = { React: { useState: () => [busy, value => { busy = value }], useEffect() {}, createElement: (type, props, ...children) => ({ type, props, children }) },
    useLiveTavernView: () => ({ view: current }), liveTavernView: { invalidate(id) { calls.push(['invalidate', id]) } },
    rpc: async (method, args, id) => { calls.push([method, args.enabled, id]); current.storyToolCallEnabled = args.enabled }, notifyTavernDataChanged() {}, tavernErrorHub: { report(_name, error) { errors.push(error.message) } } }
  const start = client.indexOf('function TavernStoryToolCallSetting(')
  vm.runInNewContext(client.slice(start, client.indexOf('function TavernMoreActions(', start)) + '; this.render = TavernStoryToolCallSetting', context)
  const props = { sessionId: 'game-a', useSession: selector => selector({ running }) }
  let button = context.render(props)
  assert.equal(button.props.role, 'menuitemcheckbox')
  assert.equal(button.props['aria-checked'], false)
  assert.match(button.children.join(''), /正文走工具调用：关/)
  await button.props.onClick()
  assert.deepEqual(calls[0], ['setStoryToolCallEnabled', true, 'game-a'])
  assert.equal(context.render(props).props['aria-checked'], true)
  running = true
  assert.equal(context.render(props).props.disabled, true)
  running = false; current = null
  assert.equal(context.render(props).props.disabled, true)
  current = { storyToolCallEnabled: true }
  context.rpc = async () => { throw new Error('保存失败') }
  await context.render(props).props.onClick()
  assert.deepEqual(errors, ['保存失败'])
  assert.equal(current.storyToolCallEnabled, true)
  assert.equal(busy, false)
})
