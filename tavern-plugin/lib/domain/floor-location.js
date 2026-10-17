// Where one Chat floor lives in the current model context. UI and mutations
// share this so a button's disabled reason and the server's refusal agree.
// null means the floor was compacted away or never entered this session.

import { locateRegenerationSurface } from './rollback-surface.js'
import { sessionEvents } from './session-events.js'
import { isTurnInput } from './session-turn-input.js'
import { createHash } from 'node:crypto'

/**
 * @param {{ chat: object, session: object, index: number, turn: number, role?: 'assistant'|'user' }} input
 * @returns {{ seq: number, turn: number, source: object } | null}
 */
export function locateFloor({ chat, session, index, turn, role = 'assistant' }) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  const message = messages[index]
  if (!message || Number(message.turn || (message.greeting === true ? 1 : 0)) !== Number(turn)) return null
  if (role === 'user' ? message.role !== 'user' : message.role !== 'assistant') return null
  const events = sessionEvents(session)
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : null
  if (nodes === null) return null
  // A card opening enters the native session as its own turn 1
  // (conversation-initialization.js), whatever later rounds exist.
  const surfaceTurn = message.greeting === true ? 1 : Number(turn)
  const located = locateRegenerationSurface({ events, nodes, turn: surfaceTurn })
  return located === null ? null : { seq: located.assistantSeq, turn: located.turn, source: located.source }
}

/**
 * Where one player input lives in the current model context. A user floor
 * belongs to the round of the reply that follows it, so `turn` names that
 * story turn; the native event is the last turn input of the same native turn.
 */
export function locateInputFloor({ chat, session, index, turn }) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  const message = messages[index]
  if (!message || message.role !== 'user') return null
  const expected = Number(turn) || Number(messages[index + 1]?.turn) || 0
  if (!Number.isSafeInteger(expected) || expected < 1) return null
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : null
  if (nodes === null) return null
  const bySeq = new Map(sessionEvents(session).map(event => [event.seq, event]))
  for (let at = nodes.length - 1; at >= 0; at--) {
    const seq = Number(nodes[at])
    const event = bySeq.get(seq)
    if (!event || event.type !== 'user/message' || !event.data?.id || !isTurnInput(event.data)) continue
    if (Number(event.data.turn) !== expected) continue
    return { seq, turn: expected }
  }
  return null
}

/**
 * Identity of one floor's content for edit/swipe tokens. Display bookkeeping
 * and settlement receipts are not prose, and the message count is deliberately
 * absent: appending new floors elsewhere never invalidates an older floor's
 * pending operation.
 */
export function floorToken(chat, message) {
  const { displayRuntime: _runtime, tavernPluginData: _templateCache, mvu: _settlement, ...body } = message
  return createHash('sha256').update(JSON.stringify([chat.id, chat.timeline && chat.timeline.branchId, body])).digest('hex')
}
