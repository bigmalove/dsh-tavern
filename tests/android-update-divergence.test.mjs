import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

// 手机上点更新报「项目目录包含本地提交或已经分叉」：本地只比远端多了一个清单
// 发布提交，但旧逻辑按提交信息匹配上游那句英文，换源后文案不同就被当成用户提交。
// 这里直接跑 setup.sh 里那一段判定，覆盖真实 git 历史。
const source = await readFile(new URL('../android/setup.sh', import.meta.url), 'utf8')

function extract(name) {
  const start = source.indexOf(name + '() {')
  assert.ok(start >= 0, `找不到 ${name}`)
  let depth = 0
  let index = source.indexOf('{', start)
  for (; index < source.length; index++) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') { depth -= 1; if (depth === 0) break }
  }
  return source.slice(start, index + 1)
}

const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-divergence-'))
const run = (cwd, args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' })

try {
  const remote = path.join(root, 'remote.git')
  const work = path.join(root, 'work')
  const installed = path.join(root, 'installed')
  await mkdir(remote)
  run(remote, ['init', '--bare', '-q', '-b', 'main'])
  await mkdir(work)
  run(work, ['init', '-q', '-b', 'main'])
  await writeFile(path.join(work, 'package.json'), '{"name":"t","version":"1.0.0"}\n')
  await writeFile(path.join(work, 'dsh-tavern-runtime.json'), '{"revision":"1111","releaseSequence":1}\n')
  run(work, ['add', '-A'])
  run(work, ['commit', '-qm', 'init'])
  run(work, ['remote', 'add', 'origin', remote])
  run(work, ['push', '-q', 'origin', 'main'])

  // 安装副本：模拟手机上「本地多一个清单发布提交，且该提交已被强推改写成另一条历史」
  execFileSync('git', ['clone', '-q', remote, installed])
  await writeFile(path.join(installed, 'dsh-tavern-runtime.json'), '{"revision":"1111","releaseSequence":2}\n')
  run(installed, ['commit', '-qam', 'chore(清单): 发布到 1111，sequence 2'])

  // 远端：同一份清单内容，但换了一条历史（父提交不同）→ 本地提交不在远端历史里
  run(work, ['pull', '-q', '--rebase', 'origin', 'main'])
  await writeFile(path.join(work, 'dsh-tavern-runtime.json'), '{"revision":"1111","releaseSequence":3}\n')
  await writeFile(path.join(work, 'README.md'), 'x\n')
  run(work, ['add', '-A'])
  run(work, ['commit', '-qm', 'chore(清单): 发布到 1111，sequence 3'])
  run(work, ['push', '-q', '--force', 'origin', 'main'])
  execFileSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: installed })

  const isAncestor = (base, head, cwd) => {
    try { execFileSync('git', ['merge-base', '--is-ancestor', base, head], { cwd }); return true }
    catch { return false }
  }
  assert.equal(isAncestor('HEAD', 'origin/main', installed), false, '前置条件：本地确实与远端分叉')

  const snippet = path.join(root, 'divergence.sh')
  await writeFile(snippet, extract('divergence_is_disposable') + '\ndivergence_is_disposable "$1"\n')
  const check = (dir) => {
    try {
      execFileSync('bash', [snippet, dir], { encoding: 'utf8' })
      return 0
    } catch (error) {
      return error.status ?? 1
    }
  }

  assert.equal(check(installed), 0, '只有清单提交的分叉应视为可丢弃')

  // 只要本地提交动了源码文件，就必须继续拒绝更新。
  await writeFile(path.join(installed, 'package.json'), '{"name":"t","version":"1.0.1"}\n')
  run(installed, ['commit', '-qam', 'local tweak'])
  assert.equal(check(installed), 1, '动过源码的本地提交必须拦住')

  // 清单提交里夹带别的文件同样要拦。
  run(installed, ['reset', '-q', '--hard', 'HEAD~1'])
  await writeFile(path.join(installed, 'dsh-tavern-runtime.json'), '{"revision":"1111","releaseSequence":4}\n')
  await writeFile(path.join(installed, 'extra.txt'), 'x\n')
  run(installed, ['add', '-A'])
  run(installed, ['commit', '-qm', 'chore(清单): 发布到 1111，sequence 4'])
  assert.equal(check(installed), 1, '清单提交若夹带其它文件，不能当成可丢弃')
} finally {
  await rm(root, { recursive: true, force: true })
}
