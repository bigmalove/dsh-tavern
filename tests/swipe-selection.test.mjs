import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { createSwipeSelection } from '../tavern-plugin/lib/domain/swipe-selection.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { floorsByMessageId } from '../tavern-plugin/lib/domain/conversation-fork-targets.js'
import { floorToken, locateFloor } from '../tavern-plugin/lib/domain/floor-location.js'
import { lastTavernHelperVariables } from '../tavern-plugin/lib/domain/tavern-helper-context.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { swipeCount, selectedSwipe, appendSwipe, removeSwipe, insertSwipe, swipeSource, withSwipeState } from '../tavern-plugin/lib/domain/swipe-versions.js'
import { replaceLastRound } from '../tavern-plugin/lib/domain/last-round-replacement.js'

function opening(session, text) {
  appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'opening', role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'dsh-tavern', model: 'character-card' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

function round(session, turn, userText, bodyText) {
  appendSessionEvent(session, 'user/message', { id: 'u' + turn, turn, role: 'user', content: [{ type: 'text', text: userText }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: bodyText }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

// A committed story: greeting (two card openings), an older round with two
// versions, and the latest round whose selected version never settled.
function fixture({ greeting = true, compactTurn = 0 } = {}) {
  let session = Session.create('swipe-test')
  if (greeting) opening(session, '备选开场白')
  round(session, 2, '推门', '版本二')
  round(session, 3, '继续', '第三轮版本B')
  if (compactTurn > 0) {
    const kept = sessionEvents(session)
      .filter(event => !(event.type === 'assistant/message' && Number(event.data?.turn) === compactTurn))
      .map((event, index) => ({ ...event, seq: index }))
    session = Session.create(session.id, kept, session.header)
  }
  let chat = {
    id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 5,
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 7, checkpoints: [], participants: {}, operations: {}, updatedAt: 0 },
    posture: '', settleStatus: 'idle', variables: { hp: 31 },
    messages: greeting ? [
      { role: 'assistant', greeting: true, turn: 1, text: '备选开场白', sourceText: '备选开场白', swipes: ['开场白', '备选开场白'], swipeId: 1, variables: [{ day: 1 }, { day: 2 }] },
      { role: 'user', text: '推门' },
      { role: 'assistant', turn: 2, text: '版本二', sourceText: '版本二', swipes: ['版本一', '版本二'], swipeId: 1, variables: [{ hp: 1 }, { hp: 2 }], swipeStates: [null, null] },
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 3, text: '第三轮版本B', sourceText: '第三轮版本B', swipes: ['第三轮版本A', '第三轮版本B'], swipeId: 1, variables: [{ hp: 30 }, { hp: 31 }], swipeStates: [{ posture: '版本A的姿势', ledger: null, lastSettle: null, settleStatus: 'done' }, null] }
    ] : [
      { role: 'user', text: '推门' },
      { role: 'assistant', turn: 2, text: '版本二', sourceText: '版本二', swipes: ['版本一', '版本二'], swipeId: 1, variables: [{ hp: 1 }, { hp: 2 }], swipeStates: [null, null] },
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 3, text: '第三轮版本B', sourceText: '第三轮版本B', swipes: ['第三轮版本A', '第三轮版本B'], swipeId: 1, variables: [{ hp: 30 }, { hp: 31 }], swipeStates: [{ posture: '版本A的姿势', ledger: null, lastSettle: null, settleStatus: 'done' }, null] }
    ]
  }
  const agent = { get session() { return session }, phase: { kind: 'idle', lastTurn: 3 } }
  const settled = []
  const dispatched = []
  let busy = false
  const options = {
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => {} },
    timeline: createStoryTimeline({ id: prefix => prefix + '-fixed', now: () => 5 }),
    activity: () => ({ busy }),
    project: async text => projectReplyLayers(text),
    present: async value => structuredClone(value),
    queueSettlement: async id => { settled.push(id) },
    scripts: { dispatchEvent: async event => { dispatched.push(event) } }
  }
  const latestIndex = greeting ? 4 : 3
  return {
    swipe: createSwipeSelection(options), options,
    get chat() { return chat }, get session() { return session }, agent,
    latestIndex, floors() { return floorsByMessageId(chat, session, { busy }) },
    settled, dispatched,
    busy(value) { busy = value }
  }
}

