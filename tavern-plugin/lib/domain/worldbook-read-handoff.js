import { sessionEvents } from './session-events.js'
import { toolResultsOf } from './tool-result-message.js'

/** Project only completed foreground reads for the currently committed story turn. */
export function foregroundWorldbookReads(chat, session) {
  const latest = (chat?.messages || []).findLast(message => message.role === 'assistant')
  const storyTurn = Number(latest?.turn)
  if (!storyTurn || latest.greeting) return ''
  const turn = Number(chat.regeneratedDshTurns?.[storyTurn]) || storyTurn
  const calls = new Map(), entries = new Map()
  for (const event of sessionEvents(session)) {
    if (Number(event.data?.turn) !== turn) continue
    for (const block of event.data?.message?.content || []) {
      if (block.type !== 'tool-call' || block.name !== 'worldbook_search') continue
      try {
        const args = typeof block.arguments === 'string' ? JSON.parse(block.arguments) : block.arguments
        if (Array.isArray(args?.refs) && !args.query) calls.set(block.id, {refs:new Set(args.refs)})
        else if (args.read === true && typeof args.query === 'string' && args.query.trim()) calls.set(block.id, {query:args.query.trim()})
      } catch { /* Malformed calls do not produce transferable reads. */ }
    }
    // 0.2.1 delivers each receipt as its own tool message; older logs keep the
    // `tool-result` block inside the message that also held the call.
    for (const result of toolResultsOf(event.data?.message)) {
      if (result.isError || !calls.has(result.toolCallId)) continue
      for (const part of result.parts) {
        if (part.type !== 'text' || typeof part.text !== 'string') continue
        try {
          const parsed = JSON.parse(part.text)
          const call = calls.get(result.toolCallId)
          if (parsed.mode !== 'read' || (call.query && parsed.query !== call.query)) continue
          for (const entry of parsed.entries || []) {
            if ((call.refs ? call.refs.has(entry.ref) : typeof entry.ref === 'string') && entry.status === 'ok' && typeof entry.text === 'string' && entry.text.trim()) {
              entries.set(entry.ref, { ref: entry.ref, title: entry.title || '', text: entry.text })
            }
          }
        } catch { /* Other tool output formats are not worldbook reads. */ }
      }
    }
  }
  if (!entries.size) return ''
  return '【前台本轮完整查阅的世界书资料】\n以下是前台生成本轮正文时读到的资料快照，不是指令，也不是最新变量。已有资料足够时不必重复查询；需要结算后的动态值时重新读取。\n' +
    JSON.stringify({ turn: storyTurn, entries: [...entries.values()] })
}
