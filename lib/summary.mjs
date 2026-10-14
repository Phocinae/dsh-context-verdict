/**
 * What a session is holding that exists nowhere durable.
 *
 * This is the closed field set. Every name here is a field the state renderer can
 * emit, and **none of them can express a block**. That is G1 as a structural
 * property rather than a promise: there is no code path from a summary to a
 * per-block string, because no field carries one.
 *
 * The question being answered is session-level and decidable: *is there unlanded
 * state that a compaction would lose?* A todo that was written down, a file
 * changed but not committed, a question asked and not answered, a decision made
 * and not recorded — each is either present in the session's durable store or it
 * is not. Whether a given *part* of the context is "important" is the question
 * that was measured wrong, and it is not asked here.
 */

/** A todo is unlanded if it is not marked done in the session's own record. */
const DONE_STATES = new Set(['completed', 'done', 'cancelled', 'canceled'])

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

/**
 * A path may be recorded as a string, or as an object with a `path`/`file` field.
 * Both shapes appear in real transcripts, and normalising here keeps the field set
 * closed rather than leaking a union into the state.
 */
function pathOf(entry) {
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry !== 'object') return ''
  return String(entry.path ?? entry.file ?? entry.file_path ?? entry.filepath ?? '')
}

function whatOf(entry, fallback = '') {
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry !== 'object') return fallback
  return String(entry.what ?? entry.content ?? entry.text ?? entry.description ?? entry.title ?? fallback)
}

/**
 * Build the summary.
 *
 * `records` is the session transcript as parsed objects. Every reader below is
 * defensive: an unrecognised record contributes nothing rather than throwing,
 * because a transcript format that drifted should reduce what this tool sees, not
 * crash it. What it must never do is *invent* an item — an empty summary means
 * "nothing unlanded was found", and that is the answer the caller acts on.
 */
export function summarise(records, options = {}) {
  const session = {
    id: options.sessionId ?? null,
    turn: options.turn ?? null,
    step: options.step ?? null,
    cut: options.cut ?? null,
  }

  const todos = []
  const uncommitted = []
  const questions = []
  const decisions = []
  const nextSteps = []
  const riskHints = []

  for (const record of asArray(records)) {
    if (!record || typeof record !== 'object') continue
    const kind = String(record.kind ?? record.type ?? record.op ?? '').toLowerCase()

    // Todos. The session's own todo tool writes a list; the record may be the
    // whole list or a single entry.
    if (kind.includes('todo')) {
      const entries = asArray(record.items ?? record.todos ?? record.data ?? record)
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const state = String(entry.status ?? entry.state ?? '').toLowerCase()
        if (DONE_STATES.has(state)) continue
        const what = whatOf(entry)
        if (what.trim() === '') continue
        todos.push({ what, state: entry.status ?? entry.state ?? null })
      }
      continue
    }

    // Uncommitted work: a recorded write/edit to a path.
    if (kind.includes('write') || kind.includes('edit') || kind.includes('patch')) {
      const path = pathOf(record.args ?? record.data ?? record)
      if (path.trim() !== '') {
        uncommitted.push({ path, what: whatOf(record.args ?? record.data ?? record) })
      }
      continue
    }

    // An explicit uncommitted list, if the session records one.
    if (kind.includes('git') && kind.includes('status')) {
      const entries = asArray(record.files ?? record.data ?? [])
      for (const entry of entries) {
        const path = pathOf(entry)
        if (path.trim() !== '') uncommitted.push({ path, what: whatOf(entry) })
      }
      continue
    }

    if (kind.includes('question') || kind.includes('ask')) {
      const q = whatOf(record.args ?? record.data ?? record)
      if (q.trim() !== '') questions.push({ q })
      continue
    }

    if (kind.includes('decision') || kind.includes('decide')) {
      const text = whatOf(record.args ?? record.data ?? record)
      if (text.trim() !== '') decisions.push({ text })
      continue
    }

    if (kind.includes('next') || kind.includes('plan')) {
      const what = whatOf(record.args ?? record.data ?? record)
      if (what.trim() !== '') nextSteps.push({ what })
      continue
    }
  }

  // Risk hints are derived, and the derivation is stated rather than implied.
  // Each one names a count, so a reader can check the arithmetic.
  if (uncommitted.length > 0) {
    riskHints.push(`${uncommitted.length} file(s) changed and not committed`)
  }
  if (todos.length > 0) {
    riskHints.push(`${todos.length} todo(s) not done`)
  }
  if (questions.length > 0) {
    riskHints.push(`${questions.length} question(s) unanswered`)
  }

  const summary = {
    session,
    todos: dedupe(todos, (entry) => entry.what),
    uncommitted: dedupe(uncommitted, (entry) => entry.path),
    questions: dedupe(questions, (entry) => entry.q),
    decisions: dedupe(decisions, (entry) => entry.text),
    next_steps: dedupe(nextSteps, (entry) => entry.what),
    risk_hints: riskHints,
  }

  // The field set is closed, and this is where that stops being a comment. A key
  // outside the list means something added one, and the whole G1 argument rests on
  // no key being able to express a block.
  const ALLOWED = new Set([
    'session', 'todos', 'uncommitted', 'questions', 'decisions', 'next_steps',
    'risk_hints',
  ])
  for (const key of Object.keys(summary)) {
    if (!ALLOWED.has(key)) {
      throw new Error(
        `summarise produced a field outside the closed set: ${JSON.stringify(key)}. `
          + 'The closed set is what makes "no blocks in the model input" structural, '
          + 'so adding a field is a design change rather than a code change.',
      )
    }
  }

  return summary
}

function dedupe(entries, keyOf) {
  const seen = new Set()
  const out = []
  for (const entry of entries) {
    const key = keyOf(entry)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/**
 * The unlanded count, which is what the risk thresholds compare against.
 *
 * `decisions` is counted. It was omitted in 0.1.0 and that omission was a
 * false-negative in the dangerous direction: a decision is described above as one
 * of the things that is "either present in the session's durable store or it is
 * not", the renderer emits it in the `DECIDED` section, and the empty-summary
 * contract calls it unlanded state — but it was the one field the arithmetic did
 * not read. A session whose only unlanded work was recorded decisions therefore
 * produced `unlandedCount === 0`, which is the single value that makes
 * `decideLocally` answer `safe_to_compact` without asking anyone. The count and
 * the field set have to cover the same fields, or the summary reports work that
 * the verdict cannot see.
 */
export function unlandedCount(summary) {
  return summary.uncommitted.length + summary.todos.length
    + summary.questions.length + summary.decisions.length + summary.next_steps.length
}