function floorOf(h, messageId) {
  const floor = h.floors()[messageId]
  assert.ok(floor, '楼层映射缺少 ' + messageId)
  return floor
}

test('切换最新楼层到已结算版本：文字、变量、结算一起恢复，不排队结算', async () => {
  const h = fixture()
  const floor = floorOf(h, 'a3')
  assert.equal(floor.latest, true)
  assert.equal(floor.swipeId, 1)
  assert.equal(floor.swipeCount, 2)
  const before = structuredClone(h.chat)
  const view = await h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 0, token: floor.token })
  assert.equal(view.messages.at(-1).text, '第三轮版本A')
  assert.equal(view.messages.at(-1).swipeId, 0)
  assert.equal(view.posture, '版本A的姿势')
  assert.equal(view.settleStatus, 'done')
  assert.deepEqual(h.settled, [])
  // 切走的是尚未结算的版本：头部没有可保留的结算，快照保持为空。
  assert.deepEqual(h.chat.messages.at(-1).swipeStates, [
    { posture: '版本A的姿势', ledger: null, lastSettle: null, settleStatus: 'done' },
    null
  ])
  assert.equal(h.chat.timeline.revision, 8)
  assert.match(h.chat.messages.at(-1).bodyEdit.id, /^tavern-swipe:/)
  assert.equal(h.session.deriveMessages().at(-1).content[0].text, '第三轮版本A')
  // 变量读取按选中版本走（read-variables 的路径）。
  assert.deepEqual(h.chat.messages.at(-1).variables[0], { hp: 30 })
  assert.notDeepEqual(h.chat.messages, before.messages)
})

test('切回未结算版本：清空结算并排队，旧楼层的变量与姿势不动', async () => {
  const h = fixture()
  const settledFloor = floorOf(h, 'a3')
  await h.swipe.select(h.session.id, { index: settledFloor.index, turn: settledFloor.turn, swipeId: 0, token: settledFloor.token })
  // 切换后这一楼的消息 id 换成替换事件的 id（与正文编辑同一机制）。
  const floor = h.floors()[h.chat.messages.at(-1).bodyEdit.id]
  assert.ok(floor, '切换后楼层映射应覆盖新的消息 id')
  const view = await h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 1, token: floor.token })
  assert.equal(view.messages.at(-1).text, '第三轮版本B')
  assert.equal(view.posture, '')
  assert.equal(view.settleStatus, 'idle')
  assert.deepEqual(h.settled, ['chat'])
  assert.deepEqual(h.chat.messages.at(-1).swipeStates, [
    { posture: '版本A的姿势', ledger: null, lastSettle: null, settleStatus: 'done' },
    null
  ])
  // 旧楼层（第 2 轮）的版本与变量没有被这次切换碰过。
  assert.equal(h.chat.messages[2].swipeId, 1)
  assert.deepEqual(h.chat.messages[2].variables, [{ hp: 1 }, { hp: 2 }])
  assert.deepEqual(h.chat.variables, { hp: 31 })
})

test('切换旧楼层只换这一楼的文字，当前变量与姿势不动', async () => {
  const h = fixture()
  const floor = floorOf(h, 'a2')
  assert.equal(floor.latest, false)
  const before = structuredClone(h.chat)
  const view = await h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 0, token: floor.token })
  assert.equal(view.messages[2].text, '版本一')
  assert.equal(view.messages[2].swipeId, 0)
  assert.equal(view.posture, '')
  assert.equal(view.settleStatus, 'idle')
  assert.deepEqual(h.settled, [])
  // 最新楼层的文字、变量、姿势原样。
  assert.equal(h.chat.messages.at(-1).text, '第三轮版本B')
  assert.equal(h.chat.posture, '')
  assert.deepEqual(h.chat.variables, { hp: 31 })
  assert.equal(h.chat.timeline.revision, 8)
  // 模型消息面上只有这一楼的节点被替换。
  const texts = h.session.deriveMessages().map(message => message.content[0].text)
  assert.deepEqual(texts, ['备选开场白', '推门', '版本一', '继续', '第三轮版本B'])
  assert.notDeepEqual(h.chat.messages[2], before.messages[2])
  assert.deepEqual(h.chat.messages.at(-1), before.messages.at(-1))
})

