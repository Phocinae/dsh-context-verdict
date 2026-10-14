/**
 * The bundled skill.
 *
 * Generated from the live configuration and the fixed vocabulary. Written out
 * rather than assembled from fragments because the one thing this skill has to
 * communicate is a **negative** — what the tool cannot be asked to do — and a
 * negative is the easiest thing to lose in a summary.
 */
import { VERDICT_OPTIONS, FORBIDDEN_KEYS, STATE_SECTIONS } from './constants.mjs'

export const SKILL_NAME = 'context-verdict'

export function createSkill(config) {
  const body = `# context-verdict — one verdict for the whole session

Before a long session is compacted, this asks a question that has a yes/no answer:

> **Is there unchecked state that compaction would lose?**

That is a question about the *session*, not about any part of it. Use
\`context_verdict_build\` to summarise what is unlanded, then
\`context_verdict_judge\` to get a verdict.

## The three verdicts

| verdict | meaning |
|---|---|
| \`safe_to_compact\` | nothing recorded is unlanded |
| \`wait\` | the record does not settle it, or the service could not be asked |
| \`preserve_first\` | recorded work exists nowhere durable and must be written down first |

There are exactly three. There is no fourth, and no argument adds one.

## What this tool cannot do, and will not be asked to do

**It cannot tell you which parts of a context are important.**

A per-block screener — "which of these thirty blocks can be dropped?" — was built
and **measured**, and it failed in both directions at once: it judged the block
containing the actual fix as droppable with confidence **0.323**, and judged a
nursery rhyme as worth keeping with **0.691**. The most expensive possible error
and pure noise, on the same data, in the same run.

So the capability is absent by construction rather than by policy:

- the state has no field that can name a block, and ${FORBIDDEN_KEYS.length} key names
  that would reintroduce one cause a hard failure rather than being stripped;
- \`judge\` accepts only a state the renderer produced, checked by digest, so a
  hand-assembled state is refused;
- the request carries exactly one three-option question, so there is no shape in
  which to ask for a per-item answer;
- there is no per-block command.

**If you are asked to drop context, this is the wrong tool.** Say so, and use the
three-verdict answer instead: the honest question is whether *anything* recorded is
unlanded, and that one is decidable.

## The state

Sections, always present: ${STATE_SECTIONS.map((s) => `\`${s}\``).join(', ')}.

It carries counts and short descriptions. It never carries sequence numbers, spans,
or offsets — not because they are stripped, but because nothing in the renderer can
produce them.

## What \`wait\` means, and why it is not a failure

\`wait\` is the answer in three situations, and none of them is a bug:

1. the recorded unlanded count is ambiguous (between ${config.risk.safeMax} and
   ${config.risk.waitMin - 1} items) so the local rules decline;
2. no service is configured, so the question cannot be asked;
3. the service was asked and was not there.

In the last two the reason codes say which. In all three the answer is *not*
permission: this tool never treats "I could not decide" as "go ahead".

## Reading the score

The 2–10 score is a secondary scale. It never decides on its own — the verdict is
the three-value choice, and a high score with a \`wait\` verdict is still a wait.
`

  return {
    name: SKILL_NAME,
    description:
      'How context-verdict works: one session-level verdict on whether compaction '
      + 'would lose unlanded state, and why it cannot be asked to screen blocks.',
    body,
    verdicts: VERDICT_OPTIONS.slice(),
    stateCharCap: config.stateCharCap,
    forbiddenKeyCount: FORBIDDEN_KEYS.length,
  }
}
