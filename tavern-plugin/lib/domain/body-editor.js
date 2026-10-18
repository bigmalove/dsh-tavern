import { upgradeReferences } from './session-upgrade-references.js'
import { replaceSessionSurface } from './session-surface-mutations.js'
import { randomUUID } from 'node:crypto'
import { editableReplyParts } from './reply-presentation.js'
import { floorToken, locateFloor, locateInputFloor } from './floor-location.js'
import { floorsIndex } from './conversation-fork-targets.js'
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
  // greeting and later replies carry their own turn. That reply may have been
  // deleted on its own, leaving the input without a neighbour to read the round
  // from: the caller's turn (already resolved through the floor table) is then
  // the only truth, otherwise every edit of that input looks "changed".
  const neighbourTurn = role === 'user' ? Number(messages[index + 1]?.turn) || 0 : 0
  const givenTurn = input && input.turn !== undefined && input.turn !== null ? Number(input.turn) : 0
  const turn = role === 'user'
    ? (neighbourTurn > 0 ? neighbourTurn : givenTurn)
    : Number(message.turn) || (greeting ? 1 : 0)
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('正文楼层不存在或已变化')
  // 从下一条回复读到的回合才有对比意义；输入自己带的就是它的回合。
  if (input && givenTurn > 0 && neighbourTurn > 0 && givenTurn !== neighbourTurn) throw new Error('正文楼层不存在或已变化')
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
  const events = sessionEvents(session)
  const references = upgradeReferences(events)
  const recorded = new Set()
  for (const event of events) {
    if (event.type === 'assistant/message' && event.data?.message?.id) recorded.add(event.data.message.id)
    else if (event.type === 'user/message' && event.data?.id) recorded.add(event.data.id)
  }
  const cleared = []
  let sessionDirty = false
  for (const message of chat.messages || []) {
    if (!message?.bodyEdit) continue
    const { id, turn } = message.bodyEdit
    const seq = references.sequence(message.bodyEdit.seq, message.bodyEdit.formatVersion)
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
    // formatVersion 4 marks the seq as already mapped by the migration, so a
    // later pass never shifts an already-corrected marker a second time.
    if (targetSeq !== seq) message.bodyEdit = { ...message.bodyEdit, seq: targetSeq, turn, formatVersion: 4 }
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
  // A floor the native surface cannot carry (null seq) is saved first and handed
  // to repair by the caller; a located one must stay where it was read.
  const saved = await chats.patch(chat.id, chat._storageRevision, changes, { source, assertCurrent() {
    if (seq != null && !agent.session.surface?.nodes.includes(seq)) throw new Error(reason)
  } })
  if (!saved) return undefined
  if (seq != null) await synchronizeBodyEdits(agent.session, { messages: [row] }, sessions.flush)
  return saved
}

