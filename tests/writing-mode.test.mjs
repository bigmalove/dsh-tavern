import assert from 'node:assert/strict'
import test from 'node:test'

import { initializationFixture } from './fixtures/conversation-initialization.mjs'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'

// Local harness reuse: the turn-orchestration fixture is defined inside its own test
// file, so the writing turn test below drives the same modules directly.
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createForegroundFrameBuilder, foregroundFrameText } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { renderTavernMacros } from '../tavern-plugin/lib/domain/tavern-macro-engine.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createForegroundFrameSessionAdapter } from '../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'
import { sessionSeedTrajectoryMessages } from '../tavern-plugin/lib/domain/session-seed-trajectory.js'

const clone = value => value === undefined ? undefined : structuredClone(value)

function seedMessages(session) {
  return session.events.filter(event => {
    const source = event.type === 'assistant/message' ? event.data?.message?.source : event.data?.source
    return source?.form === 'synthetic-trajectory' || source?.model === 'synthetic-trajectory'
  })
}

function seedId(event) {
  return event.type === 'assistant/message' ? event.data?.message?.id : event.data?.id
}

test('写作模式：无人物卡新建空白会话，写入作者契约的种子轨迹，不落卡片快照', async () => {
  const h = initializationFixture()
  const chat = await h.make().start({ cardPath: '', sessionId: 'session', mode: 'writing', userName: '作者' })

  assert.equal(chat.mode, 'writing')
  assert.equal(chat.cardPath, '')
  assert.equal(chat.cardName, '写作')
  assert.deepEqual(chat.messages, [])
  assert.equal(chat.openingText, '')
  assert.equal(chat.mvu.enabled, false)
  assert.equal(chat.sceneImagesEnabled, false)
  assert.equal(chat.imageModelSelection, null)
  assert.equal(chat.backgroundTasks.posture, false)
  assert.equal(chat.backgroundTasks.characterDesign, false)
  assert.equal(chat.cardContextSnapshot, '')
  assert.equal(chat.cardContextSnapshotVersion, 7)
  assert.equal(h.session().prefix ?? '', '')
  assert.equal(h.state.reads, 0, '写作会话不读人物卡')

  const seed = seedMessages(h.session())
  assert.deepEqual(seed.map(event => event.type), ['user/message', 'assistant/message', 'user/message'])
  assert.ok(seed.every(event => /^tavern-seed-trajectory:v2:/.test(seedId(event))), '写作会话用 v2 种子')
  assert.match(seed[0].data.content[0].text, /我是作者，不扮演故事中的任何角色/)
  assert.match(seed[1].data.message.content[0].text, /写作指令/)
  assert.ok(seed.every(event => event.seq < h.session().durable.length))
})

test('写作模式重入不重复写种子、不改写已有会话', async () => {
  const h = initializationFixture()
  const first = await h.make().start({ cardPath: '', sessionId: 'session', mode: 'writing', userName: '作者' })
  const events = clone(h.session().events)
  const second = await h.make().start({ cardPath: '', sessionId: 'session', mode: 'writing', userName: '作者' })

  assert.deepEqual(h.session().events, events)
  assert.equal(second.id, first.id)
  assert.equal(seedMessages(h.session()).length, 3)
})

test('游玩模式仍然要求人物卡：空路径直接拒绝', async () => {
  const h = initializationFixture()
  await assert.rejects(h.make().start({ cardPath: '', sessionId: 'session', mode: 'story' }), /人物卡不存在/)
  assert.equal(h.saved.size, 0)
})

test('写作种子轨迹接受显式模式，游玩模式的 v1 文本保持原样', () => {
  const play = sessionSeedTrajectoryMessages('s', undefined)
  const writing = sessionSeedTrajectoryMessages('s', 'writing')
  assert.match(play[2].data.id, /^tavern-seed-trajectory:v1:s:3$/)
  assert.match(writing[2].data.id, /^tavern-seed-trajectory:v2:s:3$/)
  assert.match(play[0].text, /本轮演出指引/)
  assert.match(writing[0].text, /不扮演故事中的任何角色/)
})

