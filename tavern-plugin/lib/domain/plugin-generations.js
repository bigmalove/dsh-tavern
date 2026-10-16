import { createHash } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { inputEventForTurn, inputKind } from './session-turn-input.js'
import { assistantResultForTurn } from './session-turn-result.js'

// An attempt is a particular appended turn/start + input, not a guessed next floor.
function attempt(session, events, start) {
  const event = events[start]
  const turn = Number(event?.data?.turn)
  if (event?.type !== 'turn/start' || !Number.isSafeInteger(event.seq) || !Number.isSafeInteger(turn) || turn < 1) return null
  let end = start + 1
  while (end < events.length && events[end]?.type !== 'turn/start') end++
  const stopped = events.findIndex((item, index) => index > start && index < end && item?.type === 'turn/end')
  const segment = events.slice(start, stopped < 0 ? end : stopped + 1)
  const input = inputEventForTurn({ events: segment }, turn)
  if (!input || !Number.isSafeInteger(input.seq) || typeof input.data?.id !== 'string') return null
  const generationId = createHash('sha256').update(JSON.stringify([session.id, turn, event.seq, input.seq, input.data.id])).digest('hex')
  return { generationId, turn, input, segment }
}

export function capturePluginGeneration(session) {
  if (!session?.id) return null
  const events = sessionEvents(session)
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === 'turn/end') return null
    if (events[index]?.type !== 'turn/start') continue
    const value = attempt(session, events, index)
    return value ? { gameId: session.id, generationId: value.generationId } : null
  }
  return null
}

// Read durable receipts without the current surface filter: adoption hides the
// synthetic tool pair, but its attempt remains verifiable in the append-only log.
export function pluginGenerationEvidence(session, generationId) {
  if (!session?.id || !/^[a-f0-9]{64}$/.test(generationId || '')) return null
  const events = sessionEvents(session)
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type !== 'turn/start') continue
    const value = attempt(session, events, index)
    if (value?.generationId !== generationId) continue
    const ends = value.segment.filter(event => event.type === 'turn/end')
    if (!ends.length || ends.some(event => ['error', 'aborted'].includes(event.data?.reason?.kind))) return null
    const result = assistantResultForTurn({ events: value.segment }, value.turn)
    if (!result?.text) return null
    return { ...value, result, kind: inputKind(value.input.data) }
  }
  return null
}
