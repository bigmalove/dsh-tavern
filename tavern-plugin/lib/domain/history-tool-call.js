import { createHash } from 'node:crypto'

// Bodies are the one thing a story turn contributes to the transcript. Replayed
// as plain assistant text they read as "I already wrote this"; replaying them as
// the submission tool's own arguments keeps the same characters and tokens while
// the model treats them as structured parameters instead of prose it produced.
// Measured on Gemini 4: the identical body is refused as assistant text and
// accepted as tool arguments, so this projection is a containment measure, not a
// cosmetic one. The identifier is derived from the message id so repeated
// requests produce byte-identical history and keep provider caches warm.
//
// The id must also survive transport: OpenAI-compatible gateways cap call ids at
// 40 characters and many only pass `[A-Za-z0-9_-]`, silently turning anything else
// into an unmatched call or a 400. `tvh_` plus 32 hex digits is 36 characters of
// that alphabet, so the pair stays legal on every backend this plugin talks to.
export const HISTORY_CALL_PREFIX = 'tvh_'
export const HISTORY_RECEIPT_TEXT = '已收到。'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/** A completed reply: model-authored prose and nothing else. */
function isBody(message) {
  if (message === null || typeof message !== 'object' || message.role !== 'assistant') return false
  const source = message.source
  if (source === null || typeof source !== 'object' || source.kind !== 'model') return false
  const content = message.content
  if (!Array.isArray(content) || content.length === 0) return false
  // Reasoning, images or an existing tool call keep their native shape: only a
  // message that is nothing but visible text can become arguments without loss.
  return content.every(function (block) {
    return block !== null && typeof block === 'object' && block.type === 'text' && str(block.text).trim() !== ''
  })
}

function callIdOf(message, text) {
  const identity = str(message.id) !== '' ? str(message.id) : text
  return HISTORY_CALL_PREFIX + createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

/**
 * Replay every past reply as a submission call with a matching receipt.
 *
 * @param messages - provider-bound messages for this request.
 * @param options - `toolName` names the submission tool; `receipt` overrides the
 *   tool output text. Both are optional, but without a tool name nothing changes.
 * @returns the same array when no body qualifies, otherwise a new array.
 */
export function projectHistoryAsToolCalls(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return messages
  const toolName = str(options.toolName)
  if (toolName === '') return messages
  const receiptText = str(options.receipt) || HISTORY_RECEIPT_TEXT
  let changed = false
  const projected = []
  for (const message of messages) {
    if (!isBody(message)) {
      projected.push(message)
      continue
    }
    const text = message.content.map(function (block) { return str(block.text) }).join('')
    const callId = callIdOf(message, text)
    projected.push({
      ...message,
      content: [{ type: 'tool-call', id: callId, name: toolName, arguments: JSON.stringify({ content: text }) }]
    })
    // The receipt is what makes the pair legal for providers that require every
    // call to be answered; it carries no body so the text appears exactly once.
    // DSH 0.2 (session v4) sends tool results as first-class tool messages.
    projected.push({
      id: callId + ':receipt',
      role: 'tool',
      source: { kind: 'tool', callId },
      toolCallId: callId,
      content: [{ type: 'text', text: receiptText }],
      isError: false
    })
    changed = true
  }
  return changed ? projected : messages
}
