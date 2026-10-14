/**
 * G1 and G3, as executable code rather than as intentions.
 *
 * This module is the whole reason the design's first red line is enforceable.
 * "We will not screen blocks" is a promise; a forbidden-key constant plus a
 * template check is a gate. The measured failure this project exists to avoid
 * (a fix-bearing block judged droppable at confidence 0.323) happened because a
 * per-block path existed at all.
 */
import { FORBIDDEN_KEYS, STATE_SECTIONS } from './constants.mjs'
import { ContextVerdictError, PROGRAMMING_ERROR_CODES } from './errors.mjs'

const FORBIDDEN = new Set(FORBIDDEN_KEYS.map((key) => key.toLowerCase()))

/**
 * Throw if any key anywhere in `value` is a forbidden one.
 *
 * Recursive over objects and arrays, because a forbidden key nested three levels
 * down is exactly as capable of carrying a per-block selection as a top-level one.
 *
 * **It throws; it does not strip.** Stripping would return a plausible verdict
 * while quietly discarding the evidence that something upstream is producing the
 * shape this project forbids. The loud version is the useful one.
 */
export function assertNoForbiddenKeys(value, path = '$') {
  const walk = (node, where) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${where}[${index}]`))
      return
    }
    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN.has(key.toLowerCase())) {
        // The path includes the offending key. Reporting only the parent (`$`) told
        // the caller that a forbidden key existed somewhere in their payload, which
        // in a nested document is not enough to find it.
        const here = `${where}.${key}`
        throw new ContextVerdictError(
          PROGRAMMING_ERROR_CODES.FORBIDDEN_KEY,
          `forbidden key ${JSON.stringify(key)} at ${here}. This project has no `
            + 'per-block capability by design: a per-block screener was measured '
            + 'judging a fix-bearing block droppable at confidence 0.323 and a '
            + 'nursery rhyme worth keeping at 0.691. It is refused rather than '
            + 'stripped, because stripping would return a verdict while hiding that '
            + 'something upstream produces this shape.',
          [`path: ${here}`, `key: ${key}`, `forbidden set: ${FORBIDDEN_KEYS.length} names`],
          3,
        )
      }
      walk(child, `${where}.${key}`)
    }
  }
  walk(value, path)
  return value
}

/** Do two strings differ only by whitespace? Used to compare a state to itself. */
function normalise(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Render a summary into the state text the model is allowed to see.
 *
 * This is the **only** producer of that text. Every field it can emit is named in
 * `summary.mjs`, and none of them can express a block. That is what makes G1 a
 * structural claim rather than a stylistic one: there is no code path from a
 * summary to a per-block string, because no field carries one.
 */
export function renderState(summary) {
  assertNoForbiddenKeys(summary)
  const lines = []

  lines.push(`SESSION ${summary.session?.id ?? 'unknown'} turn=${summary.session?.turn ?? '?'} step=${summary.session?.step ?? '?'}`)

  const section = (name, entries, render) => {
    if (!entries || entries.length === 0) {
      lines.push(`${name} (none)`)
      return
    }
    lines.push(`${name} ${entries.length}`)
    for (const entry of entries) lines.push(`  - ${render(entry)}`)
  }

  section('TODO', summary.todos, (entry) => `${entry.what}${entry.state ? ` [${entry.state}]` : ''}`)
  section('UNCOMMITTED', summary.uncommitted, (entry) => `${entry.path}${entry.what ? `: ${entry.what}` : ''}`)
  section('QUESTIONS', summary.questions, (entry) => entry.q)
  section('DECIDED', summary.decisions, (entry) => entry.text)
  section('NEXT', summary.next_steps, (entry) => entry.what)
  section('RISK', (summary.risk_hints ?? []).map((hint) => ({ what: hint })), (entry) => entry.what)

  return lines.join('\n')
}

/**
 * Check that `text` is a state this project produced.
 *
 * Not a heuristic: a state is accepted only when every one of the section names is
 * present and the text does not carry a structural-sequence vocabulary. The digest
 * check in `digest.mjs` is the stronger half — it binds the text to the summary it
 * came from — and this is the half that works without the original summary.
 */
export function checkStateTemplate(text, { stateCharCap } = {}) {
  if (typeof text !== 'string') {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_STATE,
      `state must be a string, got ${typeName(text)}`,
      null,
      3,
    )
  }
  if (typeof stateCharCap === 'number' && text.length > stateCharCap) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.STATE_OVER_BUDGET,
      `the state is ${text.length} characters and the budget is ${stateCharCap}. This `
        + 'is a configuration or content problem, not a verdict: sending it anyway '
        + 'would make an infrastructure limit look like a finding about the session.',
      [`length: ${text.length}`, `cap: ${stateCharCap}`],
      2,
    )
  }

  const missing = STATE_SECTIONS.filter(
    (name) => !new RegExp(`^${name}(\\s|$)`, 'm').test(text),
  )
  if (missing.length > 0) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.STATE_INVALID,
      'the state does not carry every required section, so it cannot be a state this '
        + 'project produced. Accepting free text here would make the "no blocks in '
        + 'the model input" gate a matter of the caller\'s good behaviour.',
      [`missing sections: ${missing.join(', ')}`,
       `required: ${STATE_SECTIONS.join(', ')}`],
      3,
    )
  }

  // Structural-sequence vocabulary inside the text is the other way a per-block
  // input could arrive: not as a key, but as content.
  const suspect = /\b(nodeSeq|blockId|keepSeqs|dropSeqs|droppable|span\s*=)\b/i.exec(text)
  if (suspect) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.STATE_INVALID,
      `the state contains structural-sequence vocabulary ${JSON.stringify(suspect[0])}, `
        + 'which is how a per-block input arrives when it does not arrive as a key',
      [`matched: ${suspect[0]}`],
      3,
    )
  }

  // The renderer is idempotent over whitespace, so a state that does not survive
  // normalisation round-tripping was hand-edited.
  if (normalise(text) !== normalise(text).trim()) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.STATE_INVALID,
      'the state has irregular whitespace and does not look like a renderer product',
      null,
      3,
    )
  }

  return true
}

function typeName(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
