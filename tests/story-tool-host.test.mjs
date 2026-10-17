import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'

// Real DSH Agent Loop host test for the story-tool submission feature.
// Boots the linked runtime with an in-memory scripted LLM, without network or user data.
const DOMAIN = new URL('../tavern-plugin/lib/domain/', import.meta.url)

function resolveBootModule() {
  if (process.env.DSH_BOOT_MODULE) return process.env.DSH_BOOT_MODULE
  try {
    const pluginRequire = createRequire(new URL('../tavern-plugin/package.json', import.meta.url))
    return createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools')).resolve('@deepseek-ai/dsh-app-boot')
  } catch { return null }
}
const BOOT_MODULE = resolveBootModule()
const native = { skip: !BOOT_MODULE, timeout: 60000 }

async function createStoryHost(bootModule) {
  const bootUrl = pathToFileURL(bootModule)
  const { boot } = await import(bootUrl.href)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const { defineTool } = await import(new URL('../../dsh-tools/lib/index.js', bootUrl))
  const { createStorySubmissionTool, storySubmissionForTurn, foldStorySubmission } = await import(new URL('story-tool-submission.js', DOMAIN))
  const { assistantResultForTurn } = await import(new URL('session-turn-result.js', DOMAIN))
  const { sessionEvents, appendSessionEvent } = await import(new URL('session-events.js', DOMAIN))
  const { replaceSessionSurface } = await import(new URL('session-surface-mutations.js', DOMAIN))
  const { installTavernTokenMeter } = await import(new URL('tavern-token-meter.js', DOMAIN))
  const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const rewrite = { foldStorySubmission, replaceSessionSurface, appendEvent: appendSessionEvent, randomUUID }
  vm.runInNewContext(server.slice(server.indexOf('  function replaceAssistantReply('), server.indexOf('  // A game keeps a snapshot of its preset')) + '; this.replace = replaceAssistantReply', rewrite)
  const root = await mkdtemp(join(tmpdir(), 'tavern-story-host-'))
  const config = join(root, 'host.yml')
  const packages = ['dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-agent-loop']
  await writeFile(config, packages.map(name => '- id: ' + name + '\n  name: ' + new URL('../../' + name + '/lib/index.js', bootUrl).href + '\n').join(''))
  const ctx = await boot('story-tool-host-test', config)
  const selection = { provider: 'story-fixture', model: 'text' }
  const chatStore = { chat: { storyToolCallEnabled: true }, rewrite: false }
  const meterDisposer = installTavernTokenMeter(ctx.tokenMeter)
  ctx.on('agent/turn-stopping', payload => {
    if (!chatStore.rewrite) return
    const session = payload.agent.session
    const submission = assistantResultForTurn(session, payload.turn)
    if (submission?.storyToolSubmission) rewrite.replace(session, submission, submission.text)
  })
  ctx.tools.register(defineTool(createStorySubmissionTool({
    chatForSession: () => chatStore.chat,
    isBackground: () => false
  })))
  ctx.tools.register(defineTool({
    name: 'story_search', description: '查询背景资料',
    parameters: { query: { type: 'string', required: true, description: '查询词' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) { return '背景资料：' + (args && args.query || '') }
  }))
  const state = { plan: [], index: 0, requests: 0, inputs: [] }
  class FixtureModel extends LlmAdapter {
    async *stream(input) {
      state.requests += 1
      state.inputs.push(input)
      const step = state.plan[state.index++] || { kind: 'text', text: '结束本轮。' }
      if (step.kind === 'tool') {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-' + (state.requests - 1), name: step.name, arguments: JSON.stringify(step.args) } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: step.text } }
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter([selection.provider], new FixtureModel())
  async function runTurn(plan, options = {}) {
    chatStore.chat = options.chat || { storyToolCallEnabled: true }
    chatStore.rewrite = options.rewrite === true
    const measurements = []
    state.plan = plan
    state.index = 0
    state.requests = 0
    state.inputs = []
    const handle = await ctx.agents.create({ sessionId: 'story-' + randomUUID(), seed: [], agentOptions: selection })
    const agent = handle.agent
    agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: '开始。' }], source: { kind: 'human' } })
    await agent.whenIdle()
    if (options.rewrite) measurements.push(ctx.tokenMeter.measure(agent.session))
    if (options.secondTurn) {
      agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: '继续。' }], source: { kind: 'human' } })
      await agent.whenIdle()
      if (options.rewrite) measurements.push(ctx.tokenMeter.measure(agent.session))
    }
    const session = agent.session
    const events = sessionEvents(session)
    const result = {
      requests: state.requests, inputs: state.inputs, measurements, session, events,
      turnStarts: events.filter(event => event.type === 'turn/start').length,
      turnEnds: events.filter(event => event.type === 'turn/end').length,
      last: events.at(-1)?.type
    }
    await handle.dispose()
    return result
  }
  async function dispose() {
    meterDisposer()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
  return { runTurn, dispose, assistantResultForTurn, storySubmissionForTurn }
}

