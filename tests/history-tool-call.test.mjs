import assert from 'node:assert/strict'
import test from 'node:test'
import { HISTORY_CALL_PREFIX, HISTORY_RECEIPT_TEXT, projectHistoryAsToolCalls } from '../tavern-plugin/lib/domain/history-tool-call.js'

function body(id, text) {
  return { id, role: 'assistant', source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }, content: [{ type: 'text', text }] }
}

const TOOL = 'submit_story'

test('历史正文改成提交调用并紧跟一条回执，正文只出现一次', () => {
  const messages = [
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '玩家输入' }] },
    body('message-1', '第一轮正文'),
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] }
  ]
  const projected = projectHistoryAsToolCalls(messages, { toolName: TOOL })
  assert.equal(projected.length, 4)
  assert.deepEqual(projected.map(message => message.role), ['user', 'assistant', 'tool', 'user'])
  const call = projected[1]
  assert.equal(call.id, 'message-1')
  assert.deepEqual(call.content.map(block => block.type), ['tool-call'])
  assert.equal(call.content[0].name, TOOL)
  assert.deepEqual(JSON.parse(call.content[0].arguments), { content: '第一轮正文' })
  const receipt = projected[2]
  // DSH 0.2 (session v4) sends a tool result as a first-class tool message.
  assert.equal(receipt.role, 'tool')
  assert.deepEqual(receipt.source, { kind: 'tool', callId: call.content[0].id })
  assert.equal(receipt.toolCallId, call.content[0].id)
  assert.equal(receipt.isError, false)
  assert.deepEqual(receipt.content, [{ type: 'text', text: HISTORY_RECEIPT_TEXT }])
  // The body characters live in the arguments only.
  assert.equal(JSON.stringify(projected).split('第一轮正文').length - 1, 1)
  // The original array is untouched.
  assert.equal(messages.length, 3)
})

test('只改模型写的纯正文，插件消息、已有工具回合与多条块保持原样', () => {
  const plugin = { role: 'assistant', source: { kind: 'plugin', plugin: 'x' }, content: [{ type: 'text', text: '插件注入' }] }
  const reasoned = { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'reasoning', text: '思考' }, { type: 'text', text: '正文' }] }
  const native = { role: 'assistant', source: { kind: 'model' },
    content: [{ type: 'tool-call', id: 'c1', name: TOOL, arguments: '{"content":"已有"}' }] }
  const empty = { role: 'assistant', source: { kind: 'model' }, content: [] }
  const blank = { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '   ' }] }
  const user = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '输入' }] }
  const messages = [plugin, reasoned, native, empty, blank, user]
  assert.equal(projectHistoryAsToolCalls(messages, { toolName: TOOL }), messages)
})

test('多段文字合并进同一个 content 参数，保留原文换行', () => {
  const message = { id: 'message-2', role: 'assistant', source: { kind: 'model' },
    content: [{ type: 'text', text: '第一段\n' }, { type: 'text', text: '第二段' }] }
  const [projected] = projectHistoryAsToolCalls([message], { toolName: TOOL })
  assert.equal(JSON.parse(projected.content[0].arguments).content, '第一段\n第二段')
})

test('调用标识由消息 id 推导，重复投影逐字节一致', () => {
  const messages = [body('message-3', '同样的正文')]
  const first = projectHistoryAsToolCalls(messages, { toolName: TOOL })
  const second = projectHistoryAsToolCalls(messages, { toolName: TOOL })
  assert.deepEqual(first, second)
  assert.ok(first[0].content[0].id.startsWith(HISTORY_CALL_PREFIX))
  // Different ids never collide.
  const other = projectHistoryAsToolCalls([body('message-4', '同样的正文')], { toolName: TOOL })
  assert.notEqual(first[0].content[0].id, other[0].content[0].id)
})

test('没有工具名或没有消息时原样返回', () => {
  const messages = [body('message-5', '正文')]
  assert.equal(projectHistoryAsToolCalls(messages, {}), messages)
  assert.equal(projectHistoryAsToolCalls(messages, { toolName: '' }), messages)
  assert.deepEqual(projectHistoryAsToolCalls([], { toolName: TOOL }), [])
  assert.equal(projectHistoryAsToolCalls(null, { toolName: TOOL }), null)
})

test('回执文本可覆盖，未提供时用默认值', () => {
  const [call, receipt] = projectHistoryAsToolCalls([body('message-6', '正文')], { toolName: TOOL, receipt: '已保存' })
  assert.equal(call.content[0].type, 'tool-call')
  assert.deepEqual(receipt.content, [{ type: 'text', text: '已保存' }])
})
