import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createNativeConversationStorage } from '../tavern-plugin/lib/domain/native-conversation-storage.js'

// 原生存储的 readSessionState 先按字段清单裁剪 header，再交给 projectChatSessionState。
// 两份白名单都不含 deletionUndo 时，缓存命中那条路径永远算不出 canUndoDeletion，
// 界面上的「撤销删除」就永远不出现——删除本身是成功的，磁盘上也留着撤销点。
const deletionUndo = {
  kind: 'message', index: 0, turn: 1, role: 'assistant',
  message: { role: 'assistant', turn: 1, text: '被删掉的那段正文' },
  state: { posture: '', ledger: null, lastSettle: null, settleStatus: 'idle', hasVariables: false },
  nativeSeq: 2, nativeType: 'assistant/message', markerId: 'tavern-message-delete:x', at: 1
}

function chat(extra = {}) {
  return {
    id: 'chat-undo', sessionId: 'session-undo', mode: 'story', cardPath: '', cardName: '',
    requestMode: 'dsh', _storageRevision: 1, updatedAt: 1,
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 1, checkpoints: [], participants: {}, operations: {}, updatedAt: 1 },
    settleStatus: 'idle', posture: '', ledger: null,
    messages: [{ role: 'user', turn: 1, text: '推门' }],
    ...extra
  }
}

async function withStorage(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tavern-undo-'))
  try {
    await run(createNativeConversationStorage({ dataRoot: dir }), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('原生 readSessionState 保留 deletionUndo', async () => {
  await withStorage(async storage => {
    await storage.create('chat-undo', chat({ deletionUndo }))
    const state = await storage.readSessionState('chat-undo')
    assert.ok(state, '应当读回会话状态')
    assert.ok(state.deletionUndo, '撤销点不能被字段清单裁掉')
    assert.equal(state.deletionUndo.index, 0)
    assert.equal(state.deletionUndo.message.text, '被删掉的那段正文')
  })
})

test('没有撤销点时原生 readSessionState 也不凭空造一个', async () => {
  await withStorage(async storage => {
    await storage.create('chat-undo', chat())
    const state = await storage.readSessionState('chat-undo')
    assert.equal(Object.hasOwn(state, 'deletionUndo'), false)
  })
})
