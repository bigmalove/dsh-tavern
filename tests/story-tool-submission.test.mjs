import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { createStorySubmissionTool, foldStorySubmission, storySubmissionForTurn } from "../tavern-plugin/lib/domain/story-tool-submission.js"
import { assistantResultForTurn } from '../tavern-plugin/lib/domain/session-turn-result.js'
function fixture(content = '<game>正文\\引号"\n新行</game>', { error = false, result = content, turn = 2, legacy = false } = {}) {
  const raw = JSON.stringify({ content })
  return { id: 'game', events: [
    { type: 'turn/start', data: { turn } },
    { type: 'assistant/message', data: { turn, message: { id: 'model-1', source: { kind: 'model' }, content: [
      { type: 'reasoning', text: '思考' }, { type: 'text', text: '不应覆盖提交的杂话' },
      { type: 'tool-call', id: 'submit-1', name: 'submit_story', arguments: raw }
    ] } } },
    { type: 'tool/call', data: { turn, callId: 'submit-1', name: 'submit_story', arguments: raw } },
    // 0.2.1 lifts the receipt into a first-class tool message; `legacy` keeps the
    // tool-result block older logs still hold.
    { type: 'tool/result', data: { turn, message: legacy
      ? { role: 'user', content: [{ type: 'tool-result', toolCallId: 'submit-1', isError: error, content: [{ type: 'text', text: result }] }] }
      : { role: 'tool', toolCallId: 'submit-1', isError: error, content: [{ type: 'text', text: result }] } } }
  ] }
}

test('回滚或重新生成遮蔽的旧工具提交不会重新成为正文', () => {
  const session = fixture('旧正文')
  session.surface = { nodes: [0, 4] }
  session.events.push({ type: 'assistant/message', data: { turn: 2, message: { source: { kind: 'model' }, content: [{ type: 'text', text: '重新生成的正文' }] } } })
  assert.equal(storySubmissionForTurn(session, 2), null)
  assert.equal(assistantResultForTurn(session, 2).text, '重新生成的正文')
})

test('工具仅允许已开启的前台 story/script，拒绝空正文、后台、失效宿主和已结束回合', async () => {
  let chat = { mode: 'story' }, enabled = true, background = false, concluded = 0
  const tool = createStorySubmissionTool({ chatForSession: async () => chat, enabled: async () => enabled, isBackground: () => background })
  const session = { id: 'game', events: [{ type: 'turn/start', data: { turn: 1 } }] }
  const exec = { agent: { session }, signal: new AbortController().signal, concludeTurn() { concluded++ } }
  assert.equal(await tool.execute({ content: '正文' }, exec), '正文')
  assert.equal(concluded, 1)
  assert.equal(tool.isConcurrencySafe(), false)
  for (const content of ['', '  ', null, 123]) await assert.rejects(tool.execute({ content }, exec), /正文不能为空/)
  for (chat of [undefined, { mode: 'card' }]) await assert.rejects(tool.execute({ content: '正文' }, exec), /未开启/)
  chat = { mode: 'story' }; enabled = false
  await assert.rejects(tool.execute({ content: '正文' }, exec), /未开启/)
  chat = { mode: 'script' }; enabled = true
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

test('旧档的 tool-result 块仍能认出提交正文', () => {
  const session = fixture('旧档提交的正文', { legacy: true })
  const submission = storySubmissionForTurn(session, 2)
  assert.equal(submission && submission.text, '旧档提交的正文')
  assert.equal(submission.storyToolSubmission, true)
})

test('0.2.1 的独立 tool 消息就是提交回执，正文取自工具参数', () => {
  const session = fixture('她推开门。')
  const submission = storySubmissionForTurn(session, 2)
  assert.equal(submission && submission.content, '她推开门。')
  assert.equal(assistantResultForTurn(session, 2).text, '她推开门。')
  assert.equal(assistantResultForTurn(session, 2).storyToolSubmission, true)
})

test('回执被宿主改写（截断/加前缀）时仍以调用参数里的正文为准', () => {
  const content = '她推开门。'
  const session = fixture(content, { result: '已提交：她推开门。' })
  const submission = storySubmissionForTurn(session, 2)
  assert.ok(submission, '回执不逐字相等也必须是提交')
  assert.equal(submission.text, content)
  assert.equal(submission.echoed, false)
})

test('折叠失败返回 false 而不是抛错，调用方才能退化成普通正文', () => {
  const result = { event: { data: { turn: 1, step: 1, message: { id: 'm-1', role: 'assistant', source: { kind: 'model' }, content: [] } } }, receiptIndex: 9, index: 99, content: '正文' }
  // surface 上没有这个回合的节点：范围算不出来，必须返回 false 让调用方兜底，
  // 不能抛错——turn-stopping 里抛错会让回合结束不了，界面一直等。
  assert.equal(foldStorySubmission({ surface: { nodes: [] }, events: [] }, result, '正文'), false)
})

test('工具被拒时只返回原始错误，不再附带「改为直接输出」的提示', async () => {
  const off = createStorySubmissionTool({ chatForSession: async () => ({ mode: 'card' }), enabled: async () => true, isBackground: () => false })
  const exec = { agent: { session: { id: 's', events: [] } }, signal: new AbortController().signal, concludeTurn() {} }
  await assert.rejects(off.execute({ content: '正文' }, exec), error => error.message === '未开启正文走工具调用')
  const on = createStorySubmissionTool({ chatForSession: async () => ({ mode: 'story' }), enabled: async () => true, isBackground: () => false })
  const live = { agent: { session: { id: 's', events: [{ type: 'turn/start', data: { turn: 1 } }] } }, signal: new AbortController().signal, concludeTurn() {} }
  await assert.rejects(on.execute({ content: '' }, live), error => error.message === '正文不能为空，content 必须是非空字符串')
})

const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const hooks = await readFile(new URL('../tavern-plugin/lib/hooks/turn-lifecycle.js', import.meta.url), 'utf8')
