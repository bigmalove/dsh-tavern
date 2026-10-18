#!/usr/bin/env node
// DSH 的 Workspace 记录里存的是「规范化路径」（realpath）。记录一旦和磁盘上的
// 真实路径对不上，attachSession 会直接拒绝一切新会话：
//   session/workspace-attach-failed: ... its cwd resolves to '<另一条路径>'
// 新建对话、导入聊天记录、导入角色卡都会当场失败，而已有会话照常能开，所以症状
// 很像「只有导入坏了」。
//
// 触发场景：把 profile-data 从 A 挪到 B、再在 A 留软链桥接（本机 2026-10-18 就是
// 这么干的）。此时旧记录的 path 仍是 A（软链前是规范的），realpath 却成了 B。
//
// 修复方式：把所有记录的 path 改写成 realpath(path)。会话归属不受影响——宿主建
// 索引时同样按 realpath(header.cwd) 比对，所以旧会话（cwd 还是 A）和新会话（cwd
// 将是 B）会一起落回同一条记录。
//
// 必须离线执行：宿主把工作区表读进内存，运行中被它改写会覆盖这里的修复。

import os from 'node:os'
import path from 'node:path'
import { constants } from 'node:fs'
import { copyFile, readFile, realpath, stat } from 'node:fs/promises'
import { createDurableFilePromotion } from '../tavern-plugin/lib/durable-file-promotion.js'

export function resolveHome(options = {}) {
  return path.resolve(options.home || process.env.DSH_TAVERN_CLI_HOME || process.env.DSH_HOME || path.join(os.homedir(), '.dsh-tavern'))
}

export function workspaceStorePath(options = {}) {
  const profile = options.profile || 'tavern'
  if (options.storeFile) return path.resolve(options.storeFile)
  return path.join(resolveHome(options), 'profile-data', profile, 'storages', 'workspace.json')
}

/**
 * 只读盘点：哪些记录的 path 已经不是规范路径。
 * @returns {{storeFile: string, entries: Array<{id: string, stored: string, canonical?: string, status: string}>, repairs: Array<{id: string, from: string, to: string}>, blocked: Array<{id: string, status: string, detail: string}>}}
 */
export async function planWorkspacePathRepair(options = {}) {
  const storeFile = workspaceStorePath(options)
  let raw
  try { raw = await readFile(storeFile, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('找不到工作区存储：' + storeFile)
    throw error
  }
  let store
  try { store = JSON.parse(raw) } catch { throw new Error('工作区存储不是合法 JSON：' + storeFile) }
  const table = store?.tables?.workspaces
  if (!table || typeof table !== 'object') throw new Error('工作区存储缺少 tables.workspaces：' + storeFile)

  const entries = []
  const repairs = []
  const blocked = []
  const claimed = new Map()

  for (const [id, record] of Object.entries(table)) {
    const stored = typeof record?.path === 'string' ? record.path : ''
    if (!stored) {
      const entry = { id, stored, status: 'missing-path' }
      entries.push(entry)
      blocked.push({ id, status: entry.status, detail: '记录里没有 path' })
      continue
    }
    let canonical
    try { canonical = await realpath(stored) } catch {
      const entry = { id, stored, status: 'unresolvable' }
      entries.push(entry)
      blocked.push({ id, status: entry.status, detail: '路径不存在或无法解析：' + stored })
      continue
    }
    let directory = false
    try { directory = (await stat(canonical)).isDirectory() } catch {}
    if (!directory) {
      const entry = { id, stored, canonical, status: 'not-directory' }
      entries.push(entry)
      blocked.push({ id, status: entry.status, detail: '规范化后不是目录：' + canonical })
      continue
    }
    const holder = claimed.get(canonical)
    if (holder !== undefined) {
      const entry = { id, stored, canonical, status: 'duplicate' }
      entries.push(entry)
      blocked.push({ id, status: entry.status, detail: `与工作区 ${holder} 规范化到同一目录：${canonical}` })
      continue
    }
    claimed.set(canonical, id)
    if (canonical === stored) {
      entries.push({ id, stored, canonical, status: 'ok' })
      continue
    }
    entries.push({ id, stored, canonical, status: 'repair' })
    repairs.push({ id, from: stored, to: canonical })
  }

  return { storeFile, store, entries, repairs, blocked }
}

/** 写入修复结果：先备份，再原子替换，最后回读校验。 */
export async function applyWorkspacePathRepair(plan, options = {}) {
  if (plan.blocked.length) {
    throw new Error('存在无法自动处理的记录，拒绝改写：' + plan.blocked.map((item) => `${item.id}（${item.status}）`).join('、'))
  }
  if (!plan.repairs.length) return { changed: 0, backup: '' }

  const store = plan.store
  const table = store.tables.workspaces
  for (const repair of plan.repairs) table[repair.id].path = repair.to
  const payload = JSON.stringify(store, null, 2) + '\n'

  const stamp = new Date(Number(options.now ?? Date.now())).toISOString().replace(/[:.]/g, '-')
  const backup = `${plan.storeFile}.bak-${stamp}`
  await copyFile(plan.storeFile, backup, constants.COPYFILE_EXCL)

  await createDurableFilePromotion().write(plan.storeFile, payload)

  const written = JSON.parse(await readFile(plan.storeFile, 'utf8'))
  for (const repair of plan.repairs) {
    const actual = written?.tables?.workspaces?.[repair.id]?.path
    if (actual !== repair.to) throw new Error(`回读校验失败：工作区 ${repair.id} 仍是 ${actual}`)
  }
  return { changed: plan.repairs.length, backup }
}

async function servicePort(home, fallback = 3081) {
  try {
    const pid = JSON.parse(await readFile(path.join(home, 'logs', 'tavern.pid.json'), 'utf8'))
    const port = Number(pid?.port)
    if (Number.isInteger(port) && port > 0) return port
  } catch {}
  return fallback
}

async function serviceRunning(port, timeoutMs) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    return true
  } catch { return false }
}

