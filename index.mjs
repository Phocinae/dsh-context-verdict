/**
 * dsh-context-verdict — decide whether compaction would lose unlanded state.
 *
 * A per-block screener was **measured and rejected**: it judged the block holding
 * the actual fix as droppable with confidence 0.323, and a nursery rhyme as worth
 * keeping with 0.691. This plugin therefore answers a session-level question that
 * is decidable, and is structurally incapable of answering a per-block one.
 *
 * The constants live in `lib/constants.mjs` and are re-exported below. They are
 * defined once, there, because a second copy of `FORBIDDEN_KEYS` in this file would
 * be a copy that can drift from the one the gate actually reads — and a gate whose
 * constant has drifted is a gate that has stopped working while still passing its
 * own tests.
 */
import { resolveConfig } from './lib/config.mjs'
import { ContextVerdictError, PROGRAMMING_ERROR_CODES } from './lib/errors.mjs'
import { createTools } from './tools.mjs'
import { SKILL_NAME, createSkill } from './lib/skill.mjs'

export const PLUGIN_ID = 'context_verdict'
export const BUNDLE_NAME = 'dsh-context-verdict'

export {
  EXIT, FORBIDDEN_KEYS, STATE_SECTIONS, VERDICT_OPTIONS, DEFAULT_CONFIG,
} from './lib/constants.mjs'
export { resolveConfig } from './lib/config.mjs'
export { renderState, assertNoForbiddenKeys, checkStateTemplate } from './lib/state.mjs'
export { summarise, unlandedCount } from './lib/summary.mjs'
export { computeDigest, verifyDigest } from './lib/digest.mjs'
export {
  judge, decideLocally, interpret, assertVerdictShape, VERDICT_QUESTION, URGENCY_QUESTION,
} from './lib/judge.mjs'
export { verify, verifyExitCode, classifyCase, LABELS } from './lib/verify.mjs'
export { createTools, TOOL_NAMES, FORBIDDEN_TOOL_NAMES } from './tools.mjs'
export { SKILL_NAME, createSkill } from './lib/skill.mjs'
export { PROGRAMMING_ERROR_CODES, ContextVerdictError } from './lib/errors.mjs'

/**
 * Compose the plugin.
 *
 * Throws only for a context that cannot be honoured. A missing decision service is
 * never a load failure: it is a `wait` verdict with the reason stated.
 */
export function createPlugin(ctx, options = {}) {
  if (!ctx || typeof ctx.inject !== 'function') {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CONTEXT,
      'createPlugin needs a ctx with .inject(); the host did not supply one',
    )
  }
  const config = resolveConfig(options)
  const logger = typeof ctx.logger === 'object' && ctx.logger !== null ? ctx.logger : null
  const client = typeof options.client === 'function' ? options.client : null

  ctx.inject(['tools'], (toolCtx) => {
    for (const tool of createTools(config, logger, client)) {
      toolCtx.tools.register(tool)
    }
  })

  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.skills.register(createSkill(config))
  })

  return {
    config,
    toolNames: createTools(config, logger, client).map((tool) => tool.name),
  }
}

export default createPlugin
