# context-verdict

One verdict for a whole session, before it is compacted.

## What it answers

> **Is there unlanded state that a compaction would lose?**

Call `context_verdict_build` to summarise what is unlanded, then
`context_verdict_judge` to get one of three verdicts: `safe_to_compact`, `wait`, or
`preserve_first`. Exactly three — there is no fourth and no argument adds one.

## What it will not do

**It cannot tell you which parts of a context are important.** That was measured
and rejected: a per-block screener judged the block containing the actual fix as
droppable with confidence 0.323, and a nursery rhyme as worth keeping with 0.691 —
the most expensive error and pure noise, on the same data, in the same run.

So if you are asked to drop context, this is the wrong tool. Say so, and use the
three-verdict answer instead: whether *anything* recorded is unlanded is a question
that has an answer, and that one is the useful question.

## Reading `wait`

`wait` is not a failure and it is not permission. It means the recorded count is
ambiguous, or no service is configured, or the service was not there. The reason
codes say which. In no case does it mean "go ahead".

## Reading the score

The 2–10 score is secondary. It never decides on its own: a high score with a
`wait` verdict is still a wait.
