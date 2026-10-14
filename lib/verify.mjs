/**
 * The bidirectional check.
 *
 * `verify` runs a labelled corpus and reports two error rates, because a verdict
 * system can fail in two directions and only one of them is dangerous:
 *
 *  - **`lost` let through as `safe_to_compact`** — the dangerous direction. A
 *    session holding unlanded work is compacted and the work is gone. This is exit
 *    **1**, and it is the reason the project exists.
 *  - **`keep` refused** (a session with nothing at risk judged as anything but
 *    `safe_to_compact`) — the safe direction, and still a defect. A tool that
 *    always answers `preserve_first` never loses anything and is useless, so
 *    over-conservatism is counted and reported rather than congratulated.
 *
 * The corpus is labelled by construction: `lost` cases carry unlanded state,
 * `keep` cases do not. A corpus in which every case is one label verifies half the
 * property, so `verify` refuses to report on a single-labelled corpus — that
 * refusal is the difference between a check and a ritual.
 */
import { assertNoForbiddenKeys } from './state.mjs'
import { ContextVerdictError, PROGRAMMING_ERROR_CODES } from './errors.mjs'

export const LABELS = Object.freeze(['lost', 'keep'])

/**
 * Classify one decided case against its label.
 *
 * Returns `{ label, verdict, outcome }` where `outcome` is one of `ok`,
 * `lost_let_through`, `keep_refused`, or `skipped`.
 */
export function classifyCase(entry) {
  const label = entry?.label
  const verdict = entry?.verdict
  if (!LABELS.includes(label)) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CORPUS,
      `a corpus case has label ${JSON.stringify(label)}, which is not one of `
        + `${JSON.stringify(LABELS)}. An unlabelled case cannot be scored, and scoring `
        + 'it as either label would invent the answer.',
      null,
      3,
    )
  }
  if (verdict === 'skipped' || entry?.skipped === true) {
    // A case the service was not there to judge. Counted separately and never as a
    // pass: exit 0 with skips is a legitimate outcome, but it must be visible.
    return { label, verdict: 'skipped', outcome: 'skipped', id: entry?.id ?? null }
  }
  if (label === 'lost') {
    return {
      label,
      verdict,
      id: entry?.id ?? null,
      outcome: verdict === 'safe_to_compact' ? 'lost_let_through' : 'ok',
    }
  }
  return {
    label,
    verdict,
    id: entry?.id ?? null,
    outcome: verdict === 'safe_to_compact' ? 'ok' : 'keep_refused',
  }
}

/**
 * Verify a corpus of labelled cases.
 *
 * `cases` is `[{id, label, verdict, skipped?}]`. The verdict is supplied rather
 * than computed here so that `verify` can be run against a recorded ledger without
 * a service — which is how the offline acceptance works.
 */
export function verify(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CORPUS,
      'the corpus is empty, so nothing was verified. An empty scan is not a passing '
        + 'scan.',
      null,
      3,
    )
  }

  const scored = cases.map(classifyCase)
  assertNoForbiddenKeys(scored)

  const counts = {
    total: scored.length,
    ok: 0,
    lost_let_through: 0,
    keep_refused: 0,
    skipped: 0,
  }
  const byLabel = { lost: 0, keep: 0 }
  for (const entry of scored) {
    counts[entry.outcome] += 1
    byLabel[entry.label] += 1
  }

  // A single-labelled corpus verifies half the property. Refused rather than
  // reported, because "0 lost cases let through" over a corpus with no lost cases
  // is a true statement that means nothing.
  const missing = LABELS.filter((label) => byLabel[label] === 0)
  if (missing.length > 0) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CORPUS,
      `the corpus has no ${missing.join(' or ')} case, so it verifies only half the `
        + 'property. "No lost case was let through" over a corpus with no lost cases '
        + 'is true and meaningless, which is worse than a red check.',
      [`labels present: ${LABELS.filter((l) => byLabel[l] > 0).join(', ') || '(none)'}`,
       'a usable corpus needs both: a case that must be refused and a case that must be allowed'],
      3,
    )
  }

  const scoredOnly = counts.ok + counts.lost_let_through + counts.keep_refused
  const report = {
    counts,
    byLabel,
    lostLetThroughIds: scored.filter((e) => e.outcome === 'lost_let_through').map((e) => e.id),
    keepRefusedIds: scored.filter((e) => e.outcome === 'keep_refused').map((e) => e.id),
    skippedIds: scored.filter((e) => e.outcome === 'skipped').map((e) => e.id),
    lostLetThroughRate: byLabel.lost === 0 ? null : counts.lost_let_through / byLabel.lost,
    keepRefusedRate: byLabel.keep === 0 ? null : counts.keep_refused / byLabel.keep,
    // Stated so a reader does not have to infer it from the counts: a corpus where
    // every case skipped verified nothing, and exit 0 would otherwise read as a
    // clean run.
    allSkipped: scoredOnly === 0,
  }

  return { report, cases: scored }
}

/** Exit code for a verified corpus. */
export function verifyExitCode(report) {
  if (report.counts.lost_let_through > 0) return 1
  if (report.allSkipped) {
    // Every case skipped is a run that verified nothing. This is the one place the
    // design puts it at 0 rather than 3, and the reasoning is worth keeping: exit 0
    // means "no lost case was let through", and a check that did not run let
    // nothing through. It is reported as `allSkipped` so a caller can tell the
    // difference, and the design's own table says SKIP is counted and listed.
    return 0
  }
  return 0
}