function usage() {
  return [
    'DSH Tavern 工作区路径修复（离线）',
    '',
    '用法：',
    '  node bin/repair-workspace-paths.mjs                 # 只盘点，不写盘',
    '  node bin/repair-workspace-paths.mjs --apply         # 写入（要求服务已停止）',
    '',
    '选项：',
    '  --home <dir>       DSH home，默认 $DSH_TAVERN_CLI_HOME / $DSH_HOME / ~/.dsh-tavern',
    '  --profile <name>   profile 名，默认 tavern',
    '  --store <file>     直接指定 workspace.json',
    '  --port <n>         服务端口，默认取 logs/tavern.pid.json，缺失时 3081',
    '  --force            服务在跑也强行写入（不推荐：宿主会用内存状态覆盖）',
  ].join('\n')
}

function flag(argv, name) {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(usage()); return 0 }
  const apply = argv.includes('--apply')
  const force = argv.includes('--force')
  const home = resolveHome({ home: flag(argv, '--home') })
  const profile = flag(argv, '--profile') || 'tavern'
  const storeFile = flag(argv, '--store')

  const plan = await planWorkspacePathRepair({ home, profile, storeFile })
  console.log('工作区存储：' + plan.storeFile)
  console.log(`记录 ${plan.entries.length} 条：规范 ${plan.entries.filter((item) => item.status === 'ok').length}、待修复 ${plan.repairs.length}、阻塞 ${plan.blocked.length}`)
  for (const repair of plan.repairs) console.log(`  修复 ${repair.id}\n    ${repair.from}\n -> ${repair.to}`)
  for (const item of plan.blocked) console.log(`  阻塞 ${item.id}（${item.status}）：${item.detail}`)

  if (!apply) {
    console.log(plan.repairs.length ? '未写入（默认 dry-run）。确认无误后加 --apply。' : '无需修复。')
    return 0
  }
  if (!plan.repairs.length) { console.log('无需修复。'); return 0 }
  if (plan.blocked.length) { console.error('存在阻塞记录，未写入。'); return 2 }

  const port = Number(flag(argv, '--port')) || await servicePort(home)
  if (!force && await serviceRunning(port, 1500)) {
    console.error(`服务正在运行（127.0.0.1:${port}），先停掉再跑：\n  dsh-tavern stop && node bin/repair-workspace-paths.mjs --apply && dsh-tavern start`)
    return 3
  }

  const result = await applyWorkspacePathRepair(plan)
  console.log(`已修复 ${result.changed} 条，备份：${result.backup}`)
  console.log('重启服务后生效：dsh-tavern start')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch((error) => {
    console.error('修复失败：' + (error?.message || error))
    process.exitCode = 1
  })
}
