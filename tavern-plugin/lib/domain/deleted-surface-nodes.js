import { sessionEvents } from './session-events.js'

// 删除标记由 history-deletion.js 写出：一条空的 user/message，用 replace 顶替被删的节点。
const DELETION_PLUGIN = 'dsh-tavern-deletion'

function isDeletionMarker(event) {
  return event?.type === 'user/message' && event.data?.source?.kind === 'plugin' && event.data.source.plugin === DELETION_PLUGIN
}

/**
 * 页面上应该藏起来的节点 seq。
 *
 * 宿主聊天页只渲染 append 来源的消息，替换副本只给模型看。删除写出的是替换副本，
 * 所以模型那边已经没有这条消息，页面上却还挂着它最初那一版。这里沿替换链找回
 * 每个删除标记的 append 来源；只算仍在 surface 上的标记——撤销删除会把标记再顶替掉，
 * 那条消息就该重新显示。
 */
export function deletedSurfaceSeqs(session) {
  const events = sessionEvents(session)
  const nodes = new Set((session?.surface?.nodes || []).map(Number))
  const originOf = new Map()
  const deleted = []
  for (const event of events) {
    const op = event.surfaceOp
    if (!op || typeof op !== 'object' || op.op !== 'replace' || !Number.isSafeInteger(Number(op.startSeq))) continue
    const start = Number(op.startSeq)
    const origin = originOf.get(start) ?? start
    originOf.set(event.seq, origin)
    if (isDeletionMarker(event) && nodes.has(Number(event.seq))) deleted.push(origin)
  }
  return [...new Set(deleted)].sort((a, b) => a - b)
}