test('开场白切换：开局前换文字与各版本初始变量，开局后只换文字', async () => {
  const h = fixture()
  const floor = floorOf(h, 'opening')
  assert.equal(floor.greeting, true)
  assert.equal(floor.swipeCount, 2)
  const view = await h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 0, token: floor.token })
  assert.equal(view.messages[0].text, '开场白')
  assert.equal(view.messages[0].swipeId, 0)
  assert.deepEqual(view.messages[0].variables, [{ day: 1 }, { day: 2 }])
  assert.equal(view.messages[2].text, '版本二')
  assert.deepEqual(h.settled, [])
  assert.deepEqual(h.session.deriveMessages().map(message => message.content[0].text), ['开场白', '推门', '版本二', '继续', '第三轮版本B'])
})

test('开局前切换无 turn 的旧开场白，选中变量同步且不重跑脚本或结算', async () => {
  const h = fixture()
  h.chat.messages.splice(1)
  delete h.chat.messages[0].turn
  const floors = h.floors()
  const floor = floors.opening
  assert.equal(floor.turn, 1)
  const view = await h.swipe.select(h.session.id, { index: 0, turn: 1, swipeId: 0, token: floor.token })
  assert.equal(view.openingText, '开场白')
  assert.deepEqual(lastTavernHelperVariables(view.messages), { day: 1 })
  assert.equal(h.session.deriveMessages()[0].content[0].text, '开场白')
  assert.deepEqual(h.settled, [])
})

test('旧开场白缺少备选变量时仅开局前调用初始变量准备', async () => {
  const h = fixture()
  h.chat.messages.splice(1)
  h.chat.mvu = { enabled: true }
  h.chat.messages[0].variables[0] = {}
  const prepared = []
  const swipe = createSwipeSelection({ ...h.options, initializeOpeningVariables: async (_chat, swipeId) => {
    prepared.push(swipeId)
    return { stat_data: { day: 8 }, schema: {}, initialized_lorebooks: {} }
  } })
  const floor = floorOf(h, 'opening')
  const view = await swipe.select(h.session.id, { index: 0, turn: 1, swipeId: 0, token: floor.token })
  assert.deepEqual(prepared, [0])
  assert.deepEqual(lastTavernHelperVariables(view.messages).stat_data, { day: 8 })
  assert.equal(view.messages[0].variables[1].day, 2)
  assert.deepEqual(h.settled, [])
})

test('切旧楼不捕获当前楼结算，也不清空候选项或重置后台参与者', async () => {
  const h = fixture()
  h.chat.settleStatus = 'done'
  h.chat.posture = '当前姿势'
  h.chat.candidateAgent = { sessionId: 'candidate' }
  h.chat.candidates = ['继续走']
  h.chat.timeline.participants.background = { role: 'background', lifetime: 'chat', sessionId: 'bg', status: 'ready', boundary: 4 }
  const before = structuredClone(h.chat)
  const floor = floorOf(h, 'a2')
  await h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 0, token: floor.token })
  assert.deepEqual(h.chat.messages[2].swipeStates, [null, null])
  assert.deepEqual(h.chat.timeline.participants, before.timeline.participants)
  assert.deepEqual(h.chat.candidateAgent, before.candidateAgent)
  assert.deepEqual(h.chat.candidates, before.candidates)
  assert.equal(h.chat.posture, '当前姿势')
})

test('失败结算版本切回会重排结算，同版本请求不会改 revision', async () => {
  const h = fixture()
  h.chat.messages.at(-1).swipeStates[0].settleStatus = 'failed'
  const floor = floorOf(h, 'a3')
  await h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 0, token: floor.token })
  assert.deepEqual(h.settled, ['chat'])
  assert.equal(h.chat.settleStatus, 'idle')
  const revision = h.chat.timeline.revision
  const updated = h.floors()[h.chat.messages.at(-1).bodyEdit.id]
  await h.swipe.select(h.session.id, { index: updated.index, turn: updated.turn, swipeId: 0, token: updated.token })
  assert.equal(h.chat.timeline.revision, revision)
  assert.equal(h.dispatched.length, 1)
})

test('压缩只改变 Surface、不删事件时，楼层控件仍从映射中移除', () => {
  const h = fixture()
  const seq = locateFloor({ chat: h.chat, session: h.session, index: 2, turn: 2 }).seq
  h.session.surface.nodes.splice(h.session.surface.nodes.indexOf(seq), 1)
  assert.equal(h.floors().a2, undefined)
})

