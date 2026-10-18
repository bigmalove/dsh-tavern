import assert from 'node:assert/strict'
import test from 'node:test'
import { carriedFloors } from '../tavern-plugin/lib/domain/carried-floors.js'
import { floorsIndex } from '../tavern-plugin/lib/domain/conversation-fork-targets.js'
import { projectChatSessionState } from '../tavern-plugin/lib/domain/chat-session-state.js'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'

function fixture() {
  const session = Session.create('floors-test')
  appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'opening', role: 'assistant', content: [{ type: 'text', text: '开场白' }], source: { kind: 'model', provider: 'dsh-tavern', model: 'character-card' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'user/message', { id: 'u2', turn: 2, role: 'user', content: [{ type: 'text', text: '推门' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: '版本二' }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const chat = {
    id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 5,
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 7, checkpoints: [], participants: {}, operations: {}, updatedAt: 0 },
    messages: [
      { role: 'assistant', turn: 1, greeting: true, text: '开场白', sourceText: '开场白', swipes: ['开场白', '备选开场白'], swipeId: 0 },
      { role: 'user', turn: 2, text: '推门' },
      { role: 'assistant', turn: 2, text: '版本二', sourceText: '版本二', swipes: ['版本一', '版本二'], swipeId: 1 }
    ]
  }
  return { session, chat }
}

// 这条测试记录的是「为什么需要 carry」：缓存命中那条路的 Chat 是裁剪投影，
// 拿它算楼层，版本数退化成 1、token 也与真实楼层对不上。
test('会话状态投影算不出楼层事实：版本数退化成 1，token 与完整 Chat 不一致', () => {
  const { session, chat } = fixture()
  const complete = floorsIndex(chat, session, { busy: false })
  assert.equal(complete.byMessageId.a2.swipeCount, 2)
  assert.equal(complete.byMessageId.a2.swipeId, 1)

  const slim = projectChatSessionState(chat)
  assert.equal(slim.messages[2].text, undefined, '裁剪投影不带正文')
  const degraded = floorsIndex(slim, session, { busy: false })
  assert.equal(degraded.byMessageId.a2.swipeCount, 1)
  assert.notEqual(degraded.byMessageId.a2.token, complete.byMessageId.a2.token)
})

test('carry 原样保留 index / turn / token / 版本数，两张索引指向同一个楼层对象', () => {
  const { session, chat } = fixture()
  const previous = (() => {
    const floors = floorsIndex(chat, session, { busy: false })
    return { floorsByMessageId: floors.byMessageId, floorsBySeq: floors.bySeq }
  })()
  const carried = carriedFloors(previous, { busy: false })
  assert.deepEqual(carried.floorsByMessageId, previous.floorsByMessageId)
  // 同一楼在两张索引里必须是同一个对象：客户端按 seq 查（玩家输入）和按 id 查
  // （助手正文）拿到的坐标不能分叉。
  const byIndex = new Map(Object.values(carried.floorsByMessageId).map(floor => [floor.index, floor]))
  for (const floor of Object.values(carried.floorsBySeq)) assert.equal(floor, byIndex.get(floor.index))
})

test('carry 只改忙碌态：结算期间全部禁用，结算结束恢复可编辑', () => {
  const { session, chat } = fixture()
  const idle = floorsIndex(chat, session, { busy: false })
  const previous = { floorsByMessageId: idle.byMessageId, floorsBySeq: idle.bySeq }

  const busy = carriedFloors(previous, { busy: true })
  assert.equal(busy.floorsByMessageId.a2.editable, false)
  assert.equal(busy.floorsByMessageId.a2.reason, '请等待当前生成或后台处理完成后再操作')
  assert.equal(busy.floorsByMessageId.a2.token, idle.byMessageId.a2.token, '忙碌不改 token')
  assert.equal(busy.floorsByMessageId.a2.index, idle.byMessageId.a2.index)

  const back = carriedFloors({ floorsByMessageId: busy.floorsByMessageId, floorsBySeq: busy.floorsBySeq }, { busy: false })
  assert.equal(back.floorsByMessageId.a2.editable, true)
  assert.equal(back.floorsByMessageId.a2.reason, '')
})

test('上一份视图没有楼层表时返回空对象，调用方保留自己的字段', () => {
  assert.deepEqual(carriedFloors(null, { busy: false }), {})
  assert.deepEqual(carriedFloors({}, { busy: false }), {})
  assert.deepEqual(carriedFloors({ floorsByMessageId: 'nope' }, { busy: false }), {})
})

// 回归：楼层表照搬一旦用到增量投影上，index/turn/token 会停在旧值，
// 编辑面板就会带着旧坐标去定位——要么打到别的楼层，要么报「这一楼已不在当前上下文中」。
test('回归：正文变化后按完整消息行重算，楼层事实必须跟着变', () => {
  const { session, chat } = fixture()
  const before = floorsIndex(chat, session, { busy: false })

  const edited = { ...chat, messages: chat.messages.map((message, index) =>
    index === 2 ? { ...message, text: '改过的正文', sourceText: '改过的正文', swipes: ['版本一', '改过的正文'] } : message) }
  const after = floorsIndex(edited, session, { busy: false })

  assert.notEqual(after.byMessageId.a2.token, before.byMessageId.a2.token, '正文变了 token 必须变')
  assert.equal(carriedFloors({ floorsByMessageId: before.byMessageId, floorsBySeq: before.bySeq }, { busy: false })
    .floorsByMessageId.a2.token, before.byMessageId.a2.token, 'carry 按设计就是停在旧 token 上')
})
