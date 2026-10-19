import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { updateSourceUrls } from '../tavern-plugin/lib/application-updater.js'

// 安装脚本拉的仓库、更新检查读的仓库、版本记录查的仓库必须是同一个。
// 换仓时最容易漏的就是「脚本改了、检查没改」——手机就会一直提示有更新，
// 点更新拉的是另一个仓库，版本号永远不变。
const REPOSITORY = 'bigmalove/dsh-tavern'

async function text(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8')
}

test('更新检查默认读安装源仓库，而不是上游', () => {
  const urls = updateSourceUrls()
  assert.equal(urls.repository, REPOSITORY)
  assert.match(urls.version, new RegExp(`raw\\.githubusercontent\\.com/${REPOSITORY}/main/package\\.json$`))
  assert.match(urls.commit, new RegExp(`api\\.github\\.com/repos/${REPOSITORY}/commits/main$`))
  assert.match(urls.compare, new RegExp(`api\\.github\\.com/repos/${REPOSITORY}/compare$`))
  assert.match(urls.cdnMetadata, new RegExp(`cdn\\.jsdelivr\\.net/gh/${REPOSITORY}@main/dsh-tavern-runtime\\.json$`))
  assert.equal(urls.repository.includes('flizzywine'), false, '默认值不能仍指向上游')
})

test('DSH_TAVERN_REPOSITORY 覆盖归一化：完整 URL、git 后缀、空值', () => {
  for (const value of ['https://github.com/o/r.git', 'git@github.com:o/r.git', ' o/r ', '/o/r/']) {
    assert.equal(updateSourceUrls(value).repository, 'o/r', value)
  }
  for (const value of ['', '   ', 'not a repo', 'https://gitlab.com/o/r']) {
    assert.equal(updateSourceUrls(value).repository, REPOSITORY, `无效值回退默认：${value}`)
  }
})

test('安装脚本与更新检查共用同一个默认仓库', async () => {
  const [installSh, installPs1, androidSetup, launcher] = await Promise.all([
    text('install.sh'), text('install.ps1'), text('android/setup.sh'), text('bin/launcher-environment.mjs'),
  ])
  assert.match(installSh, new RegExp(`REPOSITORY=\\$\\{DSH_TAVERN_REPOSITORY:-${REPOSITORY}\\}`))
  assert.match(installPs1, new RegExp(`'${REPOSITORY}'`))
  assert.match(androidSetup, new RegExp(`DEFAULT_REPOSITORY="https://github\\.com/${REPOSITORY}\\.git"`))
  // The branch reaches the tarball URL through ${BRANCH} (default main), so assert the
  // repository is pinned there instead of expecting a literal /main suffix.
  assert.match(androidSetup, new RegExp(`DEFAULT_TARBALL_URL="https://codeload\\.github\\.com/${REPOSITORY}/tar\\.gz/refs/heads/(?:main|\\$\\{BRANCH\\})"`))
  assert.match(androidSetup, /^BRANCH="\$\{DSH_TAVERN_BRANCH:-main\}"$/m, '安卓脚本的分支默认仍是 main')
  assert.match(launcher, /DSH_TAVERN_REPOSITORY/)
  assert.equal(/flizzywine/.test([installSh, installPs1, androidSetup, launcher].join('\n')), false, '安装链路不应再出现上游仓库')
})
