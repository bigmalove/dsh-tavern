import { sessionEvents } from './session-events.js'

// 删除标记由 history-deletion.js 写出：一条空的 user/message，用 replace 顶替被删的节点。
const DELETION_PLUGIN = 'dsh-tavern-deletion'

function isDeletionMarker(event) {
  return event?.type === 'user/message' && event.data?.source?.kind === 'plugin' && event.data.source.plugin === DELETION_PLUGIN
}

/**
 * 页面上应该藏起来的节点，以及要一并藏掉的回合尾行。
 *
 * 宿主聊天页只渲染 append 来源的消息，替换副本只给模型看。删除写出的是替换副本，
 * 所以模型那边已经没有这条消息，页面上却还挂着它最初那一版。这里沿替换链找回
 * 每个删除标记的 append 来源；只算仍在 surface 上的标记——撤销删除会把标记再顶替掉，
 * 那条消息就该重新显示。
 *
 * 尾行（`[data-chat-flow-kind="turn-tail"]`）是宿主给「这一回合最后一条回复」画的
 * 操作栏：复制、分支、用时、时间。正文节点返回 null 只藏了正文，尾行是另一个节点，
 * 于是删完只剩一排图标。所以还要报出「最后一条回复已被删除」的回合，让客户端把
 * 那条尾行一起藏掉。删的是同一回合里较早的步骤时，尾行仍归最后一条，不能动。
 */
export function deletedSurfaceNodes(session) {
  const events = sessionEvents(session)
  const nodes = new Set((session?.surface?.nodes || []).map(Number))
  const bySeq = new Map()
  const originOf = new Map()
  const lastAssistantOfTurn = new Map()
  for (const event of events) {
    const seq = Number(event?.seq)
    if (!Number.isSafeInteger(seq)) continue
    bySeq.set(seq, event)
    const op = event.surfaceOp
    if (op && typeof op === 'object' && op.op === 'replace' && Number.isSafeInteger(Number(op.startSeq))) {
      const start = Number(op.startSeq)
      originOf.set(seq, originOf.get(start) ?? start)
    }
    if (event.type === 'assistant/message') {
      const turn = Number(event.data?.turn)
      if (Number.isSafeInteger(turn) && turn > 0) lastAssistantOfTurn.set(turn, seq)
    }
  }
  const seqs = []
  const replyTurns = new Set()
  for (const event of events) {
    if (!isDeletionMarker(event) || !nodes.has(Number(event.seq))) continue
    const origin = originOf.get(Number(event.seq)) ?? Number(event.seq)
    if (!seqs.includes(origin)) seqs.push(origin)
    const original = bySeq.get(origin)
    const turn = Number(original?.data?.turn)
    if (original?.type === 'assistant/message' && Number.isSafeInteger(turn) && turn > 0
      && lastAssistantOfTurn.get(turn) === origin) replyTurns.add(turn)
  }
  return { seqs: seqs.sort((a, b) => a - b), replyTurns: [...replyTurns].sort((a, b) => a - b) }
}

export function deletedSurfaceSeqs(session) {
  return deletedSurfaceNodes(session).seqs
}

/** 尾行该消失的回合（事件里的 native turn）：这一回合最后一条回复已经被删除。 */
export function deletedReplyTurns(session) {
  return deletedSurfaceNodes(session).replyTurns
}

/**
 * 同一个回合的两套编号。宿主页面上的尾行行带的是宿主 Chat 的 turn，Tavern 存档里
 * 记的是剧情 turn，发生过重新生成时两者并不相同；`regeneratedDshTurns` 就是这张
 * 映射表。把两边都发给客户端，无论页面上用的是哪一套编号都能对上。
 */
export function deletedReplyTurnKeys(session, regeneratedDshTurns) {
  const keys = new Set(deletedReplyTurns(session).map(Number))
  const mappings = regeneratedDshTurns && typeof regeneratedDshTurns === 'object' && !Array.isArray(regeneratedDshTurns)
    ? regeneratedDshTurns : {}
  for (const [story, native] of Object.entries(mappings)) {
    const storyTurn = Number(story), nativeTurn = Number(native)
    if (!Number.isSafeInteger(storyTurn) || !Number.isSafeInteger(nativeTurn)) continue
    if (keys.has(storyTurn)) keys.add(nativeTurn)
    else if (keys.has(nativeTurn)) keys.add(storyTurn)
  }
  return [...keys].filter(turn => Number.isSafeInteger(turn) && turn > 0).sort((left, right) => left - right)
}
