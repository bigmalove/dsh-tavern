import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { classifyDshVersion } from '../tavern-plugin/lib/domain/host-compatibility.js'

// One release-specific source for bootstrap installers, the launcher and documentation checks.
const compatibility = JSON.parse(readFileSync(new URL('../config/dsh-compatibility.json', import.meta.url), 'utf8'))
export const { adaptedDshVersion, recommendedDesktopVersion, desktopReleasesUrl, recommendedDshaVersion, dshaReleasesUrl } = compatibility
export const allowedDshVersions = compatibility.allowedDshVersions || [adaptedDshVersion]
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(adaptedDshVersion)) throw new Error('DSH 适配版本配置无效')

// Bundles whose peer range follows the host line (dsh-better-sidebar 0.28 needs
// ^0.2.1, 0.26 needs ^0.2.0). DSH silently skips a bundle with unmet peers, so
// every allowed host line other than the adapted one names its versions here.
export function hostLinePackages(dshVersion) {
  const line = String(dshVersion || '').match(/^\d+\.\d+\.\d+/)?.[0]
  return (line && compatibility.hostLinePackages?.[line]) || {}
}

export function extractDshVersion(output) {
  const match = String(output || '').match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)
  if (!match) throw new Error('无法识别当前 DSH 版本。')
  return match[1]
}

const STABLE_GUIDE = 'https://github.com/flizzywine/dsh-tavern/blob/stable/README.md#快速开始'

function hostGuidance(host) {
  return host === 'android'
    ? `推荐 DSHA ${recommendedDshaVersion}：${dshaReleasesUrl}`
    : `推荐官方 DeepSeek Harness ${recommendedDesktopVersion}：${desktopReleasesUrl}`
}

// Host versions must be on the allowlist. CLI owns its private runtime, so it stays exact.
export function dshCompatibilityNotice(currentVersion = '', host = 'desktop') {
  if (host === 'cli') return `命令行版独立安装并使用 DSH ${adaptedDshVersion}，不复用或修改全局 DSH。`
  const allowed = allowedDshVersions.join('、')
  if (!currentVersion) return `允许的 DSH 版本：${allowed}；${hostGuidance(host)}`
  if (classifyDshVersion(currentVersion, compatibility).status === 'allowed') return `当前 DSH ${currentVersion} 在允许清单内。`
  // DSH 0.1.x hosts: the release for them lives on the stable branch (installed copies there update from it).
  const stable = /^0\.1\./.test(currentVersion) ? `\n要继续使用 DSH ${currentVersion}，请改装稳定版（跟随 stable 分支，安装命令见 ${STABLE_GUIDE}），重新运行一次即可，以后的更新跟随稳定版。` : ''
  return `当前 DSH ${currentVersion} 不在允许清单内；已停止安装，不会修改宿主版本。允许的版本：${allowed}；${hostGuidance(host)}${stable}`
}

export function assertCompatibleDshVersion(currentVersion, host = 'cli') {
  if (host === 'cli') {
    if (currentVersion === adaptedDshVersion) return
    throw new Error(`已停止安装：独立 DSH 版本不符，当前 ${currentVersion || '未知'}，应为 ${adaptedDshVersion}。请重新安装独立运行时：设置 DSH_TAVERN_REINSTALL_RUNTIME=1 后重试安装或更新。`)
  }
  if (classifyDshVersion(currentVersion, compatibility).status === 'allowed') return
  throw new Error(dshCompatibilityNotice(currentVersion, host))
}

// Installers run this from a temp directory whose path may be a symlink (macOS
// /var -> /private/var); compare real paths or the command silently does nothing.
let isEntryPoint = false
try { isEntryPoint = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch {}
if (isEntryPoint) {
  if (process.argv[2] === '--check') {
    const version = extractDshVersion(process.argv[4])
    assertCompatibleDshVersion(version, process.argv[3])
    if (process.argv[3] !== 'cli') console.log(dshCompatibilityNotice(version, process.argv[3]))
  } else {
    console.log(process.argv[2] === '--version' ? adaptedDshVersion : dshCompatibilityNotice('', process.argv[3] || 'desktop'))
  }
}
