// Deleting one reply version or one whole round, with a single undo point.
//
// Versions live inside one Chat floor, so removing one only rewrites that
// floor's arrays and its native text. A round owns a player input and a reply:
// removing it drops both rows and shadows their native messages with one empty
// plugin marker. Undo restores the rows and the header state the round had
// produced; the native surface can only regain one node per marker, so a
// restored non-final round keeps its rows but cannot re-enter the model
// context — those deletions are reported as not undoable.

import { randomUUID } from 'node:crypto'
import { saveFloorPatch, synchronizeBodyEdits } from './body-editor.js'
import { floorToken, locateFloor, locateInputFloor } from './floor-location.js'
import { createHistoryMutationGuards } from './history-mutation-guards.js'
import { insertSwipe, removeSwipe, swipeCount, swipeSource, swipeStates } from './swipe-versions.js'
import { appendSessionEvent, sessionEvents } from './session-events.js'
import { replaceSessionSurface } from './session-surface-mutations.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}
function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

export function createHistoryDeletion({ chats, sessions, timeline, activity, project, present, sessionPatch, queueSettlement, scripts }) {
  const guards = createHistoryMutationGuards({ sessionPatch, activity })
  const pending = new Set()

  async function context(sessionId) {
    guards.refuseClosedPatch()
    const chat = await chats.forSession(sessionId)
    if (!chat) throw new Error('会话不存在')
    const agent = sessions.get(sessionId)
    if (!agent?.session) throw new Error('无法访问原生会话')
    guards.assertIdle(chat, agent, '删除')
    return { chat, agent }
  }

  async function save(chat, agent, { index, message, intent, seq, detachedIntent, source }) {
    const saved = await saveFloorPatch({
      chat, index, message, intent, detachedIntent: detachedIntent || { ...intent, index: 0 },
      seq, reason: '模型上下文已变化，请重新打开删除', source
    }, { chats, sessions, timeline, agent })
    if (saved !== undefined) return saved
    const next = await chats.update(chat.id, current => {
      guards.assertIdle(current, agent, '删除')
      const currentMessage = (current.messages || [])[index]
      if (!currentMessage || floorToken(current, currentMessage) !== floorToken(chat, message)) throw new Error('正文或会话已变化，请重新打开删除')
      if (!agent.session.surface?.nodes.includes(seq)) throw new Error('模型上下文已变化，请重新打开删除')
      return timeline.apply({ chat: current, intent }).chat
    }, { source })
    await synchronizeBodyEdits(agent.session, next, sessions.flush)
    return next
  }

  async function projectVersion(chat, message, swipeId) {
    const source = swipeSource(message, swipeId)
    const reply = await project(source, { ...chat, messages: [message] })
    return {
      swipeId, sourceText: source, projectionText: source,
      text: reply.sessionText, displayText: reply.displayText, displayMode: reply.displayMode
    }
  }

  async function deleteVersion(sessionId, input = {}) {
    if (pending.has(sessionId)) throw new Error('正在删除正文版本，请稍候')
    const index = Number(input.index)
    const turn = Number(input.turn)
    const swipeId = Number(input.swipeId)
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('正文楼层不存在')
    if (!Number.isSafeInteger(swipeId) || swipeId < 0) throw new Error('正文版本不存在')
    pending.add(sessionId)
    try {
      const { chat, agent } = await context(sessionId)
      const message = (chat.messages || [])[index]
      if (!message || message.role !== 'assistant' || Number(message.turn || (message.greeting === true ? 1 : 0)) !== turn) throw new Error('正文楼层不存在或已变化')
      if (swipeId >= swipeCount(message)) throw new Error('正文版本不存在')
      if (input.token !== floorToken(chat, message)) throw new Error('正文或会话已变化，请重新打开删除')
      if (swipeCount(message) <= 1) throw new Error('这是唯一的版本，请删除整轮')
      const target = locateFloor({ chat, session: agent.session, index, turn, role: 'assistant' })
      if (!target) throw new Error('这一楼已不在当前模型上下文中，无法删除版本')
      const latestIndex = (chat.messages || []).findLastIndex(item => item?.role === 'assistant')
      const latest = index === latestIndex && message.greeting !== true
      const previous = message.swipeId === undefined ? 0 : Math.max(0, Number(message.swipeId) || 0)
      const removed = removeSwipe(message, swipeId)
      const next = removed.message
      const states = swipeStates(message)
      const restored = latest && states[next.swipeId]?.settleStatus === 'done' ? states[next.swipeId] : null
      const patch = {
        ...await projectVersion(chat, next, next.swipeId),
        swipes: next.swipes,
        bodyEdit: { id: 'tavern-swipe-delete:' + randomUUID(), seq: target.seq, turn },
        swipeStates: next.swipeStates ?? states.slice(0, next.swipes.length),
        ...(next.variables === undefined ? {} : { variables: next.variables })
      }
      const intent = {
        kind: 'body.swipe', index, turn, swipeId: next.swipeId, patch, latest, restoreState: restored,
        deletionUndo: {
          kind: 'swipe', index, turn, swipeId, previousSwipeId: previous, wasLatest: latest,
          removed: clone(removed.removed), at: Date.now()
        }
      }
      const saved = await save(chat, agent, { index, message, intent, seq: target.seq, source: 'foreground.swipe-delete' })
      if (latest && restored === null) {
        try { await queueSettlement(saved.id) } catch { /* reported by the settlement task itself */ }
      }
      if (typeof scripts?.dispatchEvent === 'function') {
        try { await scripts.dispatchEvent({ sessionId, recent: true, name: 'MESSAGE_DELETED', args: [index] }) } catch { /* scripts never block */ }
      }
      return present(saved)
    } finally { pending.delete(sessionId) }
  }

  async function deleteRound(sessionId, input = {}) {
    if (pending.has(sessionId)) throw new Error('正在删除回合，请稍候')
    const role = input.role === 'user' ? 'user' : 'assistant'
    let index = Number(input.index)
    if (role === 'user') index += 1
    if (!Number.isSafeInteger(index) || index < 1) throw new Error('正文楼层不存在')
    pending.add(sessionId)
    try {
      const { chat, agent } = await context(sessionId)
      const messages = chat.messages || []
      const message = messages[index]
      if (!message || message.role !== 'assistant' || message.greeting === true) throw new Error('这一楼不能整轮删除')
      const turn = Number(message.turn)
      if (!Number.isSafeInteger(turn) || turn !== Number(input.turn)) throw new Error('正文楼层不存在或已变化')
      const target = locateFloor({ chat, session: agent.session, index, turn, role: 'assistant' })
      if (!target) throw new Error('这一楼已不在当前模型上下文中，无法删除')
      guards.assertRescueHistoryEditable(chat, message)
      const hasInput = messages[index - 1]?.role === 'user'
      const from = hasInput ? index - 1 : index
      const count = index - from + 1
      const removed = clone(messages.slice(from, from + count))
      const inputTarget = hasInput ? locateInputFloor({ chat, session: agent.session, index: from, turn }) : null
      if (hasInput && !inputTarget) throw new Error('这一楼的玩家输入已不在当前模型上下文中，无法删除')
      const nodes = agent.session.surface?.nodes || []
      const start = inputTarget ? inputTarget.seq : target.seq
      const startIndex = nodes.indexOf(start)
      const endIndex = nodes.indexOf(target.seq)
      if (startIndex < 0 || endIndex < startIndex) throw new Error('模型上下文已变化，请重新打开删除')
      const shadowed = nodes.slice(startIndex, endIndex + 1).map(Number)
      const before = { posture: str(chat.posture), ledger: clone(chat.ledger ?? null), lastSettle: clone(chat.lastSettle ?? null), settleStatus: str(chat.settleStatus), variables: clone(chat.variables) }
      // Only the last round can be undone: the surface regains a single node per
      // marker, which cannot reproduce a middle round in place.
      const undoable = index === messages.length - 1
      const intent = {
        kind: 'round.delete', index: from, count, turn,
        deletionUndo: { kind: 'round', index: from, count, turn, messages: removed, state: before, undoable, at: Date.now() }
      }
      // A rejected host replacement must never publish a deletion that future
      // requests keep retrying, so prove the range on a detached copy first.
      const markerId = 'tavern-round-delete:' + randomUUID()
      const markerData = { id: markerId, role: 'user', content: [], source: { kind: 'plugin', plugin: 'dsh-tavern-deletion' } }
      const preview = agent.session.constructor.fromRestore(agent.session.id, structuredClone(sessionEvents(agent.session)), structuredClone(agent.session.header), agent.session.inheritedEventCount, 'detached')
      replaceSessionSurface(preview, 'user/message', structuredClone(markerData), { start, end: target.seq, sourceEventSeqs: shadowed })
      const saved = await chats.update(chat.id, current => timeline.apply({ chat: current, intent }).chat, { source: 'foreground.round-delete' })
      const marker = replaceSessionSurface(agent.session, 'user/message', markerData, { start, end: target.seq, sourceEventSeqs: shadowed })
      const markerSeq = Number(marker && typeof marker === 'object' ? marker.seq : marker)
      // Remember what the marker replaced so undo can put the round back.
      await chats.update(saved.id, current => {
        if (!current.deletionUndo) return undefined
        current.deletionUndo = { ...current.deletionUndo, marker: markerSeq, shadowed, hadInput: hasInput }
        return current
      }, { source: 'foreground.round-delete.marker' })
      await sessions.flush(agent.session)
      if (typeof scripts?.dispatchEvent === 'function') {
        try { await scripts.dispatchEvent({ sessionId, recent: true, name: 'MESSAGE_DELETED', args: [from] }) } catch { /* scripts never block */ }
      }
      return present(await chats.forSession(sessionId))
    } finally { pending.delete(sessionId) }
  }

  async function undo(sessionId) {
    if (pending.has(sessionId)) throw new Error('正在撤销删除，请稍候')
    pending.add(sessionId)
    try {
      const { chat, agent } = await context(sessionId)
      const undo = chat.deletionUndo
      if (!undo) throw new Error('没有可撤销的删除')
      if (undo.kind === 'swipe') {
        const message = (chat.messages || [])[undo.index]
        if (!message || message.role !== 'assistant') throw new Error('要恢复的楼层已变化')
        const target = locateFloor({ chat, session: agent.session, index: undo.index, turn: undo.turn, role: 'assistant' })
        if (!target) throw new Error('要恢复的楼层已不在当前模型上下文中')
        const restored = insertSwipe(message, undo.swipeId, undo.removed)
        const next = { ...restored, swipeId: Math.max(0, Math.min(swipeCount(restored) - 1, undo.previousSwipeId)) }
        const states = swipeStates(next)
        const state = undo.wasLatest && states[next.swipeId]?.settleStatus === 'done' ? states[next.swipeId] : null
        const patch = {
          ...await projectVersion(chat, next, next.swipeId),
          swipes: next.swipes,
          bodyEdit: { id: 'tavern-swipe-restore:' + randomUUID(), seq: target.seq, turn: undo.turn },
          swipeStates: states,
          ...(next.variables === undefined ? {} : { variables: next.variables })
        }
        const intent = { kind: 'body.swipe', index: undo.index, turn: undo.turn, swipeId: next.swipeId, patch, latest: undo.wasLatest, restoreState: state, deletionUndo: null }
        const saved = await save(chat, agent, { index: undo.index, message, intent, seq: target.seq, source: 'foreground.swipe-undo' })
        if (undo.wasLatest && state === null) {
          try { await queueSettlement(saved.id) } catch { /* reported by the settlement task itself */ }
        }
        return present(saved)
      }
      if (undo.kind !== 'round') throw new Error('未知的删除记录')
      if (undo.undoable === false) throw new Error('这一轮在模型上下文中的位置无法恢复，不能撤销')
      const intent = { kind: 'round.restore', index: undo.index, messages: clone(undo.messages), state: clone(undo.state) }
      const saved = await chats.update(chat.id, current => timeline.apply({ chat: current, intent }).chat, { source: 'foreground.round-undo' })
      // Put the native round back: the marker becomes the player input and the
      // reply is appended after it (undo is limited to the final round).
      const nodes = agent.session.surface?.nodes || []
      const marker = Number(undo.marker)
      if (nodes.includes(marker)) {
        const events = new Map(sessionEvents(agent.session).map(event => [event.seq, event]))
        const assistant = [...events.values()].find(event => event.type === 'assistant/message' && String(event.data?.turn) === String(undo.turn) && event.seq === Number(undo.shadowed?.at(-1)))
        const user = undo.hadInput ? events.get(Number(undo.shadowed?.[0])) : null
        const assistantData = assistant ? clone(assistant.data) : null
        if (user) {
          replaceSessionSurface(agent.session, 'user/message', clone(user.data), { start: marker, end: marker, sourceEventSeqs: [marker] })
          if (assistantData) appendSessionEvent(agent.session, 'assistant/message', assistantData, { surfaceOp: 'append', sourceEventSeqs: [] })
        } else if (assistantData) {
          replaceSessionSurface(agent.session, 'assistant/message', assistantData, { start: marker, end: marker, sourceEventSeqs: [marker] })
        }
        await sessions.flush(agent.session)
      }
      return present(saved)
    } finally { pending.delete(sessionId) }
  }

  return Object.freeze({ deleteVersion, deleteRound, undo })
}
