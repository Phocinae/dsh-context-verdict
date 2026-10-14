/**
 * The digest: what makes G1 enforceable rather than advisory.
 *
 * The design's own review found the hole this closes. Gate G1 says "the state sent
 * to the model may only come from the renderer" — but if `judge` accepts a `state`
 * as free text, then any caller (including a model) can concatenate thirty blocks
 * into a string that happens to contain the section names and hand it over. The
 * gate would then be a matter of the caller's good behaviour, which is the thing a
 * structural gate exists to avoid.
 *
 * So a state is paired with a digest at render time, and `judge` accepts only a
 * state whose digest checks out. The digest covers the rendered text **and the
 * summary it came from**, so editing either one invalidates it.
 *
 * This is an integrity check, not a security control, and the difference is worth
 * stating: anyone can recompute a digest. What it prevents is the accidental case —
 * a caller assembling their own state, or an old state drifting out of sync with
 * its summary — and it makes the bypass deliberate rather than incidental.
 */
import { createHash } from 'node:crypto'
import { ContextVerdictError, PROGRAMMING_ERROR_CODES } from './errors.mjs'

/** Stable JSON: sorted keys, so the digest does not depend on insertion order. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

/**
 * Compute the digest of a rendered state plus its summary.
 *
 * Both, not just the text: a state is only meaningful together with the summary it
 * was rendered from, and digesting the text alone would let a caller pair a
 * legitimate state with an unrelated summary.
 */
export function computeDigest(stateText, summary) {
  const payload = canonical({ state: stateText, summary })
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`
}

/**
 * Verify a state/digest/summary triple.
 *
 * Every failure is exit 3 and names which of the three did not match, because the
 * three have different remedies: a wrong digest means the state was edited, a
 * missing summary means the caller kept only half the pair, and a mismatch means
 * the two were never a pair.
 */
export function verifyDigest(stateText, summary, digest) {
  if (typeof stateText !== 'string' || stateText === '') {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_STATE, 'no state text was supplied', null, 3)
  }
  if (!summary || typeof summary !== 'object') {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.DIGEST_MISMATCH,
      'the state arrived without the summary it was rendered from. A state and its '
        + 'summary are a pair: the digest covers both, so half of it cannot be '
        + 'verified and half of it is not enough to judge.',
      null,
      3,
    )
  }
  if (typeof digest !== 'string' || digest === '') {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.DIGEST_MISMATCH,
      'the state arrived without a digest, so there is no way to tell whether this '
        + 'project produced it. Accepting it would make the "no blocks in the model '
        + 'input" gate a matter of the caller\'s good behaviour.',
      null,
      3,
    )
  }
  const expected = computeDigest(stateText, summary)
  if (expected !== digest) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.DIGEST_MISMATCH,
      'the digest does not match the state and summary. Either the state was edited '
        + 'after rendering or it was paired with a different summary; both mean this '
        + 'text is not a renderer product.',
      [`expected: ${expected}`, `received: ${digest}`],
      3,
    )
  }
  return true
}
