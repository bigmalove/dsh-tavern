import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { applyConversationPresetToCurrent } from '../tavern-plugin/lib/domain/conversation-preset-application.js'

// Exercise the production RPC branch with isolated persistence and resource dependencies.
const source = readFileSync(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const body = source.split("case 'applyConversationPreset': {")[1].split("case 'getPreset':")[0]
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction('args', 'str', 'chatForSession', 'groupOfMode', 'sessionActivity', 'agentRegistry', 'runtimePresets', 'updateChat', 'view', 'applyConversationPresetToCurrent', '{' + body)
function harness({ busy = false, background = false, newRound = false, replaced = false } = {}) {
  let chat = { id: 'game', sessionId: 'story-1', mode: 'story', _storageRevision: 1, messages: Array.from({ length: 200 }, (_, turn) => ({ turn })), variables: { hp: 7 }, runtimePresetSnapshot: { presetPath: 'old' } }
  let reads = 0
  const snapshot = { presetPath: 'new', front: { text: 'front' }, middle: { text: 'middle' }, back: { text: 'back' }, regexScripts: [{ findRegex: 'a', replaceString: 'b' }] }
  const apply = path => run({ sessionId: 'session', path }, String, async () => structuredClone(chat), () => 'play', async () => ({ busy }), new Map(),
    { fullSnapshot: async () => { reads++; return structuredClone(snapshot) } },
    async (_id, update) => {
      const draft = structuredClone(chat)
      // Background maintenance (status capture, template sync) commits between
      // the read and this mutation; a fork/import replaces the chat itself and
      // a new round can land while the preset was loading.
      if (background) { draft._storageRevision++; draft.posture = 'background write' }
      if (newRound) { draft._storageRevision++; draft.messages.push({ turn: 200 }) }
      if (replaced) { draft.sessionId = 'story-2'; draft.id = 'game-2' }
      chat = update(draft)
      return chat
    },
    async saved => saved, applyConversationPresetToCurrent)
  return { chat: () => chat, reads: () => reads, snapshot, apply }
}

test('busy games reject preset replacement without changing the save', async () => {
  const h = harness({ busy: true })
  const before = structuredClone(h.chat())
  await assert.rejects(h.apply('new'), /等待/)
  assert.deepEqual(h.chat(), before)
})

test('并发内部写入不阻止预设切换，也不会覆盖其它字段', async () => {
  const h = harness({ background: true })
  const result = await h.apply('new')
  assert.deepEqual(result.runtimePreset, { id: 'new', name: undefined })
  const saved = h.chat()
  assert.deepEqual(saved.runtimePresetSnapshot, h.snapshot)
  assert.equal(saved.posture, 'background write', '并发写入的字段必须保留')
  assert.equal(saved._storageRevision, 2, '写入落在最新版本之上')
  assert.equal(saved.messages.length, 200, '历史正文不变')
})

test('切回不使用外部预设会清空快照', async () => {
  const h = harness()
  const result = await h.apply('')
  assert.equal(result.runtimePreset, null)
  assert.equal(h.chat().runtimePresetSnapshot, null)
  assert.equal(h.reads(), 0, '内置预设不读取快照')
})

test('同一局被替换（分叉或导入）时拒绝写入旧预设', async () => {
  const h = harness({ replaced: true })
  const before = structuredClone(h.chat())
  await assert.rejects(h.apply('new'), /已变化/)
  assert.deepEqual(h.chat(), before)
})

test('a save written meanwhile without a new turn (a display receipt) still takes the preset', async () => {
  const h = harness({ touched: true })
  await h.apply('new')
  assert.equal(h.chat().runtimePresetSnapshot.presetPath, 'new')
})

test('预设加载期间又落了一轮新正文时拒绝，不覆盖这一轮的存档', async () => {
  const h = harness({ newRound: true })
  const before = structuredClone(h.chat())
  await assert.rejects(h.apply('new'), /已变化/)
  assert.deepEqual(h.chat(), before)
})
