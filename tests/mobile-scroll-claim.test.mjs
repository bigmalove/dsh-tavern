import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

// 安卓 WebView 里挂一条常驻的 document 级非 passive touchmove，会让整页滚动都先等 JS
// （首个 preventDefault 还会取消整段手势）——实机表现就是「正文滑动过慢、划快了不跟手」。
// 侧栏手势只在边缘起手（或抽屉已展开）时才接管触摸流，其余手势交还浏览器原生滚动。
const invariants = source => {
  assert.equal((source.match(/document\.addEventListener\('touchmove'/g) || []).length, 1, '只保留一处 touchmove 注册（attachScrollClaim 内）')
  const attach = source.slice(source.indexOf('function attachScrollClaim()'), source.indexOf('function detachScrollClaim()'))
  assert.match(attach, /addEventListener\('touchmove'/, 'attachScrollClaim 注册 touchmove')
  assert.match(attach, /passive: false/, '手势接管需要能 preventDefault')
  const detach = source.slice(source.indexOf('function detachScrollClaim()'), source.indexOf('function detachScrollClaim()') + 400)
  assert.match(detach, /removeEventListener\('touchmove'/, 'detachScrollClaim 撤销注册')
  const beginStroke = source.slice(source.indexOf('function beginStroke('), source.indexOf('function tryLock('))
  assert.match(beginStroke, /insideEdgeClaim\(event\.clientX/, '起手点在边缘条内才接管')
  const reset = source.slice(source.indexOf('function reset()'), source.indexOf('function reset()') + 300)
  assert.match(reset, /detachScrollClaim\(\)/, '手势结束即撤销接管')
}

test('dsh-web-mobile 补丁：侧栏手势不再常驻接管整页滚动', async () => {
  const patch = await readFile(new URL('../patches/dsh-web-mobile@2.4.1.patch', import.meta.url), 'utf8')
  const added = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n')
  for (const fragment of ['function attachScrollClaim()', 'function detachScrollClaim()', 'insideEdgeClaim(event.clientX', 'detachScrollClaim();']) {
    assert.ok(added.includes(fragment), `补丁包含 ${fragment}`)
  }
  assert.equal(patch.split('\n').filter(line => line.startsWith('-') && line.includes("addEventListener('touchmove'")).length, 1, '补丁删掉常驻注册')
})

test('已安装的 dsh-web-mobile 与补丁一致', { skip: !existsSync(new URL('../node_modules/dsh-web-mobile/lib/client.js', import.meta.url)) }, async () => {
  invariants(await readFile(new URL('../node_modules/dsh-web-mobile/lib/client.js', import.meta.url), 'utf8'))
})