/** Edit prose only; do not replay macros, scripts or settlement. */
export function createBodyEditor({ chats, sessions, timeline, activity, project, present, sessionPatch, repairNative }) {
  const guards = createHistoryMutationGuards({ sessionPatch, activity })
  const pending = new Set()
  // 玩家输入的原生节点以楼层表为准。楼层表（页面上那排按钮用的同一份）按时间顺序
  // 把输入逐条配到节点上；locateInputFloor 只按 turn 反查，而导入的聊天记录没有逐轮
  // turn/start、正文编辑写出的替换节点也不带 turn，两套规则必然对不上：编辑会落到
  // 相邻楼层的原生节点上——Chat 改对了、页面上那一楼却没变，再点就报
  // 「这一楼已不在当前上下文中」。
  // 配对要数完整历史里的玩家消息，bounded 读到的稀疏行数不出来，所以单独取完整 Chat；
  // 编辑是低频操作，这一次完整读换的是两边定位一致。turn 反查保留为兜底。
  async function locateInput(sessionId, session, chat, floor) {
    const complete = typeof chats.completeForSession === 'function' ? await chats.completeForSession(sessionId) : null
    const mapped = complete && Object.values(floorsIndex(complete, session, { busy: false }).bySeq)
      .find(entry => entry.index === floor.index && entry.role === 'user')
    if (mapped) return { seq: mapped.seq, turn: mapped.turn }
    return locateInputFloor({ chat, session, index: floor.index, turn: floor.turn })
  }
  async function locate(sessionId, session, chat, floor) {
    const located = floor.role === 'user'
      ? await locateInput(sessionId, session, chat, floor)
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
    // 页面上的按钮带着删除前的 index：删掉一条后后面每一条都会前移。带节点身份
    // （助手消息 id / 玩家输入的原生 seq）时先用完整存档的楼层表换回当前 index。
    const named = str(input && input.messageId).trim()
    const seq = Number(input && input.seq)
    let resolved = null
    if (named !== '' || (Number.isSafeInteger(seq) && seq >= 0)) {
      const owner = sessions.get(sessionId)
      const complete = owner?.session && typeof chats.completeForSession === 'function' ? await chats.completeForSession(sessionId) : null
      if (complete) {
        const floors = floorsIndex(complete, owner.session, { busy: false })
        resolved = named !== '' ? floors.byMessageId[named] : floors.bySeq[String(seq)]
        if (!resolved) throw new Error('这条消息已经不在了，请刷新后重试')
        input = { ...input, index: resolved.index, turn: resolved.turn, role: resolved.role }
      }
    }
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
    let located = await locate(sessionId, agent.session, chat, floor)
    if (!located) {
      const repaired = await restore(sessionId, agent)
      if (!repaired) throw new Error(floor.role === 'user' ? '这一楼已不在当前上下文中，无法编辑' : '正文已不在当前上下文中，无法编辑')
      chat = repaired
      floor = resolveFloor(chat, input)
      located = await locate(sessionId, agent.session, chat, floor)
      // The save is the truth: a latest reply the native surface cannot carry is
      // still editable — it is saved without a marker and repair carries the text
      // over on the next round. Older floors need their native node to stay put.
      if (!located && (!floor.latest || floor.role === 'user')) {
        throw new Error(floor.role === 'user' ? '这一楼已不在当前上下文中，无法编辑' : '正文已不在当前上下文中，无法编辑')
      }
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
        ? { text }
        : { sourceText: text, projectionText: text }
      if (located) patch.bodyEdit = { formatVersion: 4, id: 'tavern-body-edit:' + randomUUID(), seq: located.seq, turn: located.turn, role: floor.role }
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
      if (located) {
        const preview = agent.session.constructor.fromRestore(agent.session.id, structuredClone(sessionEvents(agent.session)), structuredClone(agent.session.header), agent.session.inheritedEventCount, 'detached')
        await synchronizeBodyEdits(preview, { messages: [{ ...floor.message, ...patch }] }, async () => {})
      }
      const saved = await saveFloorPatch({
        chat, index: floor.index, message: floor.message, seq: located?.seq ?? null,
        intent: floor.latest ? intent : { ...intent, index: floor.index },
        detachedIntent: floor.latest ? intent : { ...intent, index: 0 },
        reason: '模型上下文已变化，请重新打开编辑', source: 'foreground.body-edit'
      }, { chats, sessions, timeline, agent })
      if (saved !== undefined) {
        if (!located) await repairNative(sessionId, agent.session)
        return present(saved)
      }
      const next = await chats.update(chat.id, current => {
        guards.assertIdle(current, agent, '编辑')
        const currentFloor = resolveFloor(current, input)
        if (floorToken(current, currentFloor.message) !== input.token) throw new Error('正文或会话已变化，请重新打开编辑')
        if (located && !agent.session.surface?.nodes.includes(located.seq)) throw new Error('模型上下文已变化，请重新打开编辑')
        return timeline.apply({ chat: current, intent: floor.latest ? intent : { ...intent, index: currentFloor.index } }).chat
      }, { source: 'foreground.body-edit' })
      if (located) await synchronizeBodyEdits(agent.session, next, sessions.flush)
      else await repairNative(sessionId, agent.session)
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
