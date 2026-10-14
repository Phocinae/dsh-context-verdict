/**
 * The three tools.
 *
 * Hand-built descriptors, so the plugin has no run-time dependency on the host's
 * tool helpers. The schema stays inside the harness's enforced subset: one scalar
 * `type` per node, `required` as an array of names, `oneOf` for unions, and no
 * author-only keywords such as a per-property `required: true`.
 *
 * The three names are the design's, and there is no fourth. That is gate G4: the
 * absence of a per-block command is part of the API surface, not a convention.
 */
import { summarise } from './lib/summary.mjs'
import { renderState, assertNoForbiddenKeys, checkStateTemplate } from './lib/state.mjs'
import { computeDigest } from './lib/digest.mjs'
import { judge } from './lib/judge.mjs'
import { VERDICT_OPTIONS } from './lib/constants.mjs'
import { verify, verifyExitCode } from './lib/verify.mjs'
import { ContextVerdictError, PROGRAMMING_ERROR_CODES } from './lib/errors.mjs'

const BUILD_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    records: {
      type: 'array',
      description: 'The session records to summarise, as parsed objects. Anything the '
        + 'reader does not recognise contributes nothing rather than throwing: a '
        + 'format that drifted should reduce what is seen, never invent an item.',
    },
    sessionId: { type: 'string', description: 'Session identifier, rendered into SESSION.' },
    turn: { type: 'number' },
    step: { type: 'number' },
    cut: { type: 'number', description: 'The cut sequence this state was taken at.' },
  },
  required: ['records'],
}

const BUILD_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    state: { type: 'string' },
    digest: { type: 'string' },
    stateLength: { type: 'number' },
    stateCharCap: { type: 'number' },
    withinBudget: { type: 'boolean' },
    unlanded: {
      type: 'object',
      additionalProperties: false,
      properties: {
        todos: { type: 'number' },
        uncommitted: { type: 'number' },
        questions: { type: 'number' },
        nextSteps: { type: 'number' },
        total: { type: 'number' },
      },
      required: ['todos', 'uncommitted', 'questions', 'nextSteps', 'total'],
    },
    note: { type: 'string' },
  },
  required: ['state', 'digest', 'stateLength', 'stateCharCap', 'withinBudget', 'unlanded', 'note'],
}

const STATE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: { type: 'array', items: { type: 'string' } },
    stateCharCap: { type: 'number' },
    riskSafeMax: { type: 'number' },
    riskWaitMin: { type: 'number' },
    serviceConfigured: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['verdicts', 'stateCharCap', 'riskSafeMax', 'riskWaitMin',
    'serviceConfigured', 'note'],
}

const JUDGE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    state: {
      type: 'string',
      description: 'A state produced by context_verdict_build. A state this project '
        + 'did not render is refused, because the digest will not match.',
    },
    digest: {
      type: 'string',
      description: 'The digest context_verdict_build returned alongside the state.',
    },
    summary: {
      type: 'object',
      description: 'The summary the state was rendered from, as context_verdict_build '
        + 'produced it.',
    },
  },
  required: ['state', 'digest', 'summary'],
}

const JUDGE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: VERDICT_OPTIONS.slice() },
    score: { type: 'number' },
    decidedBy: {
      type: 'string',
      enum: ['local', 'service', 'unavailable'],
    },
    reasonCodes: { type: 'array', items: { type: 'string' } },
    confidence: { oneOf: [{ type: 'number' }, { type: 'null' }] },
    questionsSent: { type: 'number' },
    serviceState: { type: 'string', enum: ['not_contacted', 'contacted', 'unreachable'] },
    // The state and digest are echoed so a caller can pair a verdict with what it
    // judged. They are the *input*, not a selection: nothing here names a part of
    // the context.
    state: { type: 'string' },
    digest: { type: 'string' },
    detail: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['verdict', 'score', 'decidedBy', 'reasonCodes', 'confidence',
    'questionsSent', 'serviceState', 'state', 'digest'],
}

/** A per-block tool would look like this. It must never exist. */
export const FORBIDDEN_TOOL_NAMES = Object.freeze([
  'context_verdict_screen', 'context_verdict_filter', 'context_verdict_pick',
  'context_verdict_select', 'context_verdict_drop', 'context_verdict_keep',
])

