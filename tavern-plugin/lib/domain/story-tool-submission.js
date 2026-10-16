import { sessionEvents } from './session-events.js'

export const STORY_SUBMIT_TOOL_NAME = 'submit_story'
export const STORY_SUBMIT_PROMPT = [
  '<output_method>',
  '本轮最终正文必须调用 submit_story 工具，完整放入 content 字符串参数，不要直接输出正文或重复复述。',
  '可以先使用已开放的历史查询、剧本读取或联网搜索；submit_story 必须是本轮最后一次工具调用。',
  '正文中的所有原有标签、格式和内容要求保持不变；提交成功即结束本轮，无需再输出任何消息。',
  '</output_method>'
].join('\n')

export function storyToolCallEnabled(chat) {
  return !!chat && (!chat.mode || chat.mode === 'story' || chat.mode === 'script') && chat.storyToolCallEnabled === true
}

function validContent(content) {
  if (typeof content !== 'string' || content.trim() === '') throw new Error('正文不能为空，content 必须是非空字符串')
  return content
}

/** Only a model call with a matching successful durable result is a submission. */
export function storySubmissionForTurn(session, turn) {
  const events = sessionEvents(session)
  const visible = Array.isArray(session?.surface?.nodes) ? new Set(session.surface.nodes.map(Number)) : null
  let start = -1
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === 'turn/start' && Number(events[index].data?.turn) === Number(turn)) { start = index; break }
  }
  const messages = new Map()
  const calls = new Map()
  for (let index = start + 1; index < events.length; index++) {
    const event = events[index]
    const data = event?.data
    if (Number(data?.turn) !== Number(turn)) continue
    if (event.type === 'assistant/message' && data.message?.source?.kind === 'model' && (!visible || visible.has(Number(event.seq ?? index)))) {
      for (const block of data.message.content || []) {
        if (block?.type === 'tool-call' && block.name === STORY_SUBMIT_TOOL_NAME) messages.set(block.id, { index, event, block })
      }
    }
    if (event.type === 'tool/call' && data.name === STORY_SUBMIT_TOOL_NAME) {
      const model = messages.get(data.callId)
      if (model && model.block.arguments === data.arguments) calls.set(data.callId, model)
    }
    if (event.type !== 'tool/result' || data.error || (visible && !visible.has(Number(event.seq ?? index)))) continue
    for (const block of data.message?.content || []) {
      if (block?.type !== 'tool-result' || block.isError === true) continue
      const model = calls.get(block.toolCallId)
      if (!model) continue
      let content
      try { content = validContent(JSON.parse(model.block.arguments).content) } catch { continue }
      const resultText = (block.content || []).filter(part => part?.type === 'text').map(part => part.text).join('')
      if (resultText !== content) continue
      return { index: model.index, event: model.event, text: content.trim(), content, toolCallId: block.toolCallId, storyToolSubmission: true }
    }
  }
  return null
}

export function activeStoryTurn(session) {
  const events = sessionEvents(session)
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === 'turn/end') return null
    if (events[index]?.type === 'turn/start') return Number(events[index].data?.turn) || null
  }
  return null
}

/** Executed exclusively by the host; the durable tool result is the receipt. */
export function createStorySubmissionTool({ chatForSession, isBackground = () => false }) {
  return {
    name: STORY_SUBMIT_TOOL_NAME,
    description: '提交本轮完整最终正文。全部正文放入 content；成功后结束本轮，不再补充回复。',
    parameters: { content: { type: 'string', required: true, description: '完整正文，保留原有格式和标签' } },
    output: { schema: { type: 'string' }, render(_args, value) { return [{ type: 'text', text: value }] } },
    isConcurrencySafe() { return false },
    async execute(args, exec) {
      exec?.signal?.throwIfAborted()
      const session = exec?.agent?.session
      const sessionId = session?.id || ''
      if (!sessionId || isBackground(sessionId)) throw new Error('正文提交只用于前台游玩回合')
      const chat = await chatForSession(sessionId)
      if (!storyToolCallEnabled(chat)) throw new Error('当前对话未开启正文走工具调用')
      const turn = activeStoryTurn(session)
      if (turn === null) throw new Error('当前没有正在生成的游玩回合')
      const content = validContent(args?.content)
      const previous = storySubmissionForTurn(session, turn)
      if (previous && previous.content !== content) throw new Error('本轮已提交正文，不允许重复覆盖')
      if (typeof exec.concludeTurn !== 'function') throw new Error('当前 DSH 版本不支持工具提交后结束回合，请关闭正文走工具调用或更新 DSH')
      exec.signal?.throwIfAborted()
      exec.concludeTurn()
      return content
    }
  }
}
