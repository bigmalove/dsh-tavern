import { replaceSessionSurface } from './session-surface-mutations.js'
import { randomUUID } from 'node:crypto'
import { editableReplyParts } from './reply-presentation.js'
import { floorToken, locateFloor, locateInputFloor } from './floor-location.js'
import { sessionEvents } from './session-events.js'
import { isScopedMessages } from './scoped-messages.js'
import { diffJson } from './json-mutation.js'
import { createHistoryMutationGuards } from './history-mutation-guards.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}
function source(message) { return message.projectionText ?? message.sourceText ?? message.text ?? '' }

/**
 * Which floor an edit names. Without an explicit index this keeps the original
 * contract (only the last assistant floor); callers that pass index/turn may
 * edit any loaded floor, including player inputs and the card greeting.
 */
function resolveFloor(chat, input) {
  if (!['story', 'script', 'writing'].includes(chat.mode || 'story')) throw new Error('只能编辑正文楼层')
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  const explicit = input !== null && input !== undefined && input.index !== undefined && input.index !== null
  let index
  if (explicit) index = Number(input.index)
  else {
    // Legacy callers edit "the last round": a newer player input means the
    // reply they hold is no longer the end of the conversation.
    index = messages.findLastIndex(item => item?.role === 'assistant')
    if (index < 0 || index !== messages.length - 1) throw new Error('只能编辑最后一轮正文')
  }
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('正文楼层不存在')
  const message = messages[index]
  if (!message || typeof message !== 'object') throw new Error('正文楼层不存在')
  const role = input && input.role ? str(input.role) : str(message.role)
  if (role !== message.role || !['assistant', 'user'].includes(role)) throw new Error('正文楼层不存在或已变化')
  const greeting = message.greeting === true
  // A player input belongs to the round of the reply that follows it; both the
  // greeting and later replies carry their own turn.
  const turn = role === 'user'
    ? Number(messages[index + 1]?.turn) || 0
    : Number(message.turn) || (greeting ? 1 : 0)
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('正文楼层不存在或已变化')
  if (input && input.turn !== undefined && input.turn !== null && Number(input.turn) !== turn) throw new Error('正文楼层不存在或已变化')
  const latest = role === 'assistant' && !greeting
    && index === messages.length - 1 && index === messages.findLastIndex(item => item?.role === 'assistant')
  if (!explicit && !latest) throw new Error('只能编辑最后一轮正文')
  // The menu path stays "the last round": if a new input arrived after it was
  // read, the edit is refused instead of silently editing an older floor.
  if (input && input.latest === true && !latest) throw new Error('只能编辑最后一轮正文')
  return { index, message, role, turn, greeting, latest }
}

/** Reconcile a durable Chat edit to native Surface; retries never duplicate history. */
export async function synchronizeBodyEdits(session, chat, flush, persistChat) {
  const recorded = new Set()
  for (const event of sessionEvents(session)) {
    if (event.type === 'assistant/message' && event.data?.message?.id) recorded.add(event.data.message.id)
    else if (event.type === 'user/message' && event.data?.id) recorded.add(event.data.id)
  }
  const cleared = []
  let sessionDirty = false
  for (const message of chat.messages || []) {
    if (!message?.bodyEdit) continue
    const { id, seq, turn } = message.bodyEdit
    if (recorded.has(id)) continue
    const user = message.bodyEdit.role === 'user' || message.role === 'user'
    let targetSeq = session.surface?.nodes.includes(seq) ? seq : null
    // Migration renumbers seqs and may fold the body-edit injection onto its
    // target; Chat markers still hold the pre-migration seq. Recover by turn.
    if (targetSeq == null && turn != null) {
      const located = user
        ? locateInputFloor({ chat: { messages: [message] }, session, index: 0, turn })
        : locateFloor({ chat: { messages: [message] }, session, index: 0, turn, role: 'assistant' })
      targetSeq = located?.seq ?? null
    }
    if (targetSeq == null) {
      // Issue #72: orphaned marker after migration wiped the injection. Chat
      // already holds the edited text — drop the marker so turns can proceed.
      cleared.push(id)
      delete message.bodyEdit
      continue
    }
    if (targetSeq !== seq) message.bodyEdit = { ...message.bodyEdit, seq: targetSeq, turn }
    replaceSessionSurface(session, user ? 'user/message' : 'assistant/message', user ? {
      id, role: 'user', content: [{ type: 'text', text: str(message.text) }], source: { kind: 'user' }
    } : {
      turn, step: 1,
      message: { id, role: 'assistant', content: [{ type: 'text', text: message.text }], source: { kind: 'model', provider: 'dsh-tavern', model: 'body-edit' } }
    }, { start: targetSeq, end: targetSeq, sourceEventSeqs: [targetSeq] })
    recorded.add(id)
    sessionDirty = true
  }
  if (cleared.length && typeof persistChat === 'function') {
    await persistChat(chat, cleared)
  }
  if (sessionDirty || (chat.messages || []).some(message => message.bodyEdit)) await flush(session)
  return cleared
}

