/**
 * 缓存命中时复用上一次的楼层表。
 *
 * 为什么需要它：缓存那条路拿到的 Chat 来自 projectChatSessionState，每条消息只剩
 * role/turn/greeting/mvu（见 chat-session-state.js 的 projectSessionMessage），既没有
 * swipes 也没有正文。拿这种行算楼层，版本数一律是 1（页面显示 1/1）、floorToken 也
 * 全部算错。这条路的 Chat 修订号与上一次投影相同，内容没变，照搬才是对的。
 *
 * 为什么只限这一条路：楼层表里装着 index / turn / token —— 编辑面板就是拿这三个值
 * 去服务端定位楼层的。增量（dirty）投影拿到的是完整消息行，必须按新内容重算；一旦
 * 把它也照搬，楼层表就会冻在旧值上，编辑会打到别的楼层，或者报「这一楼已不在当前
 * 上下文中，无法编辑」。
 *
 * 唯一允许改动的是忙碌态：后台结算期间所有楼层禁用，结束后恢复。
 */
const BUSY_REASON = '请等待当前生成或后台处理完成后再操作'

function withBusy(floor, busy) {
  if (busy) return floor.editable === true ? { ...floor, editable: false, reason: BUSY_REASON } : floor
  return floor.reason === BUSY_REASON ? { ...floor, editable: true, reason: '' } : floor
}

/** 返回 {} 表示上一份视图没有楼层表，调用方保留它自己的字段。 */
export function carriedFloors(previous, { busy = false } = {}) {
  const source = previous && previous.floorsByMessageId
  if (!source || typeof source !== 'object') return {}
  const byMessageId = {}
  const byIndex = new Map()
  for (const [id, floor] of Object.entries(source)) {
    if (!floor || typeof floor !== 'object') continue
    const next = withBusy(floor, busy)
    byMessageId[id] = next
    byIndex.set(next.index, next)
  }
  // 同一楼在两张索引里必须是同一个对象，客户端按 seq 查到的和按 id 查到的才一致。
  const bySeq = {}
  for (const [seq, floor] of Object.entries(previous.floorsBySeq || {})) {
    bySeq[seq] = floor && byIndex.has(floor.index) ? byIndex.get(floor.index) : floor
  }
  return { floorsByMessageId: byMessageId, floorsBySeq: bySeq }
}
