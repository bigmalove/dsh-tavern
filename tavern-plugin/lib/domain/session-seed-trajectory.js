import { ensureSessionSystemHead, sessionEvents, appendSessionEvent } from './session-events.js'

// Play keeps v1 forever: its ids and exact wording are part of existing saves.
// Writing mode owns v2 with an author-facing contract instead of a stage direction.
const VARIANTS = Object.freeze({
  play: Object.freeze({
    version: 1,
    text: Object.freeze([
      `我们正在共同创作一部持续发展的沉浸式虚构小说。
人物卡、世界书、已有正文和现场状态构成故事事实；我之后发送的消息是“本轮演出指引”，不是已经发生的正文。
请承接现场，用自己的叙述完整演出其核心意图。所有角色都由你叙述和扮演，并保持符合人设的独立意志。
只输出小说正文，不要解释、点评、复述规则或输出元信息。`,
      '明白。后续我会把人物卡、世界书和已有正文视为连续的故事世界，把最新消息视为本轮演出指引，并将其重新组织成完整场景。人物会依照自身性格行动和回应。我只输出小说正文。',
      '开始。请从人物卡给定的开场继续。'
    ])
  }),
  writing: Object.freeze({
    version: 2,
    text: Object.freeze([
      `我们正在合作创作一部长篇小说。
没有人物卡，也没有世界书：已有正文就是全部的故事事实。我是作者，不扮演故事中的任何角色；我发送的消息是写作指令——续写、改写、扩写或调整写法，不是小说正文，也不代表任何角色在故事里的言行。
故事中的所有人物、对白、动作和心理都由你叙述和描写。请按我的指令写作，并保持与已有正文一致。
只输出小说正文，不要解释、点评、复述规则或输出元信息。`,
      '明白。我会把已有正文当作已经完成的作品，把你的消息当作写作指令来执行：该续写就承接推进，该改写就真正重写。故事里的人物、对白、动作和心理都由我描写，我只输出小说正文。',
      '开始。请按我的写作指令开始写作。'
    ])
  })
})

const pending = new WeakMap()

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

function variantOf(mode) {
  return mode === 'writing' ? VARIANTS.writing : VARIANTS.play
}

function id(sessionId, index, version) {
  return 'tavern-seed-trajectory:v' + version + ':' + str(sessionId) + ':' + (index + 1)
}

function userMessage(sessionId, index, texts, version) {
  return {
    id: id(sessionId, index, version),
    role: 'user',
    content: [{ type: 'text', text: texts[index] }],
    source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'synthetic-trajectory', version: version }
  }
}

function assistantMessage(sessionId, index, texts, version) {
  return {
    id: id(sessionId, index, version),
    role: 'assistant',
    content: [{ type: 'text', text: texts[index] }],
    source: { kind: 'model', provider: 'dsh-tavern', model: 'synthetic-trajectory', version: version }
  }
}

export function sessionSeedTrajectoryMessages(sessionId, mode) {
  const variant = variantOf(mode)
  const texts = variant.text
  const userOne = userMessage(sessionId, 0, texts, variant.version)
  const assistant = assistantMessage(sessionId, 1, texts, variant.version)
  const userTwo = userMessage(sessionId, 2, texts, variant.version)
  return Object.freeze([
    Object.freeze({ text: texts[0], type: 'user/message', data: userOne, intent: { surfaceOp: 'append' } }),
    Object.freeze({ text: texts[1], type: 'assistant/message', data: {
      turn: 0, step: 1, message: assistant
    }, intent: { surfaceOp: 'append', sourceEventSeqs: [] } }),
    Object.freeze({ text: texts[2], type: 'user/message', data: userTwo, intent: { surfaceOp: 'append' } })
  ])
}

function messageId(event) {
  if (event && event.type === 'user/message') return str(event.data && event.data.id)
  if (event && event.type === 'assistant/message') return str(event.data && event.data.message && event.data.message.id)
  return ''
}

function visibleEvents(session) {
  return sessionEvents(session).filter(event => event && event.type !== 'session/end-seed')
}

function ensure(session, mode) {
  if (!session || typeof session.append !== 'function' || str(session.id) === '') throw new Error('无法写入 Session 种子轨迹')
  ensureSessionSystemHead(session)
  const stages = sessionSeedTrajectoryMessages(session.id, mode)
  const expectedIds = stages.map((_, index) => id(session.id, index, variantOf(mode).version))
  const events = visibleEvents(session)
  const start = events.findIndex(event => messageId(event) === expectedIds[0])
  const stray = events.findIndex(event => expectedIds.includes(messageId(event)))
  if (start < 0 && stray >= 0) throw new Error('Session 种子轨迹顺序无效')

  const offset = start < 0 ? events.length : start
  let matched = 0
  while (matched < stages.length && messageId(events[offset + matched]) === expectedIds[matched]) matched += 1
  if (start >= 0 && matched < stages.length && offset + matched < events.length) {
    throw new Error('Session 种子轨迹不完整且已被其他操作推进')
  }

  for (let index = matched; index < stages.length; index += 1) {
    const stage = stages[index]
    appendSessionEvent(session, stage.type, stage.data, stage.intent)
  }
  const complete = visibleEvents(session).slice(offset, offset + stages.length)
  if (complete.length !== stages.length || complete.some((event, index) => messageId(event) !== expectedIds[index])) {
    throw new Error('Session 种子轨迹写入不完整')
  }
  return Object.freeze({ version: variantOf(mode).version, events: Object.freeze(complete.slice()) })
}

export async function ensureSessionSeedTrajectory(session, mode) {
  if (pending.has(session)) return pending.get(session)
  const operation = Promise.resolve().then(function () { return ensure(session, mode) })
  pending.set(session, operation)
  try { return await operation } finally { pending.delete(session) }
}
