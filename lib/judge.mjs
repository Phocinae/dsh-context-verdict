/**
 * The verdict.
 *
 * G2 and G3 live here as executable shape checks rather than as conventions:
 *
 *  - exactly one `choice` question with **exactly three** fixed options, plus one
 *    `score`. Not a list of questions, not a variable number of options.
 *  - the output payload has no slot for a selection, and a forbidden key throws.
 *
 * There is a local, deterministic decision path. That is not a fallback for when
 * the service is missing: it is the primary answer for the cases the session's own
 * record already decides. A file changed and not committed makes compaction unsafe
 * as a matter of arithmetic, and asking a model would add a confidence interval to
 * a question that has a yes/no answer.
 */
import { VERDICT_OPTIONS } from './constants.mjs'
import { assertNoForbiddenKeys, checkStateTemplate } from './state.mjs'
import { ContextVerdictError, PROGRAMMING_ERROR_CODES } from './errors.mjs'
import { unlandedCount } from './summary.mjs'

/** The exact question the model is asked. One question, three options. */
export const VERDICT_QUESTION = Object.freeze({
  id: 'compaction_verdict',
  type: 'choice',
  options: VERDICT_OPTIONS,
  text: 'This session may be compacted. Given the recorded unlanded state, what should '
    + 'happen? Choose "safe_to_compact" if nothing recorded would be lost, "wait" if '
    + 'the state is incomplete or unclear, or "preserve_first" if recorded work exists '
    + 'nowhere durable and must be persisted first.',
})

/** The secondary scale. A 2..10 urgency score, and it never decides alone. */
export const URGENCY_QUESTION = Object.freeze({
  id: 'urgency',
  type: 'score',
  text: 'How urgently must the unlanded state be dealt with before compaction? '
    + '2 means nothing is at risk, 10 means work is lost if compaction runs now.',
})

/**
 * Assert the request shape is the only shape this project can send.
 *
 * Called before any request is made, so a drift in the question builder is a
 * load-time failure rather than a request that quietly asks something else.
 */
export function assertVerdictShape(questions) {
  const choices = questions.filter((q) => q.type === 'choice')
  const scores = questions.filter((q) => q.type === 'score')
  if (choices.length !== 1) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_VERDICT_SHAPE,
      `the request must carry exactly one choice question, got ${choices.length}. More `
        + 'than one is how a per-item verdict gets asked for one item at a time.',
      null,
      3,
    )
  }
  if (scores.length > 1) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_VERDICT_SHAPE,
      `the request must carry at most one score question, got ${scores.length}`,
      null,
      3,
    )
  }
  const [choice] = choices
  const options = choice.options ?? []
  if (options.length !== VERDICT_OPTIONS.length) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_VERDICT_SHAPE,
      `the choice question must carry exactly ${VERDICT_OPTIONS.length} options, got `
        + `${options.length}. The verdict vocabulary is fixed; a request with more or `
        + 'fewer is asking a different question.',
      [`got: ${JSON.stringify(options)}`, `expected: ${JSON.stringify(VERDICT_OPTIONS)}`],
      3,
    )
  }
  for (const [index, expected] of VERDICT_OPTIONS.entries()) {
    if (options[index] !== expected) {
      throw new ContextVerdictError(
        PROGRAMMING_ERROR_CODES.BAD_VERDICT_SHAPE,
        `option ${index} is ${JSON.stringify(options[index])} and must be `
          + `${JSON.stringify(expected)} verbatim`,
        null,
        3,
      )
    }
  }
  return questions
}

/**
 * Decide from the session's own record, with no model.
 *
 * Returns `null` when the record does not decide the question, which is the signal
 * to ask the service. Returning a verdict here for a case the record cannot settle
 * would be the prefilter guessing, and this project's whole subject is what happens
 * when a screener guesses.
 */
export function decideLocally(summary, config) {
  const unlanded = unlandedCount(summary)

  if (unlanded === 0) {
    // Nothing recorded is unlanded. Note this is a statement about what was
    // *recorded*: a session holding work in a form the transcript does not capture
    // would look identical, and that limit is stated in the README rather than
    // papered over.
    return {
      verdict: 'safe_to_compact',
      score: 2,
      decidedBy: 'local',
      reasonCodes: ['NO_UNLANDED_STATE_RECORDED'],
      confidence: null,
    }
  }
  if (unlanded > config.risk.safeMax && unlanded < config.risk.waitMin) {
    return null
  }
  if (unlanded >= config.risk.waitMin) {
    return {
      verdict: 'preserve_first',
      score: unlanded > 10 ? 10 : Math.max(2, unlanded),
      decidedBy: 'local',
      reasonCodes: ['UNLANDED_STATE_EXCEEDS_SAFE_MAX'],
      confidence: null,
    }
  }
  // Between 1 and safeMax inclusive: the record shows something unlanded but not
  // enough to be conclusive, so this is the band the service exists for.
  return null
}

