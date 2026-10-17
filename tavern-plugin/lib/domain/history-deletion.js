// Deleting one reply version, or one message, with a single undo point.
//
// A version lives inside one Chat floor: removing it only rewrites that floor's
// arrays and its native text. A message is one row (a reply, a player input or
// the greeting): removing it drops that row alone and shadows exactly one native
// node with an empty plugin marker, so undo can put the same message back in
// place — neighbours are never touched.

import { randomUUID } from 'node:crypto'
import { saveFloorPatch, synchronizeBodyEdits } from './body-editor.js'
import { floorToken, locateFloor, locateInputFloor } from './floor-location.js'
import { createHistoryMutationGuards } from './history-mutation-guards.js'
import { insertSwipe, removeSwipe, swipeCount, swipeSource, swipeStates } from './swipe-versions.js'
import { sessionEvents } from './session-events.js'
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

  async function context(sessionId, index) {
    guards.refuseClosedPatch()
    // A bounded save only loads the floors it is asked for; name the target row
    // so an older message is readable even when it is outside the tail window.
    const chat = await chats.forSession(sessionId, Number.isSafeInteger(index) ? { index } : undefined)
    if (!chat) throw new Error('会话不存在')
    const agent = sessions.get(sessionId)
    if (!agent?.session) throw new Error('无法访问原生会话')
    guards.assertIdle(chat, agent, '删除')
    return { chat, agent }
  }

  async function saveVersion(chat, agent, { index, message, intent, seq, source }) {
    const saved = await saveFloorPatch({
      chat, index, message, intent, detachedIntent: { ...intent, index: 0 },
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
      const { chat, agent } = await context(sessionId, index)
      const message = (chat.messages || [])[index]
      if (!message || message.role !== 'assistant' || Number(message.turn || (message.greeting === true ? 1 : 0)) !== turn) throw new Error('正文楼层不存在或已变化')
      if (swipeId >= swipeCount(message)) throw new Error('正文版本不存在')
      if (input.token !== floorToken(chat, message)) throw new Error('正文或会话已变化，请重新打开删除')
      if (swipeCount(message) <= 1) throw new Error('这是唯一的版本，请删除这条消息')
      const target = locateFloor({ chat, session: agent.session, index, turn, role: 'assistant' })
      if (!target) throw new Error('这一楼已不在当前模型上下文中，无法删除版本')
      const latestIndex = (chat.messages || []).findLastIndex(item => item?.role === 'assistant')
      const latest = index === latestIndex && message.greeting !== true
      const previous = Math.max(0, Number(message.swipeId) || 0)
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
      const saved = await saveVersion(chat, agent, { index, message, intent, seq: target.seq, source: 'foreground.swipe-delete' })
      if (latest && restored === null) {
        try { await queueSettlement(saved.id) } catch { /* reported by the settlement task itself */ }
      }
      await notify(sessionId, 'MESSAGE_DELETED', index)
      return present(saved)
    } finally { pending.delete(sessionId) }
  }

  async function notify(sessionId, name, index) {
    if (typeof scripts?.dispatchEvent !== 'function') return
    try { await scripts.dispatchEvent({ sessionId, recent: true, name, args: [index] }) } catch { /* scripts never block a mutation */ }
  }

  /** Delete exactly one message: never the player input beside it. */
  async function deleteMessage(sessionId, input = {}) {
    if (pending.has(sessionId)) throw new Error('正在删除消息，请稍候')
    const index = Number(input.index)
    const turn = Number(input.turn)
    const role = input.role === 'user' ? 'user' : 'assistant'
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('要删除的消息不存在')
    pending.add(sessionId)
    try {
      const { chat, agent } = await context(sessionId, index)
      const message = (chat.messages || [])[index]
      if (!message || message.role !== role) throw new Error('要删除的消息不存在或已变化')
      const expected = role === 'user'
        ? Number(chat.messages[index + 1]?.turn) || 0
        : Number(message.turn) || (message.greeting === true ? 1 : 0)
      if (!Number.isSafeInteger(expected) || expected < 1 || expected !== turn) throw new Error('要删除的消息不存在或已变化')
      guards.assertRescueHistoryEditable(chat, message)
      const target = role === 'user'
        ? locateInputFloor({ chat, session: agent.session, index, turn })
        : locateFloor({ chat, session: agent.session, index, turn, role: 'assistant' })
      if (!target) throw new Error('这条消息已不在当前模型上下文中，无法删除')
      const nodes = agent.session.surface?.nodes || []
      const nodeIndex = nodes.indexOf(target.seq)
      if (nodeIndex < 0) throw new Error('模型上下文已变化，请重新打开删除')
      const state = {
        posture: str(chat.posture), ledger: clone(chat.ledger ?? null), lastSettle: clone(chat.lastSettle ?? null),
        settleStatus: str(chat.settleStatus), hasVariables: Object.hasOwn(chat, 'variables'), variables: clone(chat.variables)
      }
      // The marker replaces exactly this node; its id lets undo find it again
      // even after the surface was rebuilt for unrelated reasons.
      const markerId = 'tavern-message-delete:' + randomUUID()
      const marker = { id: markerId, role: 'user', content: [], source: { kind: 'plugin', plugin: 'dsh-tavern-deletion' } }
      const undo = {
        kind: 'message', index, turn, role, message: clone(message), state,
        nativeSeq: target.seq,
        nativeType: role === 'user' ? 'user/message' : 'assistant/message',
        markerId, at: Date.now()
      }
      const intent = { kind: 'message.delete', index, role, turn, deletionUndo: undo }
      // Prove the replacement on a detached copy first: a rejected host event
      // must never publish a deletion that later requests keep retrying.
      const preview = agent.session.constructor.fromRestore(agent.session.id, structuredClone(sessionEvents(agent.session)), structuredClone(agent.session.header), agent.session.inheritedEventCount, 'detached')
      replaceSessionSurface(preview, 'user/message', structuredClone(marker), { start: target.seq, end: target.seq, sourceEventSeqs: [target.seq] })
      const saved = await chats.update(chat.id, current => {
        guards.assertIdle(current, agent, '删除')
        const currentMessage = (current.messages || [])[index]
        if (!currentMessage || currentMessage.role !== role || floorToken(current, currentMessage) !== floorToken(chat, message)) throw new Error('消息已变化，请重新打开删除')
        if (!agent.session.surface?.nodes.includes(target.seq)) throw new Error('模型上下文已变化，请重新打开删除')
        return timeline.apply({ chat: current, intent }).chat
      }, { source: 'foreground.message-delete' })
      replaceSessionSurface(agent.session, 'user/message', marker, { start: target.seq, end: target.seq, sourceEventSeqs: [target.seq] })
      await sessions.flush(agent.session)
      await notify(sessionId, 'MESSAGE_DELETED', index)
      return present(saved)
    } finally { pending.delete(sessionId) }
  }

  async function undo(sessionId) {
    if (pending.has(sessionId)) throw new Error('正在撤销删除，请稍候')
    pending.add(sessionId)
    try {
      // The undo record lives in the header, but the row it names may sit outside
      // a paged window; read again for that exact floor once the record is known.
      const probe = await context(sessionId)
      const record = probe.chat.deletionUndo
      if (!record) throw new Error('没有可撤销的删除')
      const target = Number(record.index)
      const { chat, agent } = Number.isSafeInteger(target) ? await context(sessionId, target) : probe
      const undo = chat.deletionUndo || record
      if (undo.kind === 'swipe') return await undoVersion(chat, agent, sessionId, undo)
      if (undo.kind !== 'message') throw new Error('未知的删除记录')
      if (!Number.isSafeInteger(undo.index) || undo.index < 0) throw new Error('删除记录已失效')
      const nodes = agent.session.surface?.nodes || []
      const events = new Map(sessionEvents(agent.session).map(event => [event.seq, event]))
      const markerSeq = nodes.map(Number).find(seq => {
        const event = events.get(seq)
        return event?.type === 'user/message' && String(event.data?.id) === String(undo.markerId)
      })
      if (markerSeq === undefined) throw new Error('原生消息面已变化，无法撤销这条删除')
      const original = events.get(Number(undo.nativeSeq))
      if (!original || original.type !== undo.nativeType) throw new Error('原生消息面已变化，无法撤销这条删除')
      const intent = { kind: 'message.restore', index: undo.index, message: clone(undo.message), state: clone(undo.state) }
      const saved = await chats.update(chat.id, current => {
        guards.assertIdle(current, agent, '撤销删除')
        return timeline.apply({ chat: current, intent }).chat
      }, { source: 'foreground.message-undo' })
      replaceSessionSurface(agent.session, undo.nativeType, clone(original.data), { start: markerSeq, end: markerSeq, sourceEventSeqs: [markerSeq] })
      await sessions.flush(agent.session)
      return present(saved)
    } finally { pending.delete(sessionId) }
  }

  async function undoVersion(chat, agent, sessionId, undo) {
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
    const saved = await saveVersion(chat, agent, { index: undo.index, message, intent, seq: target.seq, source: 'foreground.swipe-undo' })
    if (undo.wasLatest && state === null) {
      try { await queueSettlement(saved.id) } catch { /* reported by the settlement task itself */ }
    }
    return present(saved)
  }

  return Object.freeze({ deleteVersion, deleteMessage, undo })
}
