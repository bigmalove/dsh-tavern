// Per-version prose ("swipes") on one Chat message.
//
// swipes[i] is the raw prose of version i; variables[i] and swipeStates[i]
// align with it by index. Legacy saves carry exactly one version and no
// states: a missing entry reads as "no snapshot", so no migration is needed.
// text/sourceText/projectionText/displayText/displayMode always describe the
// currently selected version (swipeId).

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function list(value) {
  return Array.isArray(value) ? value : []
}

/** Version count of one message; a message without swipes has exactly one. */
export function swipeCount(message) {
  return Math.max(list(message && message.swipes).length, 1)
}

/** The selected version index, clamped into range. */
export function selectedSwipe(message) {
  const count = swipeCount(message)
  return Math.max(0, Math.min(count - 1, Number(message && message.swipeId) || 0))
}

/** Raw prose of one version; only the selected version survives on legacy rows. */
export function swipeSource(message, index) {
  const swipes = list(message && message.swipes)
  if (swipes[index] !== undefined) return str(swipes[index])
  return index === selectedSwipe(message) ? str(message && (message.sourceText ?? message.text)) : ''
}

/** Aligned copy of the per-version MVU snapshots; missing entries read as null. */
export function swipeVariables(message) {
  const variables = list(message && message.variables).slice(0, swipeCount(message))
  while (variables.length < swipeCount(message)) variables.push(null)
  return variables
}

/** Aligned copy of the per-version settlement snapshots; null = never settled. */
export function swipeStates(message) {
  const count = swipeCount(message)
  const states = list(message && message.swipeStates).slice(0, count)
  while (states.length < count) states.push(null)
  return states
}

/** Record one version's settlement snapshot without touching the selection. */
export function withSwipeState(message, index, state) {
  const states = swipeStates(message)
  states[index] = state === undefined ? null : state
  return { ...message, swipeStates: states }
}

/** Append one version and select it; every parallel array grows together. */
export function appendSwipe(message, version = {}) {
  const count = swipeCount(message)
  const swipes = list(message.swipes).slice()
  while (swipes.length < count) swipes.push(swipeSource(message, swipes.length))
  swipes.push(str(version.source))
  const next = { ...message, swipes, swipeId: count }
  if (list(message.variables).length || version.variables !== undefined) {
    next.variables = swipeVariables(message).concat([version.variables === undefined ? null : version.variables])
  }
  if (list(message.swipeStates).length || version.state !== undefined) {
    next.swipeStates = swipeStates(message).concat([version.state === undefined ? null : version.state])
  }
  return next
}

/** Remove one version; the previous one becomes selected when it was current. */
export function removeSwipe(message, index) {
  const count = swipeCount(message)
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) throw new Error('正文版本不存在')
  const selected = selectedSwipe(message)
  const removed = {
    swipeId: index,
    source: swipeSource(message, index),
    variables: list(message.variables)[index] ?? null,
    state: list(message.swipeStates)[index] ?? null,
    wasSelected: index === selected
  }
  const swipes = list(message.swipes).slice()
  while (swipes.length < count) swipes.push(swipeSource(message, swipes.length))
  swipes.splice(index, 1)
  const next = { ...message, swipes, swipeId: index < selected ? selected - 1 : Math.min(selected, Math.max(swipes.length - 1, 0)) }
  if (list(message.variables).length) {
    const variables = swipeVariables(message)
    variables.splice(index, 1)
    next.variables = variables
  }
  if (list(message.swipeStates).length) {
    const states = swipeStates(message)
    states.splice(index, 1)
    next.swipeStates = states
  }
  return { message: next, removed }
}

/** Put a removed version back (undo of a deletion); selection follows the caller. */
export function insertSwipe(message, index, removed = {}) {
  const swipes = list(message.swipes).slice()
  swipes.splice(index, 0, str(removed.source))
  const next = { ...message, swipes }
  if (list(message.variables).length || removed.variables !== undefined) {
    const variables = swipeVariables(message)
    variables.splice(index, 0, removed.variables === undefined ? null : removed.variables)
    next.variables = variables
  }
  if (list(message.swipeStates).length || removed.state !== undefined) {
    const states = swipeStates(message)
    states.splice(index, 0, removed.state === undefined ? null : removed.state)
    next.swipeStates = states
  }
  return next
}
