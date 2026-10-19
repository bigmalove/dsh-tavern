import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Read-only access to the phone's shared download folders.
 *
 * Android hands the container `/sdcard` as a bind mount, so listing works without
 * a system file picker. That matters inside DSHA: the embedded WebView delegates
 * `<input type=file>` to the host, and a ROM without a usable DocumentsUI answers
 * every launch with "无法打开文件选择器". Callers therefore need a path that never
 * leaves the container.
 */
export function defaultMobileRoots() {
  return [
    { id: 'download', label: '手机 Download', path: '/sdcard/Download' },
    { id: 'dsha-download', label: 'DSHA 下载', path: '/sdcard/Download/DSHA/下载' }
  ]
}

function encodeName(name) {
  return Buffer.from(name, 'utf8').toString('base64url')
}

function decodeName(value) {
  try { return Buffer.from(value, 'base64url').toString('utf8') } catch { throw new Error('无效的手机文件标识') }
}

export function createMobileFiles(options = {}) {
  const enabled = options.runtimeHost === 'android' || options.enabled === true
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 25 * 1024 * 1024
  const extensions = new Set((options.extensions || []).map(function (value) { return String(value).toLowerCase() }))
  const roots = (options.roots || defaultMobileRoots()).map(function (root) {
    return { id: String(root.id), label: String(root.label), path: path.resolve(String(root.path)) }
  })
  const rootById = new Map(roots.map(function (root) { return [root.id, root] }))

  async function inspect(root, name) {
    if (path.basename(name) !== name || !extensions.has(path.extname(name).toLowerCase())) return null
    const target = path.join(root.path, name)
    let info
    try { info = await lstat(target) } catch { return null }
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maxBytes) return null
    return { id: root.id + ':' + encodeName(name), name, directory: root.label, size: info.size, modifiedAt: info.mtimeMs }
  }

  async function list() {
    if (!enabled) return { available: false, files: [] }
    const files = []
    const seen = new Set()
    let readableRoots = 0
    for (const root of roots) {
      let names
      try { names = await readdir(root.path) } catch { continue }
      readableRoots += 1
      for (const name of names) {
        const item = await inspect(root, name)
        if (item && !seen.has(item.id)) { seen.add(item.id); files.push(item) }
      }
    }
    files.sort(function (left, right) { return right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name, 'zh-CN') })
    return { available: true, storageAccessible: readableRoots > 0, total: files.length, files }
  }

  async function resolve(id) {
    if (!enabled) throw new Error('当前宿主不允许从手机下载目录导入')
    const separator = typeof id === 'string' ? id.indexOf(':') : -1
    if (separator <= 0) throw new Error('无效的手机文件标识')
    const root = rootById.get(id.slice(0, separator))
    const name = decodeName(id.slice(separator + 1))
    if (!root || path.basename(name) !== name || !extensions.has(path.extname(name).toLowerCase())) throw new Error('不允许读取这个手机文件')
    const item = await inspect(root, name)
    if (!item || item.id !== id) throw new Error('手机文件不存在、过大或不允许读取')
    return { root, item, file: path.join(root.path, item.name) }
  }

  async function read(id, options = {}) {
    const entry = await resolve(id)
    const limit = Number.isFinite(options.maxBytes) ? options.maxBytes : Infinity
    if (entry.item.size > limit) throw new Error('手机文件超过允许的大小')
    return { name: entry.item.name, buffer: await readFile(entry.file) }
  }

  return Object.freeze({ list, read, resolve })
}