test('被压缩的楼层拒绝切换且不写入', async () => {
  const h = fixture({ compactTurn: 2 })
  // 压缩后这一楼已不在模型消息面里：客户端拿不到可操作的楼层条目，
  // 服务端对直接请求同样拒绝。
  assert.equal(h.floors().a2, undefined)
  const before = structuredClone(h.chat)
  await assert.rejects(h.swipe.select(h.session.id, { index: 2, turn: 2, swipeId: 0, token: floorToken(h.chat, h.chat.messages[2]) }), /不在当前模型上下文/)
  assert.deepEqual(h.chat, before)
  assert.equal(h.chat.timeline.revision, 7)
  assert.deepEqual(h.settled, [])
})

test('忙碌、MVU 待提交与过期 token 都拒绝且不写入', async () => {
  const h = fixture()
  const floor = floorOf(h, 'a3')
  h.busy(true)
  await assert.rejects(h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 0, token: floor.token }), /等待/)
  h.busy(false)
  h.agent.phase.kind = 'running'
  await assert.rejects(h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 0, token: floor.token }), /等待/)
  h.agent.phase.kind = 'idle'
  await assert.rejects(h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 0, token: 'stale' }), /已变化/)
  // 楼层本身变化后 token 失效；别处追加消息不影响。
  h.change = fn => fn(h.chat)
  h.change(chat => { chat.messages.at(-1).text = '别处改过' })
  await assert.rejects(h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 0, token: floor.token }), /已变化/)
  h.change(chat => { chat.messages.push({ role: 'user', text: '下一轮' }) })
  const stillValid = floorOf(h, 'a3')
  await h.swipe.select(h.session.id, { index: stillValid.index, turn: stillValid.turn, swipeId: 0, token: stillValid.token })
  // MVU 变量更新在途时拒绝切换最新楼层。
  const mvu = fixture()
  const mvuFloor = floorOf(mvu, 'a3')
  mvu.chat.messages.at(-1).mvu = { pending: true, pendingSubmission: { commands: [] } }
  await assert.rejects(mvu.swipe.select(mvu.session.id, { index: mvuFloor.index, turn: mvuFloor.turn, swipeId: 0, token: mvuFloor.token }), /变量更新尚未完成/)
  assert.equal(mvu.chat.messages.at(-1).swipeId, 1)
})

test('重新生成后的 Surface 使用剧情 turn 时，仍保留楼层映射', () => {
  const h = fixture()
  h.chat.regeneratedDshTurns = { 3: 8 }
  assert.equal(h.floors().a3.index, h.latestIndex)
})

test('切换成功后通知人物卡脚本 MESSAGE_SWIPED（Helper 消息下标）', async () => {
  const h = fixture()
  const floor = floorOf(h, 'a2')
  await h.swipe.select(h.session.id, { index: floor.index, turn: floor.turn, swipeId: 0, token: floor.token })
  assert.deepEqual(h.dispatched.map(event => event.name), ['MESSAGE_SWIPED'])
  assert.deepEqual(h.dispatched[0].args, [2])
})

test('楼层映射覆盖助手、玩家与开场白，窗口外楼层没有条目', async () => {
  const h = fixture()
  const floors = h.floors()
  assert.deepEqual(Object.keys(floors).sort(), ['a2', 'a3', 'opening', 'u2', 'u3'])
  assert.equal(floors.u2.role, 'user')
  assert.equal(floors.u2.turn, 2)
  assert.equal(floors.u2.index, 1)
  assert.equal(floors.u3.latest, false)
  assert.equal(floors.a3.latest, true)
  assert.equal(floors.a2.swipeCount, 2)
  assert.equal(floors.opening.greeting, true)
  assert.equal(floors.opening.swipeId, 1)
  for (const floor of Object.values(floors)) {
    assert.equal(floor.editable, true)
    assert.equal(floor.reason, '')
    assert.match(floor.token, /^[0-9a-f]{64}$/)
  }
  h.busy(true)
  const busyFloors = h.floors()
  assert.equal(busyFloors.a3.editable, false)
  assert.match(busyFloors.a3.reason, /等待/)
})

