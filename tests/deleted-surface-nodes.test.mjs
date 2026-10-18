import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { deletedSurfaceSeqs } from '../tavern-plugin/lib/domain/deleted-surface-nodes.js'

// 宿主聊天页只渲染 append 来源的节点：删除写出的标记是替换副本，页面上原节点照旧显示。
// deletedSurfaceSeqs 告诉页面哪些 append 来源已经被删除标记顶替，好把它藏起来。
function fixture() {
  const session = Session.create('deleted-surface-nodes')
  const input = (id, text) => appendSessionEvent(session, 'user/message',
    { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const reply = (id, turn, text) => appendSessionEvent(session, 'assistant/message',
    { turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } },
    { surfaceOp: 'append', sourceEventSeqs: [] })
  input('in:1', '一'); reply('re:1', 1, '甲')
  input('in:2', '二'); reply('re:2', 2, '乙')
  return session
}
const seqOf = (session, id) => sessionEvents(session).find(event => event.data?.id === id || event.data?.message?.id === id).seq
const marker = id => ({ id, role: 'user', content: [], source: { kind: 'plugin', plugin: 'dsh-tavern-deletion' } })
function replace(session, type, data, seq) {
  replaceSessionSurface(session, type, data, { start: seq, end: seq, sourceEventSeqs: [seq] })
  return sessionEvents(session).at(-1).seq
}

test('删除标记顶替的节点按页面上的原始 seq 报出', () => {
  const session = fixture()
  const target = seqOf(session, 'in:2')
  replace(session, 'user/message', marker('tavern-message-delete:1'), target)
  assert.deepEqual(deletedSurfaceSeqs(session), [target])
})

test('先编辑再删除：沿替换链报出最早 append 的那个 seq', () => {
  const session = fixture()
  const origin = seqOf(session, 'in:1')
  const edited = replace(session, 'user/message', { id: 'tavern-body-edit:1', role: 'user', content: [{ type: 'text', text: '改过的一' }], source: { kind: 'user' } }, origin)
  replace(session, 'user/message', marker('tavern-message-delete:2'), edited)
  assert.deepEqual(deletedSurfaceSeqs(session), [origin])
})

test('撤销删除后节点重新显示', () => {
  const session = fixture()
  const target = seqOf(session, 're:1')
  const original = sessionEvents(session).find(event => event.seq === target)
  const markerSeq = replace(session, 'user/message', marker('tavern-message-delete:3'), target)
  assert.deepEqual(deletedSurfaceSeqs(session), [target])
  replace(session, original.type, structuredClone(original.data), markerSeq)
  assert.deepEqual(deletedSurfaceSeqs(session), [])
})

test('正文编辑不算删除', () => {
  const session = fixture()
  replace(session, 'user/message', { id: 'tavern-body-edit:2', role: 'user', content: [{ type: 'text', text: '改' }], source: { kind: 'user' } }, seqOf(session, 'in:2'))
  assert.deepEqual(deletedSurfaceSeqs(session), [])
})
