# context-verdict

One verdict for a whole session, before it is compacted.

## The question, and the question this tool refuses

> **Is there unlanded state that a compaction would lose?**

That is a question about the *session*, not about any part of it. It has a
decidable answer: work either exists somewhere durable or it does not.

**This tool cannot tell you which parts of a context are important.** That was
tried. A per-block screener — "which of these thirty blocks can be dropped?" — was
built and measured, and it failed in both directions at once:

| what it judged | verdict | confidence |
|---|---|---|
| the block containing the actual fix | droppable | **0.323** |
| a nursery rhyme | worth keeping | **0.691** |

The most expensive possible error and pure noise, on the same data, in the same
run. So the capability is absent by construction rather than by policy — see
"Structural, not promised" below.

## The three verdicts

| verdict | meaning |
|---|---|
| `safe_to_compact` | nothing recorded is unlanded |
| `wait` | the record does not settle it, or the service could not be asked |
| `preserve_first` | recorded work exists nowhere durable and must be written down first |

Exactly three, in that order, and there is no argument that adds a fourth. If you
are asked to drop context, this is the wrong tool — say so, and use the three-value
answer instead.

## Structural, not promised

"We will not write that loop" is a promise, and the measurement above is what
happens when a promise is all you have. Four gates, each with an executable
assertion, and the artefact check injects the thing each one forbids:

**G1 — the model's input cannot name a block.** The state comes from exactly one
renderer over a closed field set (`session`, `todos`, `uncommitted`, `questions`,
`decisions`, `next_steps`, `risk_hints`) and no field can express a block. `judge`
accepts only a state bound to its summary **by digest**, so a hand-assembled state
is refused rather than accepted on its word.

**G2 — three values plus one scale.** One `choice` question with exactly three
fixed options, plus one `score`. A request with four options is refused; a
four-option request is injected in the artefact check.

**G3 — no slot for a selection.** `FORBIDDEN_KEYS` is a constant of 35 names, and a
payload carrying one **throws rather than being stripped**. Stripping would return a
plausible verdict while hiding that something upstream produces the forbidden
shape. The refusal names the path (`$.outer.inner[0].perBlock`) and cites the
measurement.

**G4 — no per-block API surface.** Three tools. No `screen`, no `filter`, no `pick`.

## What `wait` means

`wait` is the answer in three situations, and none is a bug:

1. the recorded unlanded count is ambiguous — inside the band between `safeMax` and
   `waitMin` — so the local rules decline;
2. no service is configured, so the question cannot be asked;
3. the service was asked and was not there.

The reason codes say which. In all three the answer is **not** permission: this
tool never treats "I could not decide" as "go ahead". The local path decides the
two ends — nothing unlanded, or more than the threshold — and does not spend a
request on either.

## Exit codes

| code | meaning |
|---|---|
| `0` | no `lost` case was let through |
| `1` | a `lost` case **was** judged `safe_to_compact` |
| `2` | the state exceeded its character budget — a configuration problem, not a verdict |
| `3` | usage, configuration or input error |

A run where the service was absent is exit **0** with every case counted as SKIP.
That is deliberate and it is the one place this project treats an unrun check as
success: exit 0 means "nothing was let through", and a check that did not run let
nothing through. SKIP is counted and listed separately so the distinction survives
into the report, and `allSkipped` is reported so a caller is not left to infer it.

## `verify` checks both directions

`verify` runs a labelled corpus and reports two rates, because a verdict system can
fail in two ways and only one is dangerous:

* **`lost` let through as `safe_to_compact`** — the dangerous one. Work is compacted
  and gone. Exit **1**.
* **`keep` refused** — the safe direction, and still a defect. A tool that always
  answers `preserve_first` never loses anything and is useless, so
  over-conservatism is counted rather than congratulated.

**A single-labelled corpus is refused, not scored.** "No lost case was let through"
over a corpus with no lost cases is true and meaningless, which is worse than a red
check — it is the failure mode this project's whole family keeps hitting.

## Limits, stated rather than implied

`safe_to_compact` means **nothing recorded is unlanded**. A session holding work in
a form the transcript does not capture would look identical, and this tool cannot
tell the difference. That is a limit of what is observable, not a guarantee about
the session.

The digest is an **integrity check, not a security control**. Anyone can recompute
one. What it prevents is the accidental case — a caller assembling their own state,
or an old state drifting from its summary — and it makes a bypass deliberate rather
than incidental. Do not describe it as a defence against a caller who wants around
it.

## Requirements

Node `^22.19.0 || >=24.0.0`. No runtime dependencies. `@deepseek-ai/cordis` is an
optional peer.

## Testing

```sh
npm test                  # 39 assertions, no host required
npm run verify:artifacts   # what npm publish would actually ship
```

The verifier is about **absence**, which is the hardest thing to check: a gate that
has been removed looks exactly like a gate that found nothing wrong. So it injects
each forbidden thing — all 35 forbidden keys, a hand-assembled state, a four-option
request, a single-labelled corpus — and requires the code to refuse it.

## License

Apache-2.0.
