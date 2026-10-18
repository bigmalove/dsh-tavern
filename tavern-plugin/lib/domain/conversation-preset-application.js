/**
 * Apply a conversation preset onto the freshest chat state.
 *
 * The preset snapshot is derived from the preset file, never from chat state,
 * and this mutation owns a single header field. A strict storage-revision
 * equality would therefore reject the switch whenever background maintenance
 * (status-panel capture, template sync, helper variables) commits between the
 * read and this mutation, which is precisely what happens right after a turn.
 * Two things are real hazards: the chat being replaced (fork/import) decides by
 * identity, and a round that landed meanwhile decides by message count — a
 * display receipt or background write adds none and must not block the switch.
 */
export function applyConversationPresetToCurrent(current, chat, snapshot) {
  if (current.sessionId !== chat.sessionId) throw new Error('当前游戏已变化，请刷新后重试')
  if ((current.messages || []).length !== (chat.messages || []).length) throw new Error('当前游戏已变化，请刷新后重试')
  current.runtimePresetSnapshot = snapshot
  return current
}