function writingHarness(options = {}) {
  const plannerCalls = []
  const cardReads = []
  let chat = {
    id: 'chat-w', cardPath: '', cardName: '写作', mode: 'writing',
    messages: [], posture: '', guides: [], nativeCommits: {},
    ledger: null, preparedWorldBookContext: '',
    webSearchEnabled: false, runtimePresetSnapshot: { planId: 'preset', regexScripts: [] },
    macroState: { userName: '你', local: {}, global: {} },
    scriptState: null, workspace: null, _storageRevision: 1
  }
  const timeline = createStoryTimeline({ id: prefix => prefix + '-1', now: () => 2000 })
  const store = {
    async chatForSession() { return clone(chat) },
    async readCard() { cardReads.push('readCard'); return undefined },
    async readCardExtensions() { return { regexScripts: [] } },
    async readScript() { return undefined },
    async writeChat(value, metadata) {
      const revision = Math.max(0, Number(chat._storageRevision) || 0) + 1
      let next = clone(value)
      if (metadata && metadata.source === 'foreground.commit') {
        const settlement = timeline.apply({ chat: next, intent: { kind: 'agent.begin', role: 'settlement' } })
        next = timeline.complete({ chat: settlement.chat, operationId: settlement.value.operationId, basedOn: settlement.value.basedOn, outcome: { status: 'success' } }).chat
      }
      chat = next
      chat._storageRevision = revision
      value._storageRevision = revision
    }
  }
  const prompt = options.prompt || (name => '提示词:' + name)
  const orchestrator = createTurnOrchestrator({
    store,
    planner: {
      async plan(input) {
        plannerCalls.push(clone(input))
        return options.planner ? options.planner.plan(input) : { text: 'ctx:' + input.purpose, systemPromptText: '' }
      }
    },
    scripts: createScriptContinuity(),
    timeline,
    frameBuilder: createForegroundFrameBuilder(),
    cards: { update: () => { throw new Error('写作模式不写卡片') } },
    workspace: null,
    queueSettlement: () => {},
    renderMacros: (text, value) => renderTavernMacros(text, {
      charName: value.cardName, userName: value.macroState.userName,
      localVariables: value.macroState.local, globalVariables: value.macroState.global
    }).text,
    projectReply: projectReplyLayers,
    now: () => 2000
  })
  return { orchestrator, plannerCalls, cardReads, chat: () => clone(chat), prompt }
}

test('写作回合：正文提示词走写作规则，无卡片段落，帧与提交照常', async () => {
  const planner = createContextPlanner({ prompt: writingHarness().prompt })
  const run = writingHarness({ planner })
  const prepared = await run.orchestrator.prepare({ sessionId: 'session-w', turn: 1, userText: '写一场雨夜追逐戏。' })

  assert.equal(prepared.ready, true)
  assert.equal(prepared.mode, 'writing')
  assert.equal(prepared.userText, '写一场雨夜追逐戏。')
  assert.ok(prepared.frame, '写作回合有前台帧')

  const body = run.plannerCalls.find(call => call.purpose === 'body')
  assert.ok(body, '调用正文规划')
  assert.equal(body.card, null)
  assert.equal(body.chat.mode, 'writing')
  assert.match(body.text === undefined ? '' : String(body.text), /^$/)
  const sections = run.plannerCalls.filter(call => call.purpose === 'body')
  assert.equal(sections.length, 1)
  assert.equal(run.cardReads.length, 0, '写作回合不读人物卡')

  await run.orchestrator.finalize({ sessionId: 'session-w', turn: 1, userText: '写一场雨夜追逐戏。', assistantText: '雨砸在青石板上。' })
  const chat = run.chat()
  assert.deepEqual(chat.messages.map(message => message.role), ['user', 'assistant'])
  assert.equal(chat.messages[0].text, '写一场雨夜追逐戏。')
  assert.match(chat.messages[1].text, /雨砸在青石板上。/)
  assert.equal(chat.foregroundError, null)
})