/**
 * Persist one floor's timeline intent on a bounded (scoped) save. The intent is
 * applied to a detached header plus that single floor, and both are patched on
 * the read revision; a moved revision returns undefined so the complete path
 * re-validates the operation token. Shared by body edits and version switches;
 * the saved Chat is returned, presentation is the caller's business.
 */
export async function saveFloorPatch({ chat, index, message, intent, detachedIntent = intent, seq, reason = '模型上下文已变化，请重新打开', source = 'foreground.body-edit' }, { chats, sessions, timeline, agent }) {
  if (!isScopedMessages(chat.messages) || typeof chats.patch !== 'function') return undefined
  const { messages: _rows, ...header } = chat
  const edited = timeline.apply({ chat: { ...header, messages: [message] }, intent: detachedIntent }).chat
  const { messages: [row], ...head } = edited
  const changes = diffJson({ ...header, messages: [] }, { ...head, messages: [] }).filter(change => !['_storageRevision', 'updatedAt'].includes(change.path[0]))
  for (const change of diffJson(message, row)) changes.push({ ...change, path: ['messages', index, ...change.path] })
  const saved = await chats.patch(chat.id, chat._storageRevision, changes, { source, assertCurrent() {
    if (!agent.session.surface?.nodes.includes(seq)) throw new Error(reason)
  } })
  if (!saved) return undefined
  await synchronizeBodyEdits(agent.session, { messages: [row] }, sessions.flush)
  return saved
}