/**
 * Judge a state.
 *
 * The order is the design's, and each step exists because skipping it was a
 * failure mode someone measured:
 *
 *  1. the state must be a renderer product (template), then
 *  2. bound to its summary (digest), then
 *  3. the shape of what we would send must be the only shape we send, then
 *  4. the local record decides if it can, and only then
 *  5. the service is asked — and if it is not there, the answer is `wait`.
 */
export async function judge({ state, summary, digest, config, client = null }) {
  checkStateTemplate(state, { stateCharCap: config.stateCharCap })
  assertNoForbiddenKeys({ state, summary, digest })

  if (digest !== undefined && digest !== null) {
    const { verifyDigest } = await import('./digest.mjs')
    verifyDigest(state, summary, digest)
  } else {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.DIGEST_MISMATCH,
      'judge was given a state with no digest. The state\'s only producer is the '
        + 'renderer, and the digest is what says so; without it the "no blocks in the '
        + 'model input" gate rests on the caller\'s good behaviour.',
      null,
      3,
    )
  }

  const questions = assertVerdictShape([VERDICT_QUESTION, URGENCY_QUESTION])

  const local = decideLocally(summary, config)
  if (local) {
    return finish({
      ...local,
      questionsSent: 0,
      serviceState: 'not_contacted',
      state,
      digest,
    })
  }

  if (typeof client !== 'function') {
    // No way to ask. `wait` rather than `safe_to_compact`: the record shows
    // unlanded state, and this project never treats "I could not decide" as
    // permission to compact.
    return finish({
      verdict: 'wait',
      score: 2,
      decidedBy: 'unavailable',
      reasonCodes: ['SERVICE_NOT_CONFIGURED', 'UNLANDED_STATE_UNDECIDED'],
      confidence: null,
      questionsSent: 0,
      serviceState: 'not_contacted',
      state,
      digest,
    })
  }

  let response
  try {
    response = await client({ questions, state, timeoutMs: config.timeoutMs })
  } catch (error) {
    return finish({
      verdict: 'wait',
      score: 2,
      decidedBy: 'unavailable',
      reasonCodes: ['SERVICE_UNREACHABLE', 'UNLANDED_STATE_UNDECIDED'],
      confidence: null,
      detail: String(error && error.message ? error.message : error),
      questionsSent: questions.length,
      serviceState: 'unreachable',
      state,
      digest,
    })
  }

  return finish({
    ...interpret(response),
    questionsSent: questions.length,
    serviceState: 'contacted',
    state,
    digest,
  })
}

/**
 * Interpret a service response, refusing to guess.
 *
 * An answer outside the three options is not coerced to `wait`. Coercion would
 * turn a broken service into a plausible verdict, and the value of `wait` as a
 * signal depends on it meaning something specific.
 */
export function interpret(response) {
  const answer = response?.answer ?? response?.choice ?? response?.verdict
  if (!VERDICT_OPTIONS.includes(answer)) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_VERDICT_SHAPE,
      `the service answered ${JSON.stringify(answer)}, which is not one of `
        + `${JSON.stringify(VERDICT_OPTIONS)}. Coercing it to "wait" would turn a `
        + 'broken service into a plausible verdict.',
      null,
      3,
    )
  }
  const raw = response?.score
  const score = Number.isInteger(raw) && raw >= 2 && raw <= 10 ? raw : 2
  return {
    verdict: answer,
    score,
    decidedBy: 'service',
    reasonCodes: [answer === 'safe_to_compact' ? 'SERVICE_SAYS_SAFE' : 'SERVICE_SAYS_NOT_SAFE'],
    confidence: typeof response?.confidence === 'number' ? response.confidence : null,
  }
}

function finish(result) {
  // The last line of defence for G3. Whatever produced the result, the object that
  // leaves this module carries no key that could express a selection.
  assertNoForbiddenKeys(result)
  return result
}
