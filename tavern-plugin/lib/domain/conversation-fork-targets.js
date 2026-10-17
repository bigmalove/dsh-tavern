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
 * Per-floor operation facts for the client. Two indexes over the same rows:
 * `byMessageId` keys the DSH message id a reply node carries, `bySeq` keys the
 * surface seq that a player-input node carries instead — the host's user node
 * data is `{kind, seq, time, content, source}` with no id at all, so the id
 * index alone never matches a player message.
 * Unlike forkTurnsByMessageId this covers every loaded floor (player inputs,
 * the card greeting, every reply version), with no turn window: a paged save
 * simply has no entry for floors outside its window.
 */
export function floorsIndex(chat, session, { busy = false } = {}) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  const empty = { byMessageId: {}, bySeq: {} }
  if (!messages.length || !session) return empty
  const nativeByStory = new Map()
  for (const [story, native] of Object.entries(chat.regeneratedDshTurns || {})) {
    if (Number.isSafeInteger(Number(story)) && Number.isSafeInteger(Number(native))) nativeByStory.set(Number(story), Number(native))
  }
  const lastReply = new Map()
  const lastInput = new Map()
  // 玩家输入按 surface 顺序收集：连续两条输入（例如两次"继续推进剧情"）时，
  // 只看 turn 的映射会把先出现的那条漏掉，而按顺序配对能逐条对上。
  const inputNodes = []
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
    // 顺序收集先做：首条玩家输入可能排在它所属回合的 turn/start 之前，
    // 按 turn 反查会漏掉它，但它在 surface 上的次序仍然有效。
    if (event.type === 'user/message' && event.data?.id && isTurnInput(event.data)) {
      inputNodes.push({ id: String(event.data.id), seq: event.seq })
    }
    const stamped = Number(event.data?.turn)
    const turn = Number.isSafeInteger(stamped) && stamped > 0 ? stamped : currentTurn
    if (!Number.isSafeInteger(turn) || turn < 1) continue
    if (event.type === 'assistant/message' && event.data?.message?.source?.kind === 'model' && event.data.message.id) {
      lastReply.set(turn, { id: String(event.data.message.id), seq: event.seq })
      visibleTurns.add(turn)
    } else if (event.type === 'user/message' && event.data?.id && isTurnInput(event.data)) {
      lastInput.set(turn, { id: String(event.data.id), seq: event.seq })
    }
  }
  const chatInputCount = messages.filter(message => message && message.role === 'user').length
  // 只在数量完全一致时按顺序配对；数量不一致说明有一侧被裁剪或抢救导入
  // 改造过，宁可退回按 turn 查表，也不能把按钮挂到别的楼层上。
  let inputCursor = 0
  const orderedInputs = inputNodes.length === chatInputCount
  const byMessageId = {}
  const bySeq = {}
  const latestIndex = messages.findLastIndex(message => message?.role === 'assistant')
  messages.forEach(function (message, index) {
    if (!message || typeof message !== 'object') return
    const greeting = message.greeting === true
    // A player input carries no turn of its own; it belongs to the round of
    // the reply that follows it (both are committed together). Consecutive
    // inputs have no reply between them, so look past the run for its turn.
    let nextReply = messages[index + 1]
    if (message.role === 'user') {
      for (let cursor = index + 1; cursor < messages.length; cursor++) {
        const candidate = messages[cursor]
        if (!candidate || typeof candidate !== 'object') continue
        if (candidate.role === 'assistant') { nextReply = candidate; break }
      }
    }
    const storyTurn = message.role === 'user'
      ? Math.max(0, Number(nextReply?.turn) || (nextReply?.greeting === true ? 1 : 0))
      : Math.max(0, Number(message.turn) || (greeting ? 1 : 0))
    const nativeTurn = nativeByStory.get(storyTurn) ?? storyTurn
    // Regeneration projects the new body back onto the original story turn;
    // older saves can still expose the synthetic turn instead.
    const ordered = message.role === 'user' && orderedInputs ? inputNodes[inputCursor++] : undefined
    const located = message.role === 'user'
      ? (ordered ?? lastInput.get(storyTurn) ?? lastInput.get(nativeTurn))
      : (lastReply.get(storyTurn) ?? lastReply.get(nativeTurn))
    if (located === undefined) return
    const messageId = located.id
    // 顺序配对取到的节点本身就在 surface 上，不需要再按 turn 反查。
    const inContext = ordered !== undefined || visibleTurns.has(storyTurn) || visibleTurns.has(nativeTurn)
    const rescued = isRescuedHistoryMessage(chat, message)
    const editable = inContext && !busy && !rescued
    const reason = rescued ? '存档救援导入的历史不可操作，请发送新消息继续'
      : !inContext ? '这一楼已不在当前模型上下文中（可能已被压缩）'
      : busy ? '请等待当前生成或后台处理完成后再操作'
      : ''
    const floor = {
      index, turn: storyTurn, role: message.role,
      // 玩家消息节点只带 seq、不带 id：客户端按 seq 查这一份。
      seq: located.seq,
      swipeId: Math.max(0, Number(message.swipeId) || 0),
      swipeCount: swipeCount(message),
      editable, reason,
      // Only the newest reply can grow a new version or re-run settlement.
      latest: message.role === 'assistant' && !greeting && index === latestIndex,
      token: floorToken(chat, message),
      ...(greeting ? { greeting: true } : {})
    }
    byMessageId[messageId] = floor
    // 同一 seq 只对应一个楼层，重复写入说明映射错位，保留首次的即可。
    if (!Object.hasOwn(bySeq, String(located.seq))) bySeq[String(located.seq)] = floor
  })
  return { byMessageId, bySeq }
}

export function floorsByMessageId(chat, session, options) {
  return floorsIndex(chat, session, options).byMessageId
}

export function floorsBySeq(chat, session, options) {
  return floorsIndex(chat, session, options).bySeq
}
