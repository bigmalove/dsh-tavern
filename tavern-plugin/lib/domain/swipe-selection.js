// Switching one floor's reply version ("swipe"). Prose, variables and
// settlement travel together on the latest floor; older floors only swap
// their own text. The native Surface is updated in the same transaction, so
// the model context and the save never disagree about the visible version.

import { randomUUID } from 'node:crypto'
import { saveFloorPatch, synchronizeBodyEdits } from './body-editor.js'
import { floorToken, locateFloor } from './floor-location.js'
import { createHistoryMutationGuards } from './history-mutation-guards.js'
import { selectedSwipe, swipeCount, swipeSource, swipeStates } from './swipe-versions.js'
import { sessionEvents } from './session-events.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function createSwipeSelection({ chats, sessions, timeline, activity, project, present, sessionPatch, queueSettlement, scripts, initializeOpeningVariables }) {
  const guards = createHistoryMutationGuards({ sessionPatch, activity })
  const pending = new Set()

  async function context(sessionId, index) {
    guards.refuseClosedPatch()
    const chat = await chats.forSession(sessionId, { index })
    if (!chat) throw new Error('会话不存在')
    const agent = sessions.get(sessionId)
    if (!agent?.session) throw new Error('无法访问原生会话')
    guards.assertIdle(chat, agent, '切换版本')
    // Sync any marker a crashed switch left behind before locating floors.
    await synchronizeBodyEdits(agent.session, chat, sessions.flush, async (dirty, cleared) => {
      const drop = new Set(cleared)
      await chats.update(dirty.id, current => {
        let changed = false
        for (const message of current.messages || []) {
          if (message.bodyEdit && drop.has(message.bodyEdit.id)) {
            delete message.bodyEdit
            changed = true
          }
        }
        return changed ? current : undefined
      }, { source: 'body-edit.stale-clear' })
    })
    return { chat, agent }
  }

  async function select(sessionId, input = {}) {
    if (pending.has(sessionId)) throw new Error('正在切换正文版本，请稍候')
    const index = Number(input.index)
    const turn = Number(input.turn)
    const swipeId = Number(input.swipeId)
    if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(turn) || turn < 1) throw new Error('正文楼层不存在')
    if (!Number.isSafeInteger(swipeId) || swipeId < 0) throw new Error('正文版本不存在')
    pending.add(sessionId)
    try {
      const { chat, agent } = await context(sessionId, index)
      const message = (chat.messages || [])[index]
      if (!message || message.role !== 'assistant' || Number(message.turn || (message.greeting === true ? 1 : 0)) !== turn) throw new Error('正文楼层不存在或已变化')
      guards.assertRescueHistoryEditable(chat, message)
      if (swipeId >= swipeCount(message)) throw new Error('正文版本不存在')
      if (input.token !== floorToken(chat, message)) throw new Error('正文或会话已变化，请重新打开切换')
      const latestIndex = (chat.messages || []).findLastIndex(item => item?.role === 'assistant')
      const latest = index === latestIndex && message.greeting !== true
      // A variable update in flight belongs to the current version; switching
      // would silently drop it, so refuse until it finished or failed.
      if (latest && message.mvu?.pending === true && (message.mvu.pendingSubmission || message.mvu.delivery)) {
        throw new Error('变量更新尚未完成，暂不能切换版本')
      }
      const target = locateFloor({ chat, session: agent.session, index, turn, role: 'assistant' })
      if (!target) throw new Error('这一楼已不在当前模型上下文中，无法切换版本')
      // The header carries the current version's settlement; keep it on that
      // version when the save predates per-version snapshots.
      const oldSwipeId = selectedSwipe(message)
      const states = swipeStates(message)
      if (latest && states[oldSwipeId] == null && str(chat.settleStatus) === 'done') {
        states[oldSwipeId] = { posture: str(chat.posture), ledger: chat.ledger ?? null, lastSettle: chat.lastSettle ?? null, settleStatus: str(chat.settleStatus) }
      }
      if (oldSwipeId === swipeId) return present(chat)
      const restoreState = latest && states[swipeId]?.settleStatus === 'done' ? states[swipeId] : null
      const source = swipeSource(message, swipeId)
      let openingVariables
      if (message.greeting === true && chat.messages.length === 1 && chat.mvu?.enabled === true) {
        const existing = message.variables?.[swipeId]
        if (!existing || existing.stat_data === undefined || existing.schema === undefined) {
          if (typeof initializeOpeningVariables !== 'function') throw new Error('开场白缺少初始变量，无法切换')
          openingVariables = Array.from({ length: swipeCount(message) }, (_, i) => message.variables?.[i] ?? null)
          openingVariables[swipeId] = await initializeOpeningVariables(chat, swipeId)
        }
      }
      const reply = await project(source, chat)
      const patch = {
        swipeId,
        sourceText: source,
        projectionText: source,
        text: reply.sessionText,
        displayText: reply.displayText,
        displayMode: reply.displayMode,
        bodyEdit: { id: 'tavern-swipe:' + randomUUID(), seq: target.seq, turn },
        swipeStates: states,
        ...(openingVariables ? { variables: openingVariables } : {})
      }
      const intent = { kind: 'body.swipe', index, turn, swipeId, patch, latest, restoreState }
      // Validate on an isolated native Session before the durable Chat intent:
      // a rejected host event must never publish a switch future requests keep
      // retrying. The detached projection holds this floor at index 0.
      const preview = agent.session.constructor.fromRestore(agent.session.id, structuredClone(sessionEvents(agent.session)), structuredClone(agent.session.header), agent.session.inheritedEventCount, 'detached')
      await synchronizeBodyEdits(preview, { messages: [{ ...message, ...patch }] }, async () => {})
      let saved = await saveFloorPatch({
        chat, index, message, intent, detachedIntent: { ...intent, index: 0 },
        seq: target.seq, reason: '模型上下文已变化，请重新打开切换', source: 'foreground.body-swipe'
      }, { chats, sessions, timeline, agent })
      if (saved === undefined) {
        saved = await chats.update(chat.id, current => {
          guards.assertIdle(current, agent, '切换版本')
          const currentMessage = (current.messages || [])[index]
          if (!currentMessage || currentMessage.role !== 'assistant' || Number(currentMessage.turn || (currentMessage.greeting === true ? 1 : 0)) !== turn) throw new Error('正文楼层不存在或已变化')
          if (floorToken(current, currentMessage) !== input.token) throw new Error('正文或会话已变化，请重新打开切换')
          if (!agent.session.surface?.nodes.includes(target.seq)) throw new Error('模型上下文已变化，请重新打开切换')
          return timeline.apply({ chat: current, intent }).chat
        }, { source: 'foreground.body-swipe' })
        await synchronizeBodyEdits(agent.session, saved, sessions.flush)
      }
      // A version that never finished its settlement gets one now.
      if (latest && restoreState === null) {
        try { await queueSettlement(saved.id) }
        catch (error) {
          const reason = str(error?.message || error) || '后台结算失败'
          await chats.update(saved.id, current => {
            if (!current || typeof current !== 'object') return current
            current.settleStatus = 'failed'
            current.settleError = reason
            return current
          }, { source: 'settlement.swipe-failed' })
        }
      }
      // Card scripts see the same event a manual swipe raises (Helper message_id).
      if (typeof scripts?.dispatchEvent === 'function') {
        try { await scripts.dispatchEvent({ sessionId, recent: true, name: 'MESSAGE_SWIPED', args: [index] }) } catch { /* Scripts never block the switch. */ }
      }
      return present(saved)
    } finally { pending.delete(sessionId) }
  }

  return Object.freeze({ select })
}
