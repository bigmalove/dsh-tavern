import assert from 'node:assert/strict'
import test from 'node:test'
import { capturePluginGeneration, pluginGenerationEvidence } from '../tavern-plugin/lib/domain/plugin-generations.js'
import { createPluginTurnReader } from '../tavern-plugin/lib/domain/plugin-turns.js'

function fixture({ kind = 'player', nativeTurn = 5 } = {}) {
  const input = { seq: 11, type: 'user/message', data: { id: 'input-1', role: 'user', source: kind === 'regenerate' ? { kind: 'plugin', plugin: 'dsh-tavern-regen' } : { kind: 'user', rpcId: 'rpc-1' } } }
  const events = [{ seq: 10, type: 'turn/start', data: { turn: nativeTurn } }, input]
  const session = { id: 'game-1', snapshotEvents: () => events }
  const generation = capturePluginGeneration(session)
  const row = { role: 'assistant', turn: nativeTurn, sourceText: '正文原文。', text: '正文原文。', nativeAnchor: { turn: nativeTurn, input: 11, reply: 12 } }
  const header = { settleStatus: 'done', regeneratedDshTurns: {} }
  const reader = createPluginTurnReader({
    sessionFor: async () => session,
    sessionState: async () => ({ id: 'chat-1', sessionId: session.id, mode: 'story', messages: [row] }),
    header: async () => header,
    sceneState: async () => ({ mode: 'story', sceneTargets: { [row.turn]: { key: 'key-1', sourceDigest: 'd', source: row.sourceText, turn: row.turn } } }),
    slice: async () => ({ chat: { messages: [row] } })
  })
  function finish(reason = 'completed') {
    events.push({ seq: 12, type: 'assistant/message', data: { turn: nativeTurn, message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '正文原文。' }] } } },
      { seq: 13, type: 'turn/end', data: { turn: nativeTurn, reason: { kind: reason } } })
  }
  return { reader, session, events, generation, row, header, finish }
}

test('生成身份：生成中捕获，未完成不解析，完成后按原生锚点解析', async () => {
  const f = fixture()
  assert.match(f.generation.generationId, /^[a-f0-9]{64}$/)
  assert.equal(await f.reader.resolveGeneration('game-1', f.generation.generationId), null)
  f.finish()
  assert.equal(capturePluginGeneration(f.session), null)
  const material = await f.reader.resolveGeneration('game-1', f.generation.generationId)
  assert.equal(material.turn, 5)
  assert.equal(material.key, 'key-1')
  assert.equal(pluginGenerationEvidence(f.session, f.generation.generationId).input.seq, 11)
})

test('生成身份：重启使用相同事件可恢复，不依赖内存注册表', () => {
  const f = fixture()
  f.finish()
  const restored = { id: f.session.id, events: structuredClone(f.events) }
  assert.equal(pluginGenerationEvidence(restored, f.generation.generationId).turn, 5)
  assert.equal(pluginGenerationEvidence({ ...restored, id: 'another-game' }, f.generation.generationId), null)
})

for (const reason of ['error', 'aborted']) test('生成身份：' + reason + ' 后下一轮不会接管视频', async () => {
  const f = fixture()
  f.finish(reason)
  f.events.push({ seq: 14, type: 'turn/start', data: { turn: 6 } }, { seq: 15, type: 'user/message', data: { id: 'next-input', source: { kind: 'user' } } })
  assert.notEqual(capturePluginGeneration(f.session).generationId, f.generation.generationId)
  assert.equal(await f.reader.resolveGeneration('game-1', f.generation.generationId), null)
})

test('生成身份：重生成只在采用映射完成后解析到旧楼层', async () => {
  const f = fixture({ kind: 'regenerate', nativeTurn: 9 })
  f.finish()
  assert.equal(await f.reader.resolveGeneration('game-1', f.generation.generationId), null)
  f.row.turn = 5
  f.header.regeneratedDshTurns = { 5: 9 }
  f.header.regenInProgress = true
  assert.equal(await f.reader.resolveGeneration('game-1', f.generation.generationId), null)
  f.header.regenInProgress = false
  assert.equal((await f.reader.resolveGeneration('game-1', f.generation.generationId)).turn, 5)
  f.header.regeneratedDshTurns = { 5: 10 }
  assert.equal(await f.reader.resolveGeneration('game-1', f.generation.generationId), null)
})

test('生成身份：原版正文不能领取后来的重生成版本', async () => {
  const f = fixture()
  f.finish()
  f.header.regeneratedDshTurns = { 5: 9 }
  assert.equal(await f.reader.resolveGeneration('game-1', f.generation.generationId), null)
})

for (const change of ['source', 'anchor', 'edit', 'swipe']) test('生成身份：' + change + ' 变化时拒绝改绑', async () => {
  const f = fixture()
  f.finish()
  if (change === 'source') f.row.sourceText = '其他正文'
  if (change === 'anchor') f.row.nativeAnchor.input = 99
  if (change === 'edit') f.row.bodyEdit = { text: 'edited' }
  if (change === 'swipe') f.row.swipeId = 1
  assert.equal(await f.reader.resolveGeneration('game-1', f.generation.generationId), null)
})

test('生成身份：同一原生 turn 的不同 start 不混淆', () => {
  const f = fixture()
  f.finish('aborted')
  f.events.push({ seq: 20, type: 'turn/start', data: { turn: 5 } }, { seq: 21, type: 'user/message', data: { id: 'input-2', source: { kind: 'user' } } })
  assert.notEqual(capturePluginGeneration(f.session).generationId, f.generation.generationId)
})

test('生成身份：工具提交回执在重生成隐藏后仍可验证', () => {
  const f = fixture({ kind: 'regenerate' })
  const args = JSON.stringify({ content: '正文原文。' })
  f.events.push({ seq: 12, type: 'assistant/message', data: { turn: 5, message: { source: { kind: 'model' }, content: [{ type: 'tool-call', name: 'submit_story', id: 'call-1', arguments: args }] } } },
    { seq: 13, type: 'tool/call', data: { turn: 5, name: 'submit_story', callId: 'call-1', arguments: args } },
    { seq: 14, type: 'tool/result', data: { turn: 5, message: { content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: '正文原文。' }] }] } } },
    { seq: 15, type: 'turn/end', data: { turn: 5, reason: { kind: 'completed' } } })
  f.session.surface = { nodes: [] }
  assert.equal(pluginGenerationEvidence(f.session, f.generation.generationId).result.text, '正文原文。')
})
