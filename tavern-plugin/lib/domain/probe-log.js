// 临时诊断落盘（TAVERN_PROBE=1 时启用），排查完即删。
import { appendFileSync } from 'node:fs'

const TARGET = '/mnt/E/vibecode/dsh-tavern/outputs/_probe/probe.log'

export function log(tag, payload) {
  try {
    appendFileSync(TARGET, JSON.stringify({ at: new Date().toISOString(), tag, payload }) + '\n')
  } catch (_) {}
}
