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
 * story turn; the native event is the last visible turn input of that turn.
 * Native user messages often carry no turn of their own — the enclosing
 * turn/start names their round, exactly as in the floor map.
 *
 * An imported save appends every input *before* opening its round, so the
 * input sits in the gap after the previous turn/end. Its turn is therefore the
 * next turn/start, not the last one seen; an edited input is a replacement
 * whose origin append carries the turn.
 */
export function locateInputFloor({ chat, session, index, turn }) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  const message = messages[index]
  if (!message || message.role !== 'user') return null
  const expected = Number(turn) || Number(messages[index + 1]?.turn) || 0
  if (!Number.isSafeInteger(expected) || expected < 1) return null
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : null
  if (nodes === null) return null
  const events = sessionEvents(session)
  const visible = new Set(nodes.map(Number))
  // Follow replacements back to the append they shadowed: an edited input keeps
  // the turn of the original message, not the round it happens to land in.
  const originOf = new Map()
  for (const event of events) {
    const op = event.surfaceOp
    if (!op || typeof op !== 'object' || op.op !== 'replace' || !Number.isSafeInteger(Number(op.startSeq))) continue
    originOf.set(Number(event.seq), originOf.get(Number(op.startSeq)) ?? Number(op.startSeq))
  }
  const nextTurn = new Array(events.length).fill(0)
  for (let cursor = events.length - 1, next = 0; cursor >= 0; cursor -= 1) {
    if (events[cursor].type === 'turn/start') next = Math.max(0, Number(events[cursor].data?.turn) || 0)
    nextTurn[cursor] = next
  }
  const turnOf = new Map()
  let currentTurn = 0
  let open = false
  for (let cursor = 0; cursor < events.length; cursor += 1) {
    const event = events[cursor]
    if (event.type === 'turn/start') { currentTurn = Math.max(0, Number(event.data?.turn) || 0); open = true; continue }
    if (event.type === 'turn/end') { open = false; continue }
    if (event.type !== 'user/message' || !event.data?.id || !isTurnInput(event.data)) continue
    const stamped = Number(event.data?.turn)
    if (Number.isSafeInteger(stamped) && stamped > 0) turnOf.set(Number(event.seq), stamped)
    else if (open && currentTurn > 0) turnOf.set(Number(event.seq), currentTurn)
    else if (nextTurn[cursor] > 0) turnOf.set(Number(event.seq), nextTurn[cursor])
  }
  let found = null
  for (const event of events) {
    if (event.type !== 'user/message' || !event.data?.id || !isTurnInput(event.data)) continue
    const seq = Number(event.seq)
    if (!visible.has(seq)) continue
    const origin = originOf.get(seq) ?? seq
    const eventTurn = turnOf.get(origin) ?? turnOf.get(seq) ?? 0
    if (eventTurn !== expected) continue
    found = { seq, turn: expected }
  }
  return found
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
