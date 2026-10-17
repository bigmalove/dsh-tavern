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
  // 每个回合的候选 id：正文编辑/重新生成会在同一回合里写入新的 assistant 节点，
  // 页面上渲染出来的可能是原始节点，也可能是替换节点。给每个出现过的 id 都挂一份
  // 楼层事实，客户端拿哪个都能查得到——这是"有的楼层有按钮、有的没有"的正解。
  const replyIdsByTurn = new Map()
  const inputIdsByTurn = new Map()
  const lastReply = new Map()
  const lastInput = new Map()
  // 玩家输入按时间顺序收集：连续两条输入（例如两次"继续推进剧情"）时，
  // 只看 turn 的映射会把先出现的那条漏掉，而按顺序配对能逐条对上。
  const inputNodes = []
  const visibleTurns = new Set()
  // A player input may carry no turn of its own; the enclosing turn/start says
  // which round it belongs to.
  let currentTurn = 0
  const nodes = new Set(session.surface?.nodes || [])
  // 宿主的聊天页只渲染 append 来源的消息，替换副本只给模型看（dsh-client-ui-chat 的
  // isAppendSurfaceEvent）。正文编辑写出的是替换副本，所以页面上那一楼的节点永远是
  // 最早 append 的那条。这里沿替换链记下每个节点的 append 来源，好让页面节点查得到楼层。
  const originOf = new Map()
  for (const event of sessionEvents(session)) {
    const op = event.surfaceOp
    if (op && typeof op === 'object' && op.op === 'replace' && Number.isSafeInteger(Number(op.startSeq))) {
      const start = Number(op.startSeq)
      originOf.set(event.seq, originOf.get(start) ?? start)
    }
    if (event.type === 'turn/start') {
      currentTurn = Math.max(0, Number(event.data?.turn) || 0)
      continue
    }
    const onSurface = nodes.has(event.seq)
    const isInput = event.type === 'user/message' && event.data?.id && isTurnInput(event.data)
    // 顺序收集先做：首条玩家输入可能排在它所属回合的 turn/start 之前，
    // 按 turn 反查会漏掉它，但它在时间线上的次序仍然有效。
    if (isInput && onSurface) inputNodes.push({ id: String(event.data.id), seq: event.seq })
    const stamped = Number(event.data?.turn)
    const turn = Number.isSafeInteger(stamped) && stamped > 0 ? stamped : currentTurn
    if (!Number.isSafeInteger(turn) || turn < 1) continue
    if (event.type === 'assistant/message' && event.data?.message?.source?.kind === 'model' && event.data.message.id) {
      const id = String(event.data.message.id)
      lastReply.set(turn, { id, seq: event.seq, onSurface })
      if (!replyIdsByTurn.has(turn)) replyIdsByTurn.set(turn, [])
      const ids = replyIdsByTurn.get(turn)
      if (!ids.includes(id)) ids.push(id)
      if (onSurface) visibleTurns.add(turn)
    } else if (isInput) {
      const id = String(event.data.id)
      lastInput.set(turn, { id, seq: event.seq, onSurface })
      if (!inputIdsByTurn.has(turn)) inputIdsByTurn.set(turn, [])
      const nodesForTurn = inputIdsByTurn.get(turn)
      if (!nodesForTurn.some(node => node.id === id)) nodesForTurn.push({ id, seq: event.seq })
    }
  }
  // 配对顺序必须是 surface 上的排列顺序，不是事件序号：正文编辑写出的替换节点追加在
  // 日志末尾（seq 最大），在 surface 上却顶替中间那一条。按 seq 排会让它排到最后，
  // 之后每一条输入都错开一格，下一次编辑就打到邻层去了。
  const surfacePosition = new Map((session.surface?.nodes || []).map((seq, position) => [Number(seq), position]))
  inputNodes.sort((a, b) => (surfacePosition.get(Number(a.seq)) ?? 0) - (surfacePosition.get(Number(b.seq)) ?? 0))
  const chatInputCount = messages.filter(message => message && message.role === 'user').length
  // 只在数量完全一致时按顺序配对；数量不一致说明有一侧被裁剪或抢救导入
  // 改造过，宁可退回按 turn 查表，也不能把按钮挂到别的楼层上。
  let inputCursor = 0
  const orderedInputs = inputNodes.length === chatInputCount
  const byMessageId = {}
  const bySeq = {}
  const expansions = []
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
    // 不在当前上下文里的楼层（被压缩 / 已移出 surface）不提供控件入口。
    if (!inContext) return
    const rescued = isRescuedHistoryMessage(chat, message)
    const editable = !busy && !rescued
    const reason = rescued ? '存档救援导入的历史不可操作，请发送新消息继续'
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
      ...(greeting ? { greeting: true } : {}),
      // 页面显示的是 append 来源的原文节点，看不到替换副本；编辑过的玩家输入把
      // 当前文字带给页面，否则改完页面上永远是原文。
      ...(message.role === 'user' && originOf.has(located.seq) ? { text: typeof message.text === 'string' ? message.text : '' } : {})
    }
    byMessageId[messageId] = floor
    // 同一 seq 只对应一个楼层，重复写入说明映射错位，保留首次的即可。
    if (!Object.hasOwn(bySeq, String(located.seq))) bySeq[String(located.seq)] = floor
    // 页面节点带的是 append 来源的 seq：替换过的楼层也要能按原始 seq 查到，
    // 否则刷新后按钮就消失了。
    const origin = originOf.get(located.seq)
    if (origin !== undefined && !Object.hasOwn(bySeq, String(origin))) bySeq[String(origin)] = floor
    // 同一回合里换过的节点（原始 / 正文编辑替换 / 重新生成）也要指向这一楼，
    // 但留到所有楼层都认领完自己的节点之后再展开（见下面第二轮）。
    // 只对仍在上下文里的回合展开：被压缩掉的回合不该留下控件入口。
    // 顺序配对已经把玩家输入逐条对上了，这时不能再按 turn 展开：一个回合里可能
    // 有好几条输入（导入的聊天记录会把它们全记在同一个 native turn 上），按 turn
    // 展开会让第一条楼层把后面几条的节点一并吃掉。
    if (inContext && !(message.role === 'user' && orderedInputs)) {
      expansions.push({ floor, candidateIds: message.role === 'user' ? inputIdsByTurn : replyIdsByTurn, storyTurn, nativeTurn })
    }
  })
  // 第二轮：楼层自己的节点永远优先。先到先得只在"没有楼层认领过它"的节点之间生效，
  // 否则同回合里靠前的楼层会抢走靠后楼层的节点，页面上点后一条就打开了前一条。
  for (const { floor, candidateIds, storyTurn, nativeTurn } of expansions) {
    for (const turn of [storyTurn, nativeTurn]) {
      for (const candidate of candidateIds.get(turn) || []) {
        const id = typeof candidate === 'string' ? candidate : candidate.id
        if (!Object.hasOwn(byMessageId, id)) byMessageId[id] = floor
        // 玩家节点只带 seq：同一回合出现过的每个输入 seq 都要能查到这一楼。
        if (typeof candidate !== 'string' && !Object.hasOwn(bySeq, String(candidate.seq))) bySeq[String(candidate.seq)] = floor
      }
    }
  }
  return { byMessageId, bySeq }
}

export function floorsByMessageId(chat, session, options) {
  return floorsIndex(chat, session, options).byMessageId
}

export function floorsBySeq(chat, session, options) {
  return floorsIndex(chat, session, options).bySeq
}
