import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createMobileFiles } from '../tavern-plugin/lib/domain/mobile-files.js'

test('手机存档目录只列出允许的扩展名并按选择读回字节', async function () {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-mobile-save-'))
  const downloads = path.join(root, 'Download')
  await mkdir(downloads, { recursive: true })
  await writeFile(path.join(downloads, '旧局.dshsave'), 'SAVE-BYTES')
  await writeFile(path.join(downloads, '聊天.jsonl'), '{"character_name":"阿青"}\n')
  await writeFile(path.join(downloads, '说明.txt'), 'ignored')
  await writeFile(path.join(downloads, '人物卡.png'), 'ignored too')

  const files = createMobileFiles({
    runtimeHost: 'android',
    extensions: ['.dshsave', '.zip', '.jsonl'],
    roots: [{ id: 'downloads', label: '手机 Download', path: downloads }]
  })
  const catalog = await files.list()

  assert.equal(catalog.available, true)
  assert.equal(catalog.storageAccessible, true)
  assert.deepEqual(catalog.files.map(file => file.name).sort(), ['旧局.dshsave', '聊天.jsonl'].sort())
  assert.equal('path' in catalog.files[0], false)

  const save = catalog.files.find(file => file.name === '旧局.dshsave')
  const chat = catalog.files.find(file => file.name === '聊天.jsonl')
  assert.equal((await files.read(save.id)).buffer.toString('utf8'), 'SAVE-BYTES')
  assert.equal((await files.read(chat.id)).buffer.toString('utf8'), '{"character_name":"阿青"}\n')

  const traversal = 'downloads:' + Buffer.from('../outside.dshsave').toString('base64url')
  await assert.rejects(files.read(traversal), /无效|不允许/)
  const wrongKind = 'downloads:' + Buffer.from('说明.txt').toString('base64url')
  await assert.rejects(files.read(wrongKind), /不允许|不存在/)
})

test('非 Android 宿主不提供手机目录', async function () {
  const files = createMobileFiles({ runtimeHost: 'cli', extensions: ['.dshsave'] })
  assert.deepEqual(await files.list(), { available: false, files: [] })
  await assert.rejects(files.read('download:' + Buffer.from('a.dshsave').toString('base64url')), /不允许/)
})

test('存档导入的 RPC 与手机目录入口都接上了', async function () {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  assert.match(server, /case 'listMobileSaveImports': return await mobileSaveImport\.list\(\)/)
  assert.match(server, /case 'importMobileGameSave': \{[\s\S]*?importGameSaveBuffer\(entry\.buffer\)/)
  assert.match(server, /case 'readMobileChatImport': \{[\s\S]*?entry\.buffer\.toString\('utf8'\)/)
  // The embedded window cannot always reach a system picker; the panel must ship.
  const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /listMobileSaveImports/)
  assert.match(client, /importMobileGameSave/)
  assert.match(client, /readMobileChatImport/)
  assert.match(client, /从手机 Download 选存档/)
})
