import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// The DSH chat view takes a turn's last step as its final answer (latestAnswer), but
// a step only gets reply content from an appended assistant message. When Tavern
// rewrites a settled reply, DSH no longer accepts the write in the closed step, so
// it lands in an edit step of its own that holds only the replacement. The view
// then sees no answer and folds the whole round as process (blank in compact view).
// Point latestAnswer at the last step that has reply content; a turn whose last step
// already has content is unaffected.
//
// Matched loosely on purpose: any DSH whose latestAnswer still reads the last step
// via `<turn>.steps.at(-1)` is patched, whatever the surrounding code or formatting.
const MARKER = '/* dsh-tavern:answer-step */'
const LATEST_ANSWER = /function\s+latestAnswer\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/g

function answerStep(turn) {
  // Plain loop: findLast is missing from older Android WebViews.
  return `${MARKER}((steps) => { if (!Array.isArray(steps)) return steps.at(-1); `
    + 'for (let index = steps.length - 1; index > 0; index--) { '
    + 'if (steps[index]?.data?.get?.("assistant-step")?.blocks?.length > 0) return steps[index]; } '
    + `return steps[0]; })(${turn}.steps)`
}

export function patchChatSource(text) {
  if (text.includes(MARKER)) return { status: 'patched', text }
  let patched = text
  let applied = 0
  // Back to front, so earlier offsets stay valid; a bundle may carry several copies.
  for (const match of [...text.matchAll(LATEST_ANSWER)].reverse()) {
    const turn = match[1]
    const bodyStart = match.index + match[0].length
    // Only the function's own opening statements: stop at the next function.
    const window = text.slice(bodyStart, bodyStart + 600)
    const end = window.search(/\n\s*function\s/)
    const target = new RegExp(`(?<![\\w$])${turn.replace(/\$/g, '\\$')}\\.steps\\.at\\(\\s*-1\\s*\\)`)
    const found = target.exec(end === -1 ? window : window.slice(0, end))
    if (!found) continue
    const at = bodyStart + found.index
    patched = patched.slice(0, at) + answerStep(turn) + patched.slice(at + found[0].length)
    applied++
  }
  return applied ? { status: 'applied', text: patched } : { status: 'unmatched', text }
}

/**
 * Patch the host chat client in place: true when written, false when already
 * patched, null when this DSH's chat view no longer has the shape (left untouched).
 */
export function patchChatAnswerStep(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-chat') throw new Error('回复步骤补丁仅适用于 dsh-client-ui-chat')
  const file = path.join(directory, 'lib', 'client.js')
  let before
  try { before = readFileSync(file, 'utf8') } catch { return null }
  const result = patchChatSource(before)
  if (result.status === 'unmatched') return null
  if (result.status === 'patched') return false
  writeFileSync(file, result.text)
  return true
}
