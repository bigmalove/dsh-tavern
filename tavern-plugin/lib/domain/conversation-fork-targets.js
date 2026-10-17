import { sessionEvents } from './session-events.js'
import { isTurnInput } from './session-turn-input.js'
import { isRescuedHistoryMessage } from './chat-history-rescue.js'
import { swipeCount } from './swipe-versions.js'
import { floorToken } from './floor-location.js'

// Fork buttons are keyed by the reply the player actually sees: the last model
// message of a completed native turn. That message (e.g. the reply projection) is
// often written after the chat revision, so this must be derived from session
// events on every view, never from the revision-cached chat projection.
// Regenerated rounds map their new native turn back to the story turn that the
// fork request expects. Superseded or rolled-back replies are not rendered, so
// extra entries are harmless; the server validates every fork request again.
// Earlier turns lose their history after save maintenance (only the latest
// FORK_HISTORY_TURNS turns stay forkable), so they get no fork button.
export const FORK_HISTORY_TURNS = 50
export function forkTurnsByMessageId(session, regeneratedDshTurns = {}) {
  const storyByNative = new Map()
  for (const [story, native] of Object.entries(regeneratedDshTurns || {})) {
    if (Number.isSafeInteger(Number(story)) && Number.isSafeInteger(Number(native))) storyByNative.set(Number(native), Number(story))
  }
  const regeneratedStories = new Set(storyByNative.values())
  const lastReply = new Map()
  const completed = new Set()
  for (const event of sessionEvents(session)) {
    const turn = Number(event.data?.turn)
    if (!Number.isSafeInteger(turn) || turn < 1) continue
    if (event.type === 'turn/start') { lastReply.delete(turn); completed.delete(turn) }
    else if (event.type === 'assistant/message' && event.data?.message?.source?.kind === 'model' && event.data.message.id) lastReply.set(turn, String(event.data.message.id))
    else if (event.type === 'turn/end' && event.data?.reason?.kind === 'completed') completed.add(turn)
  }
  const result = {}
  for (const [native, messageId] of lastReply) {
    if (!completed.has(native)) continue
    // The original reply of a regenerated round is no longer the visible one.
    if (!storyByNative.has(native) && regeneratedStories.has(native)) continue
    result[messageId] = storyByNative.get(native) ?? native
  }
  const latest = Math.max(0, ...Object.values(result))
  for (const [messageId, turn] of Object.entries(result)) if (turn <= latest - FORK_HISTORY_TURNS) delete result[messageId]
  return result
}

/**
 * Per-floor operation facts for the client, keyed by the DSH message id the
 * rendered node carries. Unlike forkTurnsByMessageId this covers every loaded
 * floor (player inputs, the card greeting, every reply version), with no turn
 * window: a paged save simply has no entry for floors outside its window, and
 * the client then offers no controls for them.
 */
export function floorsByMessageId(chat, session, { busy = false } = {}) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  if (!messages.length || !session) return {}
  const nativeByStory = new Map()
  for (const [story, native] of Object.entries(chat.regeneratedDshTurns || {})) {
    if (Number.isSafeInteger(Number(story)) && Number.isSafeInteger(Number(native))) nativeByStory.set(Number(story), Number(native))
  }
  const lastReply = new Map()
  const lastInput = new Map()
  const visibleTurns = new Set()
  // A player input may carry no turn of its own; the enclosing turn/start says
  // which round it belongs to.
  let currentTurn = 0
  const nodes = new Set(session.surface?.nodes || [])
  for (const event of sessionEvents(session)) {
    if (event.type === 'turn/start') {
      currentTurn = Math.max(0, Number(event.data?.turn) || 0)
      continue
    }
    if (!nodes.has(event.seq)) continue
    const stamped = Number(event.data?.turn)
    const turn = Number.isSafeInteger(stamped) && stamped > 0 ? stamped : currentTurn
    if (!Number.isSafeInteger(turn) || turn < 1) continue
    if (event.type === 'assistant/message' && event.data?.message?.source?.kind === 'model' && event.data.message.id) {
      lastReply.set(turn, String(event.data.message.id))
      visibleTurns.add(turn)
    } else if (event.type === 'user/message' && event.data?.id && isTurnInput(event.data)) {
      lastInput.set(turn, String(event.data.id))
    }
  }
  const result = {}
  const latestIndex = messages.findLastIndex(message => message?.role === 'assistant')
  messages.forEach(function (message, index) {
    if (!message || typeof message !== 'object') return
    const greeting = message.greeting === true
    // A player input carries no turn of its own; it belongs to the round of
    // the reply that follows it (both are committed together).
    const storyTurn = message.role === 'user'
      ? Math.max(0, Number(messages[index + 1]?.turn) || (messages[index + 1]?.greeting === true ? 1 : 0))
      : Math.max(0, Number(message.turn) || (greeting ? 1 : 0))
    const nativeTurn = nativeByStory.get(storyTurn) ?? storyTurn
    // Regeneration projects the new body back onto the original story turn;
    // older saves can still expose the synthetic turn instead.
    const messageId = message.role === 'user'
      ? (lastInput.get(storyTurn) ?? lastInput.get(nativeTurn))
      : (lastReply.get(storyTurn) ?? lastReply.get(nativeTurn))
    if (messageId === undefined) return
    const inContext = visibleTurns.has(storyTurn) || visibleTurns.has(nativeTurn)
    const rescued = isRescuedHistoryMessage(chat, message)
    const editable = inContext && !busy && !rescued
    const reason = rescued ? '存档救援导入的历史不可操作，请发送新消息继续'
      : !inContext ? '这一楼已不在当前模型上下文中（可能已被压缩）'
      : busy ? '请等待当前生成或后台处理完成后再操作'
      : ''
    result[messageId] = {
      index, turn: storyTurn, role: message.role,
      swipeId: Math.max(0, Number(message.swipeId) || 0),
      swipeCount: swipeCount(message),
      editable, reason,
      // Only the newest reply can grow a new version or re-run settlement.
      latest: message.role === 'assistant' && !greeting && index === latestIndex,
      token: floorToken(chat, message),
      ...(greeting ? { greeting: true } : {})
    }
  })
  return result
}