/** Edit prose only; do not replay macros, scripts or settlement. */
export function createBodyEditor({ chats, sessions, timeline, activity, project, present, sessionPatch, repairNative }) {
  const guards = createHistoryMutationGuards({ sessionPatch, activity })
  const pending = new Set()
  function locate(session, chat, floor) {
    const located = floor.role === 'user'
      ? locateInputFloor({ chat, session, index: floor.index, turn: floor.turn })
      : locateFloor({ chat, session, index: floor.index, turn: floor.turn, role: 'assistant' })
    return located || null
  }
  function parts(floor) {
    if (floor.role === 'user') return [{ kind: 'text', text: str(floor.message.text) }]
    return editableReplyParts(source(floor.message))
  }
  // The save is the truth: a floor the native tail lost is repaired, not refused.
  async function restore(sessionId, agent) {
    if (typeof repairNative !== 'function') return null
    await repairNative(sessionId, agent.session)
    const chat = await chats.forSession(sessionId)
    if (!chat) throw new Error('会话不存在')
    guards.assertIdle(chat, agent, '编辑')
    return chat
  }
  async function context(sessionId, input) {
    guards.refuseClosedPatch()
    const index = input && Number.isSafeInteger(Number(input.index)) ? Number(input.index) : undefined
    let chat = await chats.forSession(sessionId, index === undefined ? undefined : { index })
    if (!chat) throw new Error('会话不存在')
    const agent = sessions.get(sessionId)
    if (!agent?.session) throw new Error('无法访问原生会话')
    guards.assertIdle(chat, agent, '编辑')
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
    let floor = resolveFloor(chat, input)
    let located = locate(agent.session, chat, floor)
    if (!located) {
      const repaired = await restore(sessionId, agent)
      if (!repaired) throw new Error(floor.role === 'user' ? '这一楼已不在当前上下文中，无法编辑' : '正文已不在当前上下文中，无法编辑')
      chat = repaired
      floor = resolveFloor(chat, input)
      located = locate(agent.session, chat, floor)
      if (!located) throw new Error(floor.role === 'user' ? '这一楼已不在当前上下文中，无法编辑' : '正文已不在当前上下文中，无法编辑')
    }
    guards.assertRescueHistoryEditable(chat, floor.message)
    return { chat, agent, floor, located }
  }
  async function read(sessionId, input) {
    const { chat, floor } = await context(sessionId, input)
    const list = parts(floor)
    if (floor.role !== 'user' && !list.some(part => part.kind === 'text' && part.text.trim())) throw new Error('这轮只有 HTML，没有可编辑文本')
    return {
      token: floorToken(chat, floor.message), index: floor.index, turn: floor.turn, role: floor.role, latest: floor.latest,
      greeting: floor.greeting,
      parts: list.map(part => part.kind === 'text' ? part : { kind: part.kind })
    }
  }
  async function save(sessionId, input) {
    if (pending.has(sessionId)) throw new Error('正在保存正文，请稍候')
    pending.add(sessionId)
    try {
      const { chat, agent, floor, located } = await context(sessionId, input)
      if (input?.token !== floorToken(chat, floor.message)) throw new Error('正文或会话已变化，请重新打开编辑')
      const list = parts(floor)
      const editable = list.filter(part => part.kind === 'text')
      const texts = input.texts
      if (!Array.isArray(texts) || texts.length !== editable.length || texts.some(text => typeof text !== 'string')) throw new Error('编辑文本格式无效')
      if (!texts.some(text => text.trim())) throw new Error('正文不能为空')
      if (floor.role !== 'user' && texts.some(text => editableReplyParts(text).some(part => part.kind !== 'text'))) throw new Error('这里只能编辑文本，不能新增 HTML')
      // Cards' status blocks must start on their own line. An edit box hides the blank lines
      // around a text part, so keep the original edges when the edited text has none.
      const keepEdges = (original, edited) => (/^\s/.test(edited) ? '' : original.match(/^\s*/)[0]) + edited + (/\s$/.test(edited) ? '' : original.match(/\s*$/)[0])
      let at = 0
      const text = list.map(part => part.kind === 'text' ? keepEdges(part.text, texts[at++]) : part.text).join('')
      const before = floor.role === 'user' ? str(floor.message.text) : source(floor.message)
      if (text === before) return present(chat)
      const patch = floor.role === 'user'
        ? { text, bodyEdit: { id: 'tavern-body-edit:' + randomUUID(), seq: located.seq, turn: located.turn, role: 'user' } }
        : { sourceText: text, projectionText: text, bodyEdit: { id: 'tavern-body-edit:' + randomUUID(), seq: located.seq, turn: located.turn, role: 'assistant' } }
      if (floor.role !== 'user') {
        // Project against the floor itself: its macros and status blocks belong
        // to that round, never to the current scene.
        const reply = await project(text, { ...chat, messages: [floor.message] })
        patch.text = reply.sessionText
        patch.displayText = reply.displayText
        patch.displayMode = reply.displayMode
        if (Array.isArray(floor.message.swipes)) {
          patch.swipes = structuredClone(floor.message.swipes)
          const swipe = Number(floor.message.swipeId) || 0
          if (typeof patch.swipes[swipe] === 'string') patch.swipes[swipe] = text
        }
      }
      const intent = floor.latest
        ? { kind: 'body.edit', turn: floor.turn, patch }
        : { kind: 'body.floor', index: floor.index, turn: floor.turn, role: floor.role, patch }
      // Validate on an isolated native Session before the durable Chat intent.
      // A rejected host event must never publish an edit that future requests
      // will keep trying (and failing) to synchronize. Accepted writes retain
      // the existing journal-first recovery path for disk/flush failures.
      const preview = agent.session.constructor.fromRestore(agent.session.id, structuredClone(sessionEvents(agent.session)), structuredClone(agent.session.header), agent.session.inheritedEventCount, 'detached')
      await synchronizeBodyEdits(preview, { messages: [{ ...floor.message, ...patch }] }, async () => {})
      const saved = await saveFloorPatch({
        chat, index: floor.index, message: floor.message, seq: located.seq,
        intent: floor.latest ? intent : { ...intent, index: floor.index },
        detachedIntent: floor.latest ? intent : { ...intent, index: 0 },
        reason: '模型上下文已变化，请重新打开编辑', source: 'foreground.body-edit'
      }, { chats, sessions, timeline, agent })
      if (saved !== undefined) return present(saved)
      const next = await chats.update(chat.id, current => {
        guards.assertIdle(current, agent, '编辑')
        const currentFloor = resolveFloor(current, input)
        if (floorToken(current, currentFloor.message) !== input.token) throw new Error('正文或会话已变化，请重新打开编辑')
        if (!agent.session.surface?.nodes.includes(located.seq)) throw new Error('模型上下文已变化，请重新打开编辑')
        return timeline.apply({ chat: current, intent: floor.latest ? intent : { ...intent, index: currentFloor.index } }).chat
      }, { source: 'foreground.body-edit' })
      await synchronizeBodyEdits(agent.session, next, sessions.flush)
      return present(next)
    } finally { pending.delete(sessionId) }
  }
  // A whole new text (plugins): its HTML and markers must equal the current ones, in order;
  // only the prose between them changes, through the same checks as a player's edit.
  async function replaceText(sessionId, text) {
    const { chat, floor } = await context(sessionId, undefined)
    const list = parts(floor)
    const fixed = list.filter(part => part.kind !== 'text')
    const gaps = Array.from({ length: fixed.length + 1 }, () => '')
    let gap = 0
    for (const part of editableReplyParts(String(text))) {
      if (part.kind === 'text') { gaps[gap] += part.text; continue }
      if (gap >= fixed.length || fixed[gap].kind !== part.kind || fixed[gap].text.trim() !== part.text.trim()) throw new Error('正文里的 HTML 块要保持原样，只能改文字')
      gap++
    }
    if (gap !== fixed.length) throw new Error('正文里的 HTML 块要保持原样，只能改文字')
    const texts = []
    gap = 0
    for (const part of list) {
      if (part.kind !== 'text') { gap++; continue }
      texts.push(gaps[gap])
      gaps[gap] = ''
    }
    if (gaps.some(rest => rest.trim())) throw new Error('只能修改原有的文字段落，不能在 HTML 块之间新增段落')
    return await save(sessionId, { token: floorToken(chat, floor.message), texts })
  }
  return Object.freeze({ read, save, replaceText })
}
