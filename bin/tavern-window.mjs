// 酒馆独立窗口（桌面快捷方式「DSH 酒馆」调用）：桌面版用原版 DSH 时，另起一个进程加载酒馆配置，
// 在浏览器的应用窗口（Chrome / Edge 的 --app，没有就用默认浏览器）里打开。
import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DSH_ROOT, RUNTIME_HOST } from './launcher-environment.mjs'
import { browserOpenCommand, startService } from './service-lifecycle.mjs'

// 桌面版固定读 profiles/desktop；它链接到 tavern 时，桌面版本身就是酒馆，再起一份会同写一份存档。
export function desktopUsesTavern(root = DSH_ROOT) {
  try { return realpathSync(path.join(root, 'profiles', 'desktop')) === realpathSync(path.join(root, 'profiles', 'tavern')) } catch { return false }
}

export function appWindowBrowser(platform = process.platform, env = process.env, exists = existsSync, home = os.homedir()) {
  if (platform === 'darwin') {
    for (const name of ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium']) {
      for (const dir of ['/Applications', path.join(home, 'Applications')]) {
        const app = path.join(dir, name + '.app')
        if (exists(app)) return { command: 'open', args: url => ['-na', app, '--args', '--app=' + url] }
      }
    }
    return null
  }
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
    for (const relative of ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe']) {
      for (const root of roots) {
        const file = path.join(root, relative)
        if (exists(file)) return { command: file, args: url => ['--app=' + url] }
      }
    }
    return null
  }
  return null
}

function launch(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => {})
  child.unref()
}

export async function openTavernWindow() {
  if (RUNTIME_HOST !== 'desktop') throw new Error('「DSH 酒馆」快捷方式只用于桌面版；命令行版请用 dsh-tavern open。')
  if (desktopUsesTavern()) throw new Error('桌面版现在就是 DSH 酒馆，直接打开 DeepSeek Harness 即可。想让原版 DSH 和酒馆分成两个窗口，先在桌面版设置里点「原版DSH」。')
  const state = await startService()
  if (!state?.webUrl) throw new Error('酒馆已启动，但还没拿到访问地址，请稍后再点一次快捷方式。')
  const browser = appWindowBrowser()
  if (browser) launch(browser.command, browser.args(state.webUrl))
  else { const fallback = browserOpenCommand(state.webUrl); launch(fallback.command, fallback.args) }
}
