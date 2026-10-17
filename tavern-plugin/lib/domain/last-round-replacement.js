import { appendSwipe, selectedSwipe, withSwipeState } from './swipe-versions.js'

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/** The pre-rollback settlement state, kept per version when it is replaced. */
export function originalStateOf(chat) {
  if (!chat) return null
  return {
    posture: str(chat.posture),
    ledger: chat.ledger === undefined ? null : clone(chat.ledger),
    lastSettle: chat.lastSettle === undefined ? null : clone(chat.lastSettle),
    settleStatus: str(chat.settleStatus) || 'idle'
  }
}

function regenerationConflict(reason) {
  const error = new Error('重新生成期间正文已被另一项操作修改：' + reason)
  error.code = 'DSH_TAVERN_REGEN_CONFLICT'
  return error
}

export function assertRegenerationSourceCurrent(input = {}) {
  const originalChat = input.originalChat
  const currentChat = input.currentChat
  const assistantIndex = Number(input.assistantIndex)
  if (!originalChat || !currentChat || !Array.isArray(originalChat.messages) || !Array.isArray(currentChat.messages)) throw regenerationConflict('聊天状态不完整')
  const originalBranch = str(originalChat.timeline && originalChat.timeline.branchId)
  const currentBranch = str(currentChat.timeline && currentChat.timeline.branchId)
  if (originalBranch !== '' && currentBranch !== originalBranch) throw regenerationConflict('剧情分支已经切换')
  if (currentChat.messages.length !== originalChat.messages.length) throw regenerationConflict('对话轮次已经变化')
  const originalUser = originalChat.messages[assistantIndex - 1]
  const currentUser = currentChat.messages[assistantIndex - 1]
  const originalAssistant = originalChat.messages[assistantIndex]
  const currentAssistant = currentChat.messages[assistantIndex]
  if (!originalUser || !currentUser || originalUser.role !== 'user' || currentUser.role !== 'user' || str(currentUser.text) !== str(originalUser.text)) throw regenerationConflict('玩家输入已经变化')
  if (!originalAssistant || !currentAssistant || originalAssistant.role !== 'assistant' || Number(currentAssistant.turn) !== Number(originalAssistant.turn)) throw regenerationConflict('正文楼层已经变化')
  // text/sourceText follow the selected version: switching versions makes a
  // concurrent regeneration conflict, exactly like an edit does.
  if (str(currentAssistant.text) !== str(originalAssistant.text) || str(currentAssistant.sourceText) !== str(originalAssistant.sourceText)) throw regenerationConflict('正文内容已经变化')
  return currentChat
}

/** Replace the last committed user/body pair, appending the generated reply as
 * one more version: every earlier version stays selectable and the new one is
 * selected. `originalState` is the pre-rollback header, whose settlement
 * belongs to the version being replaced and is snapshotted onto it. */
export function replaceLastRound(input = {}) {
  const originalChat = clone(input.originalChat)
  const regeneratedChat = clone(input.regeneratedChat)
  const assistantIndex = Number(input.assistantIndex)
  if (!originalChat || !regeneratedChat || !Array.isArray(originalChat.messages) || !Array.isArray(regeneratedChat.messages)) throw new Error('重新生成缺少聊天状态')
  const originalAssistant = originalChat.messages[assistantIndex]
  const originalUser = originalChat.messages[assistantIndex - 1]
  const regeneratedAssistant = regeneratedChat.messages[regeneratedChat.messages.length - 1]
  if (!originalAssistant || originalAssistant.role !== 'assistant' || !originalUser || originalUser.role !== 'user') throw new Error('原正文不是玩家输入与助手回复组合')
  if (!regeneratedAssistant || regeneratedAssistant.role !== 'assistant') throw new Error('重新生成没有产生助手回复')

  const selected = selectedSwipe(regeneratedAssistant)
  const source = Array.isArray(regeneratedAssistant.swipes) && regeneratedAssistant.swipes[selected] !== undefined
    ? str(regeneratedAssistant.swipes[selected])
    : str(regeneratedAssistant.sourceText || regeneratedAssistant.text)
  const oldSwipeId = selectedSwipe(originalAssistant)
  const oldSwipes = Array.isArray(originalAssistant.swipes) && originalAssistant.swipes.length
    ? clone(originalAssistant.swipes)
    : [str(originalAssistant.sourceText || originalAssistant.text)]
  const hasVariables = Array.isArray(originalAssistant.variables) || Array.isArray(regeneratedAssistant.variables)
  const replacement = Object.assign({}, clone(originalAssistant), clone(regeneratedAssistant), {
    turn: originalAssistant.turn,
    swipeId: oldSwipeId,
    swipes: oldSwipes,
    ...(hasVariables ? { variables: Array.isArray(originalAssistant.variables)
      ? clone(originalAssistant.variables)
      : oldSwipes.map(() => null) } : {})
  })
  // Version bookkeeping belongs to the replaced round, never to the synthetic
  // turn's fresh reply; a state array may only survive from the original.
  if (Array.isArray(originalAssistant.swipeStates)) replacement.swipeStates = clone(originalAssistant.swipeStates)
  else delete replacement.swipeStates
  delete replacement.bodyEdit
  // The regenerated body replaces the original reply in the native session, so
  // the round keeps the original reply's anchor, never the synthetic turn's.
  if (originalAssistant.nativeAnchor) replacement.nativeAnchor = clone(originalAssistant.nativeAnchor)
  else delete replacement.nativeAnchor
  // The version being replaced keeps the settlement it already earned, so
  // switching back to it restores instead of re-settling.
  const originalState = input.originalState
  const snapshotted = originalState ? withSwipeState(replacement, oldSwipeId, {
    posture: str(originalState.posture),
    ledger: originalState.ledger === undefined ? null : clone(originalState.ledger),
    lastSettle: originalState.lastSettle === undefined ? null : clone(originalState.lastSettle),
    settleStatus: str(originalState.settleStatus) || 'idle'
  }) : replacement
  const merged = appendSwipe(snapshotted, {
    source,
    variables: Array.isArray(regeneratedAssistant.variables) ? clone(regeneratedAssistant.variables[selected] || {}) : undefined,
    state: null
  })
  regeneratedChat.messages = originalChat.messages.slice(0, assistantIndex - 1).concat([clone(originalUser), merged])
  return { chat: regeneratedChat, assistant: merged }
}
