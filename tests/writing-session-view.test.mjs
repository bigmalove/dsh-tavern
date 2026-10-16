import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('写作会话走真实插件的完整/增量/缓存会话投影与后台设置接口', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-writing-view-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/writing-session-view.mjs', import.meta.url))], {
    env: { ...process.env, DSH_HOME: root }, encoding: 'utf8', timeout: 30000
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /writing session RPC projections passed/)
})