test('写作会话的正文规划：基础段用 writing 提示词，且不带人物卡段落', async () => {
  const planner = createContextPlanner({ prompt: name => '【' + name + '】' })
  const planned = await planner.plan({
    purpose: 'body',
    card: null,
    chat: { mode: 'writing', macroState: { userName: '你', local: {}, global: {} }, guides: [] },
    worldBookContext: '', userText: '继续'
  })
  assert.match(planned.text, /【writing】/)
  assert.doesNotMatch(planned.text, /【story】/)
  assert.doesNotMatch(planned.text, /人物卡/)

  const playPlanned = await planner.plan({
    purpose: 'body',
    card: { name: '阿芙拉', system_prompt: '', post_history_instructions: '' },
    chat: { mode: 'story', macroState: { userName: '你', local: {}, global: {} }, guides: [] },
    worldBookContext: '', userText: '继续'
  })
  assert.match(playPlanned.text, /【story】/)
})

test('写作会话的稳定前缀只含长期偏好，卡片与世界书不进前缀', async () => {
  const planner = createContextPlanner({ prompt: name => '【' + name + '】' })
  const planned = await planner.plan({ purpose: 'play-card-snapshot', card: null, chat: { mode: 'writing' }, worldBookContext: '固定世界书', worldBookLabel: '常驻世界书' })
  assert.equal(planned.text, '')
})

test('写作会话的候选规划不读人物卡，也不崩', async () => {
  const planner = createContextPlanner({ prompt: name => '【' + name + '】' })
  const planned = await planner.plan({
    purpose: 'candidate',
    task: '给出 3 个候选',
    card: null,
    chat: { mode: 'writing', macroState: { userName: '你', local: {}, global: {} }, guides: [] },
    constantWorldBookContext: ''
  })
  assert.match(planned.text, /给出 3 个候选/)
})

const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }
const openingEvents = session => sessionEvents(session).filter(event => event.type === 'assistant/message' && event.data.turn === 1)

test('原生写作会话：无开场白、写 v2 作者契约、恢复幂等', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  const chat = await h.open().start({ ...h.input, cardPath: '', mode: 'writing' })

  assert.equal(chat.mode, 'writing')
  assert.equal(chat.cardPath, '')
  assert.equal(chat.nativeOpeningAppended, true)
  assert.equal(openingEvents(h.target.session).length, 0)

  const messages = h.target.session.deriveMessages()
  const seed = messages.filter(message => String(message.id).startsWith('tavern-seed-trajectory:v2:'))
  assert.equal(seed.length, 3)
  assert.match(seed[0].content[0].text, /我是作者，不扮演故事中的任何角色/)
  assert.equal(messages.some(message => String(message.id).startsWith('tavern-seed-trajectory:v1:')), false)
  // 写作会话没有人物卡固定背景：既不写固定前缀，也不带卡片内容。
  assert.equal(messages.filter(message => String(message.id).startsWith('tavern-session-prefix:')).length, 0)
  assert.equal(h.requests.length, 0, '开局不调用模型')

  const before = structuredClone(messages)
  await h.restoreDetached()
  const restored = await h.open().ensureOpening(h.input.sessionId)
  assert.equal(restored.id, chat.id)
  assert.deepEqual(h.target.session.deriveMessages(), before)
})

test('原生写作会话的第一轮请求不含人物卡与世界书，只带上作者契约', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  await h.open().start({ ...h.input, cardPath: '', mode: 'writing' })
  await h.continueWithAgent()

  assert.equal(h.requests.length, 1)
  const request = h.requests[0]
  assert.doesNotMatch(request.system, /不可丢失的固定背景/, '写作会话不注入人物卡背景')
  assert.doesNotMatch(request.system, /Fixture constant worldbook/, '写作会话不注入常驻世界书')
  assert.equal(JSON.stringify(request.messages).includes('Fixture recalled worldbook'), false, '写作会话不做世界书召回')
  assert.match(JSON.stringify(request.messages), /我是作者，不扮演故事中的任何角色/, '作者契约随会话历史进入请求')
})
