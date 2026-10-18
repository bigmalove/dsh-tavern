import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'

// pnpm 的 frozen 安装会拿 patches/ 里补丁文件的 sha256 和 pnpm-lock.yaml 的
// patchedDependencies 比对。改了补丁忘了更新锁文件，本机看着一切正常，
// 到了每台设备上都是 LOCKFILE_CONFIG_MISMATCH，整个更新在依赖这一步回滚。
// 实测（pnpm 11.25.0，安卓）：
//   [ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] The current "patchedDependencies"
//   configuration doesn't match the value found in the lockfile
const ENTRY = /^\s{2}([@\w./-]+@[^:\s]+):\s*(\S.*?)\s*$/

async function section(file, name) {
  const text = await readFile(new URL('../' + file, import.meta.url), 'utf8')
  const lines = text.split('\n')
  const start = lines.findIndex(line => line.trimEnd() === name + ':')
  if (start < 0) return null
  const entries = {}
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') break
    if (!/^\s/.test(line)) break
    const match = ENTRY.exec(line)
    if (match) entries[match[1]] = match[2]
  }
  return entries
}

async function patchDigest(name) {
  const body = await readFile(new URL(`../patches/${name}.patch`, import.meta.url))
  return createHash('sha256').update(body).digest('hex')
}

test('锁文件的补丁哈希与 patches/ 实际内容一致', async () => {
  const locked = await section('pnpm-lock.yaml', 'patchedDependencies')
  assert.ok(locked && Object.keys(locked).length > 0, 'pnpm-lock.yaml 缺少 patchedDependencies')
  for (const [name, want] of Object.entries(locked)) {
    const actual = await patchDigest(name)
    assert.equal(actual, want, `${name} 的补丁内容变了但 pnpm-lock.yaml 没更新；请把 patchedDependencies 的哈希改成 ${actual}`)
  }
})

test('pnpm-workspace.yaml 声明的补丁都有文件、且都已进锁文件', async () => {
  const declared = await section('pnpm-workspace.yaml', 'patchedDependencies')
  const locked = await section('pnpm-lock.yaml', 'patchedDependencies')
  assert.ok(declared, 'pnpm-workspace.yaml 缺少 patchedDependencies')
  assert.deepEqual(Object.keys(declared).sort(), Object.keys(locked).sort(), '两处声明的补丁集合必须一致')
  for (const [name, path] of Object.entries(declared)) {
    assert.equal(path, `patches/${name}.patch`, `${name} 的补丁路径应与其包名一致`)
    assert.ok(existsSync(new URL('../' + path, import.meta.url)), `缺少补丁文件 ${path}`)
  }
})
