import { randomUUID } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { createSessionSurfaceMutator } from './session-surface-mutations.js'
import { toolResultsOf, toolResultText } from './tool-result-message.js'

export const STORY_SUBMIT_TOOL_NAME = 'submit_story'
export const STORY_SUBMIT_PROMPT = [
  '<output_method>',
  '本轮最终正文必须调用 submit_story 工具，完整放入 content 字符串参数，不要直接输出正文或重复复述。',
  '可以先使用已开放的历史查询、剧本读取或联网搜索；submit_story 必须是本轮最后一次工具调用。',
  '正文中的所有原有标签、格式和内容要求保持不变；提交成功即结束本轮，无需再输出任何消息。',
  '</output_method>'
].join('\n')

/** A global switch (Tavern settings); it applies to play sessions. */
export function storyToolCallEnabled(chat, enabled) {
  return enabled === true && !!chat && (!chat.mode || ['story', 'script'].includes(chat.mode))
}

function validContent(content) {
  if (typeof content !== 'string' || content.trim() === '') throw new Error('正文不能为空，content 必须是非空字符串' + FALLBACK_HINT)
  return content
}

// A failing submission must not turn into a retry loop: the model reads the
// error as a tool result and would otherwise call again, step after step, until
// the request times out with no text on screen. Every rejection therefore ends by
// telling it to answer directly, which is what the player sees anyway.
const FALLBACK_HINT = '；不要再调用本工具，请直接把完整正文作为回复输出。'

/**
 * The body a submission carried, whether or not its receipt came back verbatim.
 *
 * Hosts differ in what they store for a tool result: some echo the returned
 * string, some wrap or truncate it, some route it through a projector first.
 * Requiring an exact echo made a successful submission invisible whenever the
 * host reformatted the receipt, and the round then failed with "模型本轮没有返回
 * 正文" while the body sat in the call arguments the whole time. A non-error
 * receipt for this call is the proof of success; the text comes from the call.
 */
export function storySubmissionForTurn(session, turn) {
  const events = sessionEvents(session)
  const visible = Array.isArray(session?.surface?.nodes) ? new Set(session.surface.nodes.map(Number)) : null
  let start = -1
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === 'turn/start' && Number(events[index].data?.turn) === Number(turn)) { start = index; break }
  }
  const messages = new Map()
  const calls = new Map()
  // Receipts are collected by call id first; an exact echo wins, a reformatted
  // one still counts. Both are only credible once the call itself was found.
  const receipts = new Map()
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
    // The receipt arrives as its own `role: 'tool'` message on 0.2.1 and as a
    // `tool-result` block on older logs; both name the call that was submitted.
    for (const result of toolResultsOf(data.message)) {
      if (result.isError) continue
      const model = calls.get(result.toolCallId)
      if (!model) continue
      receipts.set(result.toolCallId, { text: toolResultText(result), receiptIndex: Number(event.seq ?? index), model })
    }
  }
  for (const [callId, receipt] of receipts) {
    let content
    try { content = validContent(JSON.parse(receipt.model.block.arguments).content) } catch { continue }
    return {
      index: receipt.model.index,
      receiptIndex: receipt.receiptIndex,
      event: receipt.model.event,
      text: content.trim(),
      content,
      toolCallId: callId,
      echoed: receipt.text === content,
      storyToolSubmission: true
    }
  }
  return null
}

/**
 * Turn a finished submission into an ordinary reply. The appended text lets the
 * chat view show the step as an answer (it ignores surface replacements); the
 * replacement then leaves that one text where the call, receipt and copy were,
 * so the model sees the body once and rollback/regeneration see a normal round.
 *
 * @returns true when the round was folded. A false result is not fatal: the
 *   caller replaces the call message with the body alone, which keeps the answer
 *   visible even when the surface no longer matches what this turn produced.
 */
export function foldStorySubmission(session, result, bodyText) {
  const data = result.event.data
  const turn = Number(data.turn) || 0
  const step = Number(data.step) || 1
  const surface = createSessionSurfaceMutator(session)
  // `submission.index` is the events-array position while the receipt is an
  // event seq; the surface is a seq list, so the call is located by its own seq.
  // A filtered or compacted log makes the two differ, and a positional lookup
  // then fails with "消息替换目标已变化".
  const start = Number(result.event?.seq ?? result.index)
  const receipt = Number(result.receiptIndex)
  const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes.map(Number) : []
  const from = nodes.indexOf(start)
  const to = nodes.indexOf(receipt)
  // A step may dispatch several tools, so other receipts can sit between the
  // call and this submission's receipt. The range must cite every node it
  // removes or the replacement is refused with "缺少有效的来源引用".
  if (from < 0 || to < from) return false
  // The appended copy and the replacement are one message. The chat view keys a
  // round's actions by the message id it rendered and the fork map reads the id
  // of the newest projection event, so two ids here hide the fork action.
  const reply = {
    ...data.message,
    id: randomUUID(),
    source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' },
    content: [{ type: 'text', text: bodyText }]
  }
  // Settlement runs after the submission's step closed: the copy and its replacement
  // share one edit step, so the log stays loadable and the step still shows the answer.
  // A failed fold must not fail the round, so the outcome travels back as a boolean.
  const folded = surface.editStep(() => {
    const shown = surface.append('assistant/message', { turn, step, message: reply }, { surfaceOp: 'append', sourceEventSeqs: [] })
    const shownSeq = Number(typeof shown === 'number' ? shown : shown.seq)
    const end = session.surface.nodes.map(Number).indexOf(shownSeq)
    if (end < to) return false
    surface.replace('assistant/message', { turn, step, message: reply },
      { start, end: shownSeq, sourceEventSeqs: session.surface.nodes.slice(from, end + 1).map(Number) })
    return true
  })
  return folded === true
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
export function createStorySubmissionTool({ chatForSession, enabled, isBackground = () => false }) {
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
      if (!sessionId || isBackground(sessionId)) throw new Error('正文提交只用于前台游玩回合' + FALLBACK_HINT)
      const chat = await chatForSession(sessionId)
      if (!storyToolCallEnabled(chat, await enabled())) throw new Error('未开启正文走工具调用' + FALLBACK_HINT)
      const turn = activeStoryTurn(session)
      if (turn === null) throw new Error('当前没有正在生成的游玩回合' + FALLBACK_HINT)
      const content = validContent(args?.content)
      const previous = storySubmissionForTurn(session, turn)
      // The same body twice is the model repeating itself after a lost receipt;
      // returning it again is harmless and keeps the round from failing.
      if (previous && previous.content !== content) throw new Error('本轮已提交正文，不允许重复覆盖' + FALLBACK_HINT)
      if (typeof exec.concludeTurn !== 'function') throw new Error('当前 DSH 版本不支持工具提交后结束回合，请关闭正文走工具调用或更新 DSH' + FALLBACK_HINT)
      exec.signal?.throwIfAborted()
      exec.concludeTurn()
      return content
    }
  }
}
