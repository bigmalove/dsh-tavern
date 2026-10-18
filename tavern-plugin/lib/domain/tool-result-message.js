// DSH 0.2.1 (session format v4) lifts a tool result out of the user message into
// a first-class `role: 'tool'` message carrying `toolCallId` and plain text
// blocks. Older logs, and request messages Tavern builds itself, keep a
// `tool-result` block inside the message content. Both shapes carry the same call
// id, error flag and text, so readers go through here instead of matching one.

function partsOf(value) {
  return (Array.isArray(value) ? value : []).filter(part => part !== null && typeof part === 'object')
}

/** @returns every tool result carried by one `tool/result` message, in order. */
export function toolResultsOf(message) {
  if (message === null || typeof message !== 'object') return []
  if (message.role === 'tool' && typeof message.toolCallId === 'string') {
    return [{ toolCallId: message.toolCallId, isError: message.isError === true, parts: partsOf(message.content) }]
  }
  const results = []
  for (const block of partsOf(message.content)) {
    if (block.type !== 'tool-result' || typeof block.toolCallId !== 'string') continue
    results.push({ toolCallId: block.toolCallId, isError: block.isError === true, parts: partsOf(block.content) })
  }
  return results
}

/** The text a tool returned, without depending on which shape it arrived in. */
export function toolResultText(result) {
  return partsOf(result && result.parts)
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('')
}
