// DSH 0.2.1 (session format v4) lifts a tool result out of the user message into
// a first-class `role: 'tool'` message carrying `toolCallId` and plain text
// blocks. Older logs, and request messages Tavern builds itself, keep a
// `tool-result` block inside the message content. Both shapes carry the same call
// id, error flag and text, so readers go through here instead of matching one.
//
// The block list is exposed under both `content` (the name the request/session
// schema uses, and what upstream readers expect) and `parts` (the name this fork
// used first). They are the same array, so either reader works unchanged.

function partsOf(value) {
  return (Array.isArray(value) ? value : []).filter(part => part !== null && typeof part === 'object')
}

function resultOf(toolCallId, isError, blocks) {
  const parts = partsOf(blocks)
  return { toolCallId: toolCallId, isError: isError, content: parts, parts: parts }
}

/**
 * The tool results a session or request message carries, in either shape.
 * @returns [{ toolCallId, isError, content, parts }]
 */
export function toolResultsOf(message) {
  if (message === null || typeof message !== 'object') return []
  if (message.role === 'tool') {
    const toolCallId = String(message.toolCallId ?? '')
    if (toolCallId === '') return []
    return [resultOf(toolCallId, message.isError === true, message.content)]
  }
  const results = []
  for (const block of partsOf(message.content)) {
    if (block.type !== 'tool-result' || typeof block.toolCallId !== 'string') continue
    results.push(resultOf(block.toolCallId, block.isError === true, block.content))
  }
  return results
}