test('scripted LLM 仅返回 submit_story tool-call：总前台请求 1、turn 完成、提取正文成功', native, async t => {
  const host = await createStoryHost(BOOT_MODULE)
  t.after(() => host.dispose())
  const result = await host.runTurn([{ kind: 'tool', name: 'submit_story', args: { content: '雨水扑进房间。' } }])
  assert.equal(result.requests, 1, '提交即结束，不应再发起第二次前台请求')
  assert.equal(result.turnStarts, 1)
  assert.equal(result.turnEnds, 1)
  assert.equal(result.events.find(event => event.type === 'turn/end').data.reason.kind, 'completed')
  assert.equal(result.last, 'turn/end')
  const extracted = host.assistantResultForTurn(result.session, 1)
  assert.ok(extracted)
  assert.equal(extracted.text, '雨水扑进房间。')
  assert.equal(extracted.storyToolSubmission, true)
  const submission = host.storySubmissionForTurn(result.session, 1)
  assert.ok(submission)
  assert.equal(submission.text, '雨水扑进房间。')
  assert.equal(submission.content, '雨水扑进房间。')
})

test('先查询后提交：2 次前台请求且无第 3 次', native, async t => {
  const host = await createStoryHost(BOOT_MODULE)
  t.after(() => host.dispose())
  const result = await host.runTurn([
    { kind: 'tool', name: 'story_search', args: { query: '天气' } },
    { kind: 'tool', name: 'submit_story', args: { content: '她推开门。' } }
  ])
  assert.equal(result.requests, 2)
  assert.equal(result.turnEnds, 1)
  assert.equal(result.last, 'turn/end')
  assert.ok(!result.events.some(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'text' && block.text === '结束本轮。')))
  const extracted = host.assistantResultForTurn(result.session, 1)
  assert.ok(extracted)
  assert.equal(extracted.text, '她推开门。')
  assert.equal(extracted.storyToolSubmission, true)
})

test('两轮工具正文保留合法上下文配对，下一轮能读取前一轮完整正文', native, async t => {
  const host = await createStoryHost(BOOT_MODULE)
  t.after(() => host.dispose())
  const result = await host.runTurn([
    { kind: 'tool', name: 'submit_story', args: { content: '第一轮：雨水扑进房间。' } },
    { kind: 'tool', name: 'submit_story', args: { content: '第二轮：她推开门。' } }
  ], { secondTurn: true })
  assert.equal(result.requests, 2)
  assert.equal(result.turnEnds, 2)
  assert.equal(host.assistantResultForTurn(result.session, 1).text, '第一轮：雨水扑进房间。')
  assert.equal(host.assistantResultForTurn(result.session, 2).text, '第二轮：她推开门。')
  const blocks = result.inputs[1].messages.flatMap(message => message.content)
  const call = blocks.find(block => block.type === 'tool-call' && block.name === 'submit_story')
  const receipt = blocks.find(block => block.type === 'tool-result' && block.toolCallId === call.id)
  assert.ok(receipt)
  assert.equal(receipt.content[0].text, '第一轮：雨水扑进房间。')
})

test('真实收尾改写后两轮都可计量，第二轮上下文只剩一份正文', native, async t => {
  const host = await createStoryHost(BOOT_MODULE)
  t.after(() => host.dispose())
  const result = await host.runTurn([
    { kind: 'tool', name: 'submit_story', args: { content: '第一轮：雨水扑进房间。' } },
    { kind: 'tool', name: 'submit_story', args: { content: '第二轮：她推开门。' } }
  ], { secondTurn: true, rewrite: true })
  assert.equal(result.measurements.length, 2)
  assert.ok(result.measurements.every(measurement => measurement.totalTokens > 0))
  const projections = result.events.filter(event => event.type === 'assistant/message' && event.data.message.source?.model === 'reply-projection')
  assert.equal(projections.length, 4)
  const calls = result.events.filter(event => event.type === 'assistant/message' &&
    (event.data.message.content || []).some(block => block.type === 'tool-call' && block.name === 'submit_story'))
  for (let index = 0; index < projections.length; index += 2) {
    const shown = projections[index], folded = projections[index + 1]
    assert.equal(shown.surfaceOp, 'append')
    assert.equal(folded.surfaceOp.op, 'replace')
    // The fold appends the visible copy, then shadows the call, its receipt and
    // that copy: the range must cite every node it removes.
    assert.equal(folded.surfaceOp.startSeq, calls[index / 2].seq)
    assert.equal(folded.surfaceOp.endSeq, shown.seq)
    assert.deepEqual(folded.sourceEventSeqs.slice(-1), [shown.seq])
    assert.ok(folded.sourceEventSeqs.length >= 3, '调用、回执与追加文字都要被引用')
    assert.deepEqual(shown.data.message.content, folded.data.message.content)
  }
  assert.equal(result.requests, 2)
  assert.equal(result.turnEnds, 2)
  const blocks = result.inputs[1].messages.flatMap(message => message.content)
  assert.ok(!blocks.some(block => block.type === 'tool-call' && block.name === 'submit_story'))
  assert.ok(!blocks.some(block => block.type === 'tool-result'))
  assert.equal(blocks.filter(block => block.type === 'text' && block.text === '第一轮：雨水扑进房间。').length, 1)
})

test('未开启 storyToolCallEnabled 时 submit_story 执行拒绝且不构成提交', native, async t => {
  const host = await createStoryHost(BOOT_MODULE)
  t.after(() => host.dispose())
  const result = await host.runTurn([{ kind: 'tool', name: 'submit_story', args: { content: '正文' } }], { chat: { storyToolCallEnabled: false } })
  assert.equal(host.storySubmissionForTurn(result.session, 1), null)
  assert.ok(result.events.some(event => event.type === 'tool/result' && event.data.message?.content.some(part => part.isError === true)))
})