export function createTools(config, logger = null, client = null) {
  const tools = [
    {
      name: 'context_verdict_build',
      description:
        'Summarise a session into a state that records what is unlanded — todos not '
        + 'done, files changed and not committed, questions unanswered — and return it '
        + 'with the digest that binds it to the summary. Does not call a model. The '
        + 'state it produces can describe a session, never a part of one.',
      parameters: BUILD_PARAMETERS,
      output: { schema: BUILD_OUTPUT },
      async execute(input = {}) {
        const summary = summarise(input.records ?? [], {
          sessionId: input.sessionId,
          turn: input.turn,
          step: input.step,
          cut: input.cut,
        })
        const state = renderState(summary)
        assertNoForbiddenKeys(summary)
        const digest = computeDigest(state, summary)
        const withinBudget = state.length <= config.stateCharCap
        if (logger && typeof logger.info === 'function') {
          logger.info(`context_verdict_build: ${state.length} chars, within budget ${withinBudget}`)
        }
        return {
          state,
          digest,
          stateLength: state.length,
          stateCharCap: config.stateCharCap,
          withinBudget,
          unlanded: {
            todos: summary.todos.length,
            uncommitted: summary.uncommitted.length,
            questions: summary.questions.length,
            nextSteps: summary.next_steps.length,
            total: summary.todos.length + summary.uncommitted.length
              + summary.questions.length + summary.next_steps.length,
          },
          note: 'This state describes the session as a whole. It carries no field that '
            + 'could name a part of the context, so there is nothing here to select '
            + 'from even if a caller asked.',
        }
      },
    },
    {
      name: 'context_verdict_judge',
      description:
        'Judge whether a session may be compacted: "safe_to_compact", "wait", or '
        + '"preserve_first", plus a 2-10 urgency score. Accepts only a state produced '
        + 'by context_verdict_build, verified by digest. Never reports which parts of '
        + 'a context are important.',
      parameters: JUDGE_PARAMETERS,
      output: { schema: JUDGE_OUTPUT },
      async execute(input = {}) {
        const result = await judge({
          state: input.state,
          summary: input.summary,
          digest: input.digest,
          config,
          client,
        })
        // `detail` is optional; the schema declares it as either a string or null,
        // so it is always present rather than sometimes absent.
        return { ...result, detail: result.detail ?? null }
      },
    },
    {
      name: 'context_verdict_state',
      description:
        'Report the plugin\'s own configuration and the vocabulary it can return: the '
        + 'three verdicts, the state character budget, and the risk thresholds. No '
        + 'session is read and no service is contacted.',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      output: { schema: STATE_OUTPUT },
      async execute() {
        return {
          verdicts: VERDICT_OPTIONS.slice(),
          stateCharCap: config.stateCharCap,
          riskSafeMax: config.risk.safeMax,
          riskWaitMin: config.risk.waitMin,
          serviceConfigured: typeof client === 'function',
          note: 'Three verdicts only. There is no per-block mode, and there is no '
            + 'argument that would enable one: a per-block screener was measured '
            + 'judging a fix-bearing block droppable at confidence 0.323.',
        }
      },
    },
  ]

  // G4 as an assertion over the tool list itself. A per-block tool arriving here
  // would mean the API surface grew the capability the design forbids, and the
  // right moment to notice is before it is registered.
  for (const tool of tools) {
    if (FORBIDDEN_TOOL_NAMES.includes(tool.name)) {
      throw new ContextVerdictError(
        PROGRAMMING_ERROR_CODES.NO_PER_BLOCK_API,
        `a tool named ${JSON.stringify(tool.name)} would reintroduce per-block `
          + 'capability, which was measured wrong. Refusing to register it.',
        null,
        3,
      )
    }
  }

  return tools
}

/** Names this plugin registers. Three, and the list is the API surface. */
export const TOOL_NAMES = Object.freeze([
  'context_verdict_build',
  'context_verdict_judge',
  'context_verdict_state',
])

export { verify, verifyExitCode, checkStateTemplate }
