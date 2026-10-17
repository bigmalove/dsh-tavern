// Shared guards for history mutations (body edit, swipe selection, deletion).
// One busy/closed-patch vocabulary keeps every entry point refusing the same
// states with wording that names the attempted action.

import { assertRescueHistoryEditable } from './chat-history-rescue.js'

export function createHistoryMutationGuards({ sessionPatch, activity } = {}) {
  function refuseClosedPatch() {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
  }
  function assertIdle(chat, agent, action = '操作') {
    if (agent?.phase?.kind === 'running' || chat.regenInProgress
      || ['pending', 'running'].includes(chat.settleStatus)
      || (typeof activity === 'function' && activity(chat)?.busy)) {
      throw new Error('请等待当前生成或后台处理完成后再' + action)
    }
  }
  return Object.freeze({ refuseClosedPatch, assertIdle, assertRescueHistoryEditable })
}
