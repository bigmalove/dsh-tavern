import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPluginHost } from './plugin-host.mjs'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { resolveTavernDataRoot } from '../../tavern-plugin/lib/domain/tavern-data.js'

// 真实插件 RPC 层的写作会话：磁盘上没有人物卡，视图与设置接口必须照常工作。
const root = resolveTavernDataRoot()
await mkdir(root, { recursive: true })
await writeFile(join(root, 'sessions.json'), JSON.stringify({ s: 'writing-chat' }))
await createChatJournalStore({ dataRoot: root }).update('writing-chat', () => ({
  id: 'writing-chat', _storageRevision: 1, sessionId: 's', mode: 'writing',
  cardPath: '', cardName: '写作',
  backgroundConfigVersion: 1, conversationFeaturesVersion: 1,
  backgroundTasks: { posture: false, characterDesign: false, variables: true, variableFeedback: true },
  sceneImagesEnabled: false, webSearchEnabled: false, storyToolCallEnabled: false,
  macroState: { userName: '你', local: {}, global: {} },
  mvu: { enabled: false },
  messages: [
    { role: 'user', text: '写一场雨夜追逐戏。', ts: 1, turn: 1 },
    { role: 'assistant', text: '雨砸在青石板上，脚步声追着巷口。', ts: 2, turn: 1 }
  ]
}))
const host = await createPluginHost()
try {
  const { view } = await host.rpc('getSession', { sessionId: 's' })
  assert.equal(view.mode, 'writing')
  assert.equal(view.card.name, '写作')
  assert.equal(view.card.path, '')
  assert.equal(view.cardUpdate.available, false, '写作会话没有人物卡更新')
  assert.equal(view.tavernHelper, null, '写作会话没有卡片脚本运行时')

  const { sessions } = await host.rpc('listSessions', {})
  const row = sessions.find(item => item.sessionId === 's')
  assert.equal(row.mode, 'writing')
  assert.equal(row.cardPath, '')

  const background = await host.rpc('getConversationBackgroundConfig', { sessionId: 's' })
  assert.equal(background.sceneImagesAvailable, false, '写作会话不生图')
  assert.equal(background.backgroundTasks.posture, false, '写作会话默认不结算人物姿势')
  assert.equal(background.backgroundTasks.characterDesign, false)

  // 生图开关在写作会话里必须被拒绝，而不是悄悄打开。
  await assert.rejects(host.rpc('setConversationBackgroundConfig', { sessionId: 's', sceneImagesEnabled: true }), /写作模式不支持场景生图/)
  const webSearch = await host.rpc('setConversationBackgroundConfig', { sessionId: 's', webSearchEnabled: true })
  assert.equal(webSearch.webSearchEnabled, true, '联网搜索仍可为本局打开')

  const { text } = await host.rpc('exportConversation', { chatId: 'writing-chat' })
  assert.match(text, /雨砸在青石板上/, '写作会话可以导出正文')
  console.log('writing session RPC projections passed')
} finally { await host.dispose() }
