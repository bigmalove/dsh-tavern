import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// 宿主的尾行是单独一行（复制/分支/用时/时间），正文藏掉它不会跟着走。
// 单条删除后必须只藏尾行，玩家输入与同回合其它楼层不动。
const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('function createTurnHistoryProjection(')
const end = source.indexOf('function applyBodyRegenerationResult(')
assert.ok(start > 0 && end > start, 'client.js 结构已变化，测试切片需要更新')
const component = source.slice(start, end)
assert.ok(component.includes('applyDeletedReplyTurns'), '缺少尾行隐藏逻辑')

// 极简 DOM：行对象只需要 getAttribute / style / querySelector / previousElementSibling。
function row(attributes, options = {}) {
  const node = {
    style: {
      display: options.display || '',
      setProperty(name, value, priority) { if (name === 'display') this.display = value; this.priority = priority },
      getPropertyPriority() { return this.priority || '' },
      removeProperty(name) { if (name === 'display') this.display = '' }
    },
    hidden: Boolean(options.hidden),
    attributes,
    getAttribute(name) { return Object.hasOwn(attributes, name) ? attributes[name] : null },
    querySelector(selector) { return options.inner ? options.inner(selector) : null },
    previousElementSibling: null
  }
  return node
}

function document_(rows) {
  return {
    querySelectorAll(selector) {
      // 测试只需要区分这两类选择器；尾行两条都算。
      if (selector.includes('turn-tail') || selector.includes('data-turn-tail')) {
        return rows.filter(item => Object.hasOwn(item.attributes, 'data-chat-flow-kind') && item.attributes['data-chat-flow-kind'] === 'turn-tail'
          || Object.hasOwn(item.attributes, 'data-turn-tail'))
      }
      if (selector === '[data-chat-turn]') return rows.filter(item => Object.hasOwn(item.attributes, 'data-chat-turn'))
      return []
    }
  }
}

function harness(rows) {
  const context = {
    window: { localStorage: { getItem: () => null, setItem: () => {} } },
    document: document_(rows),
    Object, Set, Map, JSON, Number, String, Array, Boolean
  }
  const factory = vm.runInNewContext(component + '; createTurnHistoryProjection({ root: function () { return document; } })', context)
  return factory
}

test('删掉最新回复：只藏这一回合的尾行，玩家输入与其它楼层保留', () => {
  const userRow = row({ 'data-chat-flow-kind': 'user', 'data-chat-turn': '3' })
  const bodyRow = row({ 'data-chat-flow-kind': 'assistant', 'data-chat-turn': '3' })
  const tail = row({ 'data-chat-flow-kind': 'turn-tail', 'data-turn-tail': '3' })
  const earlierTail = row({ 'data-chat-flow-kind': 'turn-tail', 'data-turn-tail': '2' })
  const rows = [userRow, bodyRow, tail, earlierTail]
  const projection = harness(rows)
  projection.apply('session', [], {}, [3])
  assert.equal(tail.style.display, 'none', '被删回合的尾行要藏掉')
  assert.equal(earlierTail.style.display, '', '别的回合不受影响')
  assert.equal(userRow.style.display, '', '玩家输入不能一起藏')
  assert.equal(bodyRow.style.display, '', '同回合其它楼层不能一起藏')
})

test('撤销删除后尾行重新显示', () => {
  const tail = row({ 'data-chat-flow-kind': 'turn-tail', 'data-turn-tail': '3' })
  const projection = harness([tail])
  projection.apply('session', [], {}, [3])
  assert.equal(tail.style.display, 'none')
  projection.apply('session', [], {}, [])
  assert.equal(tail.style.display, '', '撤销后必须恢复')
})

test('没有删除时不碰任何尾行', () => {
  const tail = row({ 'data-chat-flow-kind': 'turn-tail', 'data-turn-tail': '3' })
  const projection = harness([tail])
  projection.apply('session', [], {})
  assert.equal(tail.style.display, '')
  projection.apply('session', [], {}, [])
  assert.equal(tail.style.display, '')
})

// 页面上的回合编号与存档里的并不总是同一套（重新生成过就会分叉）。正文被删掉时
// 会留一个不可见标记，尾行按 DOM 邻接认它，编号对不上也能藏。
function linked(rows) {
  rows.forEach(function (item, index) { item.previousElementSibling = index > 0 ? rows[index - 1] : null })
  return rows
}

test('编号对不上时，靠正文的删除标记仍然藏掉尾行', () => {
  const user = row({ 'data-chat-flow-kind': 'user', 'data-chat-turn': '9' })
  const body = row({ 'data-chat-flow-kind': 'assistant', 'data-chat-turn': '9' }, {
    inner: selector => selector === '[data-tavern-deleted-floor]' ? { marker: true } : null
  })
  const tail = row({ 'data-chat-flow-kind': 'turn-tail', 'data-turn-tail': '9' })
  const rows = linked([user, body, tail])
  const projection = harness(rows)
  // 服务端给的是 3（剧情编号），页面上是 9：编号匹配必然落空。
  projection.apply('session', [], {}, [3])
  assert.equal(tail.style.display, 'none', '正文已删，尾行必须跟着藏')
  assert.equal(user.style.display, '', '玩家输入不动')
})

test('删的是较早步骤时，尾行仍归最后一条，不能藏', () => {
  const user = row({ 'data-chat-flow-kind': 'user', 'data-chat-turn': '4' })
  const middle = row({ 'data-chat-flow-kind': 'assistant', 'data-chat-turn': '4' }, {
    inner: selector => selector === '[data-tavern-deleted-floor]' ? { marker: true } : null
  })
  const answer = row({ 'data-chat-flow-kind': 'assistant', 'data-chat-turn': '4' }, { inner: () => null })
  const tail = row({ 'data-chat-flow-kind': 'turn-tail', 'data-turn-tail': '4' })
  const rows = linked([user, middle, answer, tail])
  const projection = harness(rows)
  projection.apply('session', [], {}, [])
  assert.equal(tail.style.display, '', '最后一条还在，尾行要留着')
  assert.notEqual(middle.style.display, 'none', '这一步本身不归尾行管')
})

test('撤销后正文标记消失，尾行自动恢复', () => {
  let marked = true
  const body = row({ 'data-chat-flow-kind': 'assistant', 'data-chat-turn': '2' }, {
    inner: selector => selector === '[data-tavern-deleted-floor]' && marked ? { marker: true } : null
  })
  const tail = row({ 'data-chat-flow-kind': 'turn-tail', 'data-turn-tail': '2' })
  const rows = linked([body, tail])
  const projection = harness(rows)
  projection.apply('session', [], {}, [2])
  assert.equal(tail.style.display, 'none')
  marked = false
  projection.apply('session', [], {}, [])
  assert.equal(tail.style.display, '', '撤销删除后尾行要回来')
})
