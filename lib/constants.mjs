/**
 * dsh-context-verdict — decide whether compaction would lose unlanded state.
 *
 * ## The measurement this project is built around
 *
 * A per-block "is this block droppable?" screener was **measured, and rejected**.
 * On the same corpus it judged a block containing the actual fix as droppable with
 * confidence 0.323, and a nursery rhyme as worth keeping with 0.691. It produced
 * the most expensive error class (dropping the load-bearing block) and pure noise,
 * on the same data, in the same run.
 *
 * So this plugin does not screen blocks. It answers a **session-level** question
 * that is decidable: *is there unlanded state that a compaction would lose?* That
 * is a yes/no about whether the session holds work existing nowhere durable — not a
 * per-block judgement about which parts of it look important.
 *
 * ## The four structural gates
 *
 * "We do not write that loop" is a promise, and the measurement above is what
 * happens when a promise is all you have. So the absence of per-block capability is
 * enforced by structure, and every gate has an executable assertion over it:
 *
 *  - **G1 — no blocks in the model's input.** The state is produced by exactly one
 *    renderer from a closed field set, and `judge` accepts only a state bound to its
 *    summary by digest, so a caller cannot bypass the renderer.
 *  - **G2 — three values plus one scale.** One `choice` with exactly three fixed
 *    options, plus one `score`.
 *  - **G3 — no slot for a selection.** `FORBIDDEN_KEYS` is a constant and a payload
 *    carrying one **throws** rather than being stripped.
 *  - **G4 — no per-block API surface.** Three tools, none of which can return a
 *    per-item choice.
 */

export const PLUGIN_ID = 'context_verdict'
export const BUNDLE_NAME = 'dsh-context-verdict'

/**
 * The section names every state must contain, verbatim.
 *
 * This is what makes `judge`'s input a template rather than free text: a state
 * missing any of these is refused, so a caller cannot hand in an arbitrary blob.
 */
export const STATE_SECTIONS = Object.freeze([
  'SESSION',
  'TODO',
  'UNCOMMITTED',
  'QUESTIONS',
  'DECIDED',
  'NEXT',
  'RISK',
])

/**
 * Key names that would reintroduce per-block capability.
 *
 * Checked recursively against every payload this project emits or accepts. **The
 * response is to throw, not to strip.** A payload carrying `perBlock` is not a
 * payload to be cleaned up; it is evidence that something upstream produces the
 * shape this project exists to avoid, and silently removing the key would hide that
 * while still returning a plausible verdict.
 *
 * The list is deliberately broad. A name that *could* identify a unit of context
 * counts, because a false positive here is a loud failure and a false negative is
 * the measured 0.323 failure.
 */
export const FORBIDDEN_KEYS = Object.freeze([
  'perBlock', 'perNode', 'perItem', 'perChunk', 'perSegment',
  'blocks', 'nodes', 'chunks', 'segments',
  'selectedSeqs', 'keepSeqs', 'dropSeqs',
  'droppable', 'keep', 'drop', 'keepIds', 'dropIds',
  'blockId', 'nodeSeq', 'nodeSeqs', 'blockSeq', 'span', 'spans',
  'screen', 'screened', 'screening', 'filter', 'filtered', 'pick', 'picked',
  'selection', 'selected', 'chosen', 'survivors', 'evicted',
])

/** The three verdicts, verbatim and in order. Exactly three, never more. */
export const VERDICT_OPTIONS = Object.freeze(['safe_to_compact', 'wait', 'preserve_first'])

/**
 * Exit codes.
 *
 *  0  no `lost` case was let through as safe_to_compact
 *  1  a `lost` case WAS judged safe_to_compact (the bidirectional check went red)
 *  2  the state exceeded its character budget
 *  3  usage, configuration or input error
 *
 * A "the service is not there" run is exit 0 with every case counted as SKIP. That
 * is deliberate: exit 0 means "nothing was let through", and a check that did not
 * run let nothing through. SKIP is counted and listed separately so the distinction
 * survives into the report.
 */
export const EXIT = Object.freeze({
  CLEAN: 0,
  LOST_LET_THROUGH: 1,
  STATE_OVER_BUDGET: 2,
  USAGE: 3,
})

export const DEFAULT_CONFIG = Object.freeze({
  // The state character budget. Exceeding it is exit 2 and not a verdict: a state
  // too large to send is a configuration or content problem, and reporting it as
  // "unsafe to compact" would make an infrastructure limit look like a finding.
  stateCharCap: 4096,
  endpoint: 'http://127.0.0.1:8787',
  timeoutMs: 20000,
  // The escalation threshold, kept compatible with the family's other members.
  // This project's primary judgement is the three-value choice; the score is a
  // secondary scale and never decides on its own. `tau` is therefore inert here --
  // accepted and validated so a shared profile still loads, read by nothing. See
  // the note in lib/config.mjs; it is not a connected control in this project.
  tau: null,
  // A session with at least `waitMin` unlanded items is `preserve_first`; the band
  // between `safeMax` and `waitMin` is where the local rules decline and the
  // service is asked.
  risk: { safeMax: 3, waitMin: 4 },
})
