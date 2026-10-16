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
  backgroundTasks: { posture: true, characterDesign: false, variables: true, variableFeedback: true },
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
  assert.equal(background.sceneImagesAvailable, true, '写作会话同样可以生图')
  assert.equal(background.backgroundTasks.posture, true, '姿势结算跟随默认，不再被写作模式关闭')
  assert.equal(background.backgroundTasks.variables, true)

  // 生图开关在写作会话里同样可开，联网搜索照常。
  const images = await host.rpc('setConversationBackgroundConfig', { sessionId: 's', sceneImagesEnabled: true })
  assert.equal(images.sceneImagesEnabled, true, '写作会话可以打开本局场景生图')
  const webSearch = await host.rpc('setConversationBackgroundConfig', { sessionId: 's', webSearchEnabled: true })
  assert.equal(webSearch.webSearchEnabled, true, '联网搜索仍可为本局打开')

  const { text } = await host.rpc('exportConversation', { chatId: 'writing-chat' })
  assert.match(text, /雨砸在青石板上/, '写作会话可以导出正文')
  console.log('writing session RPC projections passed')
} finally { await host.dispose() }
