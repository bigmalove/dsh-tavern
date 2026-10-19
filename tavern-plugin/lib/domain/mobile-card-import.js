import { createMobileFiles } from './mobile-files.js'
import { renderPngThumbnail } from './png-thumbnail.js'

const CARD_EXTENSIONS = ['.json', '.png', '.charx', '.dshcard']
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_THUMBNAIL_CACHE = 240

function extensionOf(name) {
  return name.toLowerCase().slice(name.lastIndexOf('.'))
}

function pngPayload(buffer, name) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length <= signature.length || !buffer.subarray(0, signature.length).equals(signature)) throw new Error('无法识别的角色卡 PNG')
  let offset = signature.length
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) throw new Error('人物卡 PNG 数据损坏')
    if (type === 'tEXt') {
      const separator = buffer.indexOf(0, dataStart)
      if (separator >= dataStart && separator < dataEnd) {
        const keyword = buffer.toString('ascii', dataStart, separator)
        if (keyword === 'chara' || keyword === 'ccv3') {
          return { kind: 'png', name, b64: buffer.toString('latin1', separator + 1, dataEnd), fileB64: buffer.toString('base64') }
        }
      }
    }
    if (type === 'IEND') break
    offset = dataEnd + 4
  }
  throw new Error('PNG 中未找到角色卡数据（chara/ccv3 文本块）')
}

export function createMobileCardImport(options = {}) {
  const enabled = options.runtimeHost === 'android' || options.enabled === true
  const files = createMobileFiles({
    runtimeHost: options.runtimeHost,
    enabled: options.enabled,
    roots: options.roots,
    extensions: CARD_EXTENSIONS,
    maxBytes: Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES
  })
  const thumbnailCacheLimit = Number.isFinite(options.thumbnailCache) && options.thumbnailCache > 0 ? Math.floor(options.thumbnailCache) : DEFAULT_THUMBNAIL_CACHE
  const thumbnailCache = new Map()

  /** Archives (CHARX, DSH cards) are read from disk where they are, not loaded whole. */
  async function archive(id) {
    if (!enabled) throw new Error('当前宿主不允许从手机下载目录导入')
    const entry = await files.resolve(id)
    return /\.(charx|dshcard)$/i.test(entry.item.name) ? { file: entry.file, name: entry.item.name } : null
  }

  async function read(id) {
    if (!enabled) throw new Error('当前宿主不允许从手机下载目录导入')
    const entry = await files.resolve(id)
    const buffer = (await files.read(id)).buffer
    const extension = extensionOf(entry.item.name)
    if (extension === '.charx') return { kind: 'charx', name: entry.item.name, fileB64: buffer.toString('base64') }
    return extension === '.json'
      ? { kind: 'text', name: entry.item.name, text: buffer.toString('utf8') }
      : pngPayload(buffer, entry.item.name)
  }

  /**
   * 生成下载目录里某个 PNG 的小尺寸预览图。
   * 返回 undefined 表示这张卡没有可用缩略图（JSON、图片无法识别或超出处理范围），调用方按占位处理。
   */
  async function thumbnail(id) {
    if (!enabled) throw new Error('当前宿主不允许从手机下载目录导入')
    const entry = await files.resolve(id)
    if (extensionOf(entry.item.name) !== '.png') return undefined
    const key = entry.item.id + ':' + entry.item.size + ':' + entry.item.modifiedAt
    if (thumbnailCache.has(key)) return thumbnailCache.get(key)
    let thumb
    try {
      thumb = renderPngThumbnail((await files.read(id)).buffer)
    } catch {
      thumb = undefined
    }
    thumbnailCache.set(key, thumb)
    while (thumbnailCache.size > thumbnailCacheLimit) thumbnailCache.delete(thumbnailCache.keys().next().value)
    return thumb
  }

  return Object.freeze({ list: files.list, read, archive, thumbnail })
}
