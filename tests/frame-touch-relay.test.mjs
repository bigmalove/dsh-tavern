import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// 生成的正文渲染在消息 iframe 里（消息文档高度 = 内容高度，帧内没有可滚区域），
// 而导入的历史是宿主 markdown，直接在会话滚动容器里。浏览器不会把一个
// sandbox 帧的拖动链到父文档的原生滚动（也拿不到惯性），所以只有帧内有接力时，
// 落在正文上的拖动才会滚动会话 —— 这正是「导入的长对话能快滑、正式生成的不能」。
const source = await readFile(new URL('../tavern-plugin/src/client/modules/frame-touch-scroll.js', import.meta.url), 'utf8')

function body(name) {
  const start = source.indexOf('function ' + name + '(')
  assert.ok(start >= 0, `缺少 ${name}`)
  let depth = 0
  let index = source.indexOf('{', start)
  for (; index < source.length; index++) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') { depth -= 1; if (depth === 0) break }
  }
  return source.slice(start, index + 1)
}

test('正文帧自己滚不动时把拖动接力给会话区', () => {
  const touch = body('installTavernFrameTouch')
  assert.match(touch, /function scrollsItself\(/, '需要探测帧内是否真有可滚区域')
  assert.match(touch, /scrollsItself\(target\)/, '起手时判定帧内可滚性')
  assert.match(touch, /relay: !own/, '帧内滚不动就标记为接力手势')
  assert.match(touch, /if \(g\.relay\) relay\(dy\)/, '接力手势逐帧把位移发给宿主')
  // 帧内可自己滚（卡片自带滚动容器）时必须保留原生滚动与惯性。
  assert.match(touch, /else scrollChain\(g\.target, dy, view\)/, '帧内可滚时走原生滚动链')
})

test('接力手势松手后有惯性，且不是靠常驻非 passive 监听换来的', () => {
  const touch = body('installTavernFrameTouch')
  const inertia = touch.slice(touch.indexOf("addEventListener('touchend'"))
  assert.match(inertia, /g\.relay/, '只有接力手势才需要模拟惯性')
  assert.match(inertia, /requestAnimationFrame\(step\)/, '惯性逐帧延续')
  assert.match(inertia, /speed \*=/, '惯性需要逐帧衰减')
  // 常驻的 document 级非 passive touchmove 会让帧内每次滚动都先等 JS。
  assert.equal((touch.match(/addEventListener\('touchmove', [^,]+, \{ passive: false \}\)/g) || []).length, 1,
    '只允许一处非 passive 注册，且必须是按手势动态挂上的 claim')
  assert.match(touch, /if \(claim\) addEventListener\('touchmove', claim/, 'claim 只在接力手势开始时挂上')
})

test('自建的 preventDefault 不会被当成别人接管而中断手势', () => {
  const touch = body('installTavernFrameTouch')
  assert.match(touch, /let gesture = null, animation = 0, sequence = 0, claim = null, claimed = false/)
  assert.match(touch, /claimed = true/, 'claim 里要留下“是我们自己取消的”标记')
  assert.match(touch, /event\.defaultPrevented && !claimed/, '只对其他 handler 的取消让路')
})

test('宿主的滚动链每次手势只解析一次，且不再限幅到 1000px', () => {
  const relay = body('createTavernTouchRelay')
  assert.match(relay, /chain: null/, '手势开始时还没有解析滚动链')
  assert.match(relay, /if \(active\.chain === null\) active\.chain = resolveTavernScrollChain/, '一次手势解析一次')
  assert.doesNotMatch(relay, /Math\.max\(-1000/, '旧的 1000px 限幅会让快甩丢帧')
  assert.match(relay, /Math\.max\(-4000, Math\.min\(4000, data\.dy\)\)/, '保留一个足够大的安全上限')
})
