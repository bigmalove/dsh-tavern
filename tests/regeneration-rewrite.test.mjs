import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { regenerationInputText } from '../tavern-plugin/lib/domain/round-history.js'
import { projectRegenerationRequestMessages } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

test('普通重新生成不带旧正文，意见作为补充要求', () => {
  assert.equal(regenerationInputText('继续', '', ''), '继续')
  assert.equal(regenerationInputText('继续', '写得更长', ''), '继续\n\n【本轮补充要求】\n写得更长')
})

test('按意见改写把当前正文放进本轮输入，作为要改的底稿', () => {
  const text = regenerationInputText('继续', '写得更长', '旧正文')
  assert.match(text, /^继续\n\n【当前正文】\n旧正文\n\n【改写要求】\n[^\n]*写得更长$/)
  // 没有意见就没有可改的方向，退回普通重新生成。
  assert.equal(regenerationInputText('继续', '', '旧正文'), '继续')
})

test('请求里旧回复照样被去掉，旧正文只经由改写输入出现一次', () => {
  const rewrite = regenerationInputText('继续', '写得更长', '旧正文')
  const messages = [
    { id: 'p1', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } },
    { role: 'assistant', content: [{ type: 'text', text: '旧正文' }], source: { kind: 'model' } },
    { role: 'user', content: [{ type: 'text', text: rewrite }], source: { kind: 'plugin:dsh-tavern-regen' } }
  ]
  const projected = projectRegenerationRequestMessages(messages)
  assert.equal(projected.length, 1)
  assert.equal(JSON.stringify(projected).split('旧正文').length - 1, 1)
})

test('面板：「参考旧正文重写」只在填了意见时出现，RPC 带上 rewrite', () => {
  assert.match(client, /props\.rewriteLabel && props\.value\.trim\(\) \?/)
  assert.match(client, /rewriteLabel: "参考旧正文重写"/)
  assert.match(client, /rpc\("regenBody", \{ guidance: String\(guidance \|\| ""\)\.trim\(\), rewrite: rewrite === true \}/)
  assert.match(server, /regenBody\(args && args\.chatId, args && args\.guidance, args && args\.sessionId, \{ rewrite: args && args\.rewrite === true \}\)/)
})