test('纯函数：追加、删除、插入版本时三个数组始终对齐', () => {
  const legacy = { role: 'assistant', turn: 2, text: '旧正文', sourceText: '旧正文' }
  assert.equal(swipeCount(legacy), 1)
  assert.equal(selectedSwipe(legacy), 0)
  assert.equal(swipeSource(legacy, 0), '旧正文')
  const first = appendSwipe(legacy, { source: '新正文' })
  assert.deepEqual(first.swipes, ['旧正文', '新正文'])
  assert.equal(first.swipeId, 1)
  assert.equal(first.variables, undefined)
  assert.equal(first.swipeStates, undefined)

  const message = { role: 'assistant', turn: 3, swipes: ['甲', '乙', '丙'], swipeId: 1, variables: [{ a: 1 }, { a: 2 }, { a: 3 }], swipeStates: [null, { settleStatus: 'done' }, null] }
  const grown = appendSwipe(message, { source: '丁', variables: { a: 4 }, state: null })
  assert.deepEqual(grown.swipes, ['甲', '乙', '丙', '丁'])
  assert.deepEqual(grown.variables, [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }])
  assert.deepEqual(grown.swipeStates, [null, { settleStatus: 'done' }, null, null])
  assert.equal(grown.swipeId, 3)
  assert.deepEqual(message.swipes, ['甲', '乙', '丙'], '原消息不被修改')

  const droppedCurrent = removeSwipe(grown, 3)
  assert.deepEqual(droppedCurrent.removed, { swipeId: 3, source: '丁', variables: { a: 4 }, state: null, wasSelected: true })
  assert.deepEqual(droppedCurrent.message.swipes, ['甲', '乙', '丙'])
  assert.equal(droppedCurrent.message.swipeId, 2)
  assert.deepEqual(droppedCurrent.message.variables, [{ a: 1 }, { a: 2 }, { a: 3 }])
  const droppedOther = removeSwipe(grown, 0)
  assert.equal(droppedOther.removed.wasSelected, false)
  assert.equal(droppedOther.message.swipeId, 2)
  assert.deepEqual(droppedOther.message.swipes, ['乙', '丙', '丁'])
  assert.deepEqual(droppedOther.message.swipeStates, [{ settleStatus: 'done' }, null, null])
  const restored = insertSwipe(droppedOther.message, 0, droppedOther.removed)
  assert.deepEqual(restored.swipes, ['甲', '乙', '丙', '丁'])
  assert.deepEqual(restored.variables, [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }])
  assert.equal(restored.swipeId, 2)

  const snapshotted = withSwipeState(message, 0, { settleStatus: 'done' })
  assert.deepEqual(snapshotted.swipeStates, [{ settleStatus: 'done' }, { settleStatus: 'done' }, null])
  assert.equal(message.swipeStates[0], null, '原消息不被修改')
})

test('replaceLastRound 为旧版本保留结算快照并追加新版本', () => {
  const originalUser = { role: 'user', text: '推门' }
  const originalAssistant = { role: 'assistant', turn: 2, text: '版本一', sourceText: '版本一', swipes: ['版本一'], swipeId: 0, variables: [{ hp: 1 }] }
  const regeneratedAssistant = { role: 'assistant', turn: 9, text: '版本二', sourceText: '版本二', swipes: ['版本二'], swipeId: 0, variables: [{ hp: 2 }] }
  const merged = replaceLastRound({
    originalChat: { posture: '门内', ledger: null, lastSettle: null, settleStatus: 'done', messages: [originalUser, originalAssistant] },
    regeneratedChat: { messages: [{ role: 'user', text: '推门' }, regeneratedAssistant] },
    assistantIndex: 1,
    originalState: { posture: '门内', ledger: null, lastSettle: null, settleStatus: 'done' }
  })
  assert.deepEqual(merged.assistant.swipes, ['版本一', '版本二'])
  assert.equal(merged.assistant.swipeId, 1)
  assert.deepEqual(merged.assistant.variables, [{ hp: 1 }, { hp: 2 }])
  assert.deepEqual(merged.assistant.swipeStates, [
    { posture: '门内', ledger: null, lastSettle: null, settleStatus: 'done' },
    null
  ])
  assert.equal(merged.assistant.bodyEdit, undefined)
  assert.equal(merged.chat.messages.length, 2)
})
