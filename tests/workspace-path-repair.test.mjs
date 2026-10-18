import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { applyWorkspacePathRepair, planWorkspacePathRepair } from '../bin/repair-workspace-paths.mjs'

// 2026-10-18 生产故障：profile-data 从 ~/.dsh 挪到 ~/.dsh-tavern，旧 home 留软链
// 桥接。workspace.json 里记录还是 ~/.dsh/...，realpath 已经是 ~/.dsh-tavern/...，
// 宿主 attachSession 比对不上，导入/新建会话全部报 workspace-attach-failed。

async function fixture(workspaces) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-workspace-path-'))
  const realHome = path.join(root, 'new-home')
  const legacyHome = path.join(root, 'legacy-home')
  const resources = path.join(realHome, 'profile-data', 'tavern', 'data', 'resources')
  await mkdir(resources, { recursive: true })
  await mkdir(path.join(legacyHome, 'profile-data', 'tavern'), { recursive: true })
  // 旧 home 用软链桥接到新 home，正是生产上的布局。
  await symlink(path.join(realHome, 'profile-data', 'tavern', 'data'), path.join(legacyHome, 'profile-data', 'tavern', 'data'))
  const legacyResources = path.join(legacyHome, 'profile-data', 'tavern', 'data', 'resources')
  const storeFile = path.join(realHome, 'profile-data', 'tavern', 'storages', 'workspace.json')
  await mkdir(path.dirname(storeFile), { recursive: true })
  const table = {}
  for (const [id, item] of Object.entries(workspaces)) table[id] = { title: id, createdAt: '2026-09-05T11:45:14.471Z', updatedAt: '2026-10-18T12:12:45.249Z', sessionIds: [], path: typeof item === 'string' ? item.replace('{legacy}', legacyResources).replace('{real}', resources) : item.path }
  await writeFile(storeFile, JSON.stringify({ unit: { name: 'workspace', version: 2 }, global: { initialized: true, workspaceIds: Object.keys(workspaces), archivedSessionIds: [] }, tables: { workspaces: table } }, null, 2) + '\n')
  return { root, storeFile, resources, legacyResources }
}

test('软链桥接后的旧记录被盘点为待修复', async () => {
  const { storeFile, resources, legacyResources } = await fixture({ w1: '{legacy}' })
  const plan = await planWorkspacePathRepair({ storeFile })
  assert.equal(plan.repairs.length, 1)
  assert.equal(plan.repairs[0].from, legacyResources)
  assert.equal(plan.repairs[0].to, resources)
  assert.equal(plan.blocked.length, 0)
})

test('规范化后相等时不产生改动', async () => {
  const { storeFile } = await fixture({ w1: '{real}' })
  const plan = await planWorkspacePathRepair({ storeFile })
  assert.equal(plan.repairs.length, 0)
  assert.equal(plan.entries[0].status, 'ok')
})

test('写入后记录变成规范路径，且重复执行无改动', async () => {
  const { storeFile, resources } = await fixture({ w1: '{legacy}' })
  const plan = await planWorkspacePathRepair({ storeFile })
  const result = await applyWorkspacePathRepair(plan, { now: 1_760_000_000_000 })
  assert.equal(result.changed, 1)
  const saved = JSON.parse(await readFile(storeFile, 'utf8'))
  assert.equal(saved.tables.workspaces.w1.path, resources)
  // 备份是改前的原文，方便回滚。
  const backup = JSON.parse(await readFile(result.backup, 'utf8'))
  assert.notEqual(backup.tables.workspaces.w1.path, resources)
  assert.match(result.backup, /workspace\.json\.bak-/)

  const again = await planWorkspacePathRepair({ storeFile })
  assert.equal(again.repairs.length, 0)
  const noop = await applyWorkspacePathRepair(again)
  assert.equal(noop.changed, 0)
  assert.equal(noop.backup, '')
})

test('两条记录规范化到同一目录时拒绝改写', async () => {
  const { storeFile } = await fixture({ w1: '{legacy}', w2: '{real}' })
  const plan = await planWorkspacePathRepair({ storeFile })
  assert.equal(plan.blocked.length, 1)
  assert.equal(plan.blocked[0].status, 'duplicate')
  await assert.rejects(() => applyWorkspacePathRepair(plan), /拒绝改写/)
})

test('路径不存在的记录不静默跳过', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-workspace-path-missing-'))
  const storeFile = path.join(root, 'stores', 'workspace.json')
  await mkdir(path.dirname(storeFile), { recursive: true })
  await writeFile(storeFile, JSON.stringify({ tables: { workspaces: { w1: { path: path.join(root, 'gone') } } } }, null, 2))
  const plan = await planWorkspacePathRepair({ storeFile })
  assert.equal(plan.blocked.length, 1)
  assert.equal(plan.blocked[0].status, 'unresolvable')
  assert.equal(plan.repairs.length, 0)
  await rm(root, { recursive: true, force: true })
})

test('默认存储位置跟随 DSH home 与 profile', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-workspace-path-home-'))
  const storeFile = path.join(root, 'home', 'profile-data', 'other', 'storages', 'workspace.json')
  await mkdir(path.dirname(storeFile), { recursive: true })
  await writeFile(storeFile, JSON.stringify({ tables: { workspaces: {} } }, null, 2))
  const plan = await planWorkspacePathRepair({ home: path.join(root, 'home'), profile: 'other' })
  assert.deepEqual(await readdir(path.join(root, 'home', 'profile-data', 'other', 'storages')), ['workspace.json'])
  assert.equal(plan.entries.length, 0)
  await rm(root, { recursive: true, force: true })
})
