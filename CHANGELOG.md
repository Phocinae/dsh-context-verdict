# Changelog

## 0.1.0 — 2026-10-14

First release. One session-level verdict on whether compaction would lose unlanded
state, with the per-block capability absent by construction.

### What it does

`context_verdict_build` summarises what a session holds that exists nowhere durable
— todos not done, files changed and not committed, questions unanswered — and
returns it with a digest. `context_verdict_judge` answers `safe_to_compact`,
`wait` or `preserve_first`, deciding locally where the record settles it and asking
a service only in the ambiguous band. No runtime dependencies.

### Why the shape is a negation

A per-block screener — "which of these blocks can be dropped?" — was built and
**measured, and rejected**: it judged the block containing the actual fix as
droppable with confidence 0.323, and a nursery rhyme as worth keeping with 0.691.
The most expensive error class and pure noise, on the same data, in the same run.

So this release answers a question that is decidable instead, and makes the
per-block capability absent rather than disabled. Four gates, each with an
executable assertion, and the artefact check **injects the thing each gate forbids**:

* **G1** — one renderer over a closed field set, and `judge` accepts only a state
  bound to its summary by digest. Injection: a hand-assembled state that is
  correctly *shaped* is still refused, because it carries no honest digest.
* **G2** — one `choice` with exactly three fixed options plus one `score`.
  Injection: a four-option request.
* **G3** — `FORBIDDEN_KEYS`, a constant of 35 names, checked recursively.
  Injection: all 35, at the top level and nested and in mixed case.
* **G4** — three tools, and a per-block tool name is refused before registration.

**The refusal throws rather than stripping.** Stripping would return a plausible
verdict while hiding that something upstream produces the forbidden shape.

### The hole the design found in its own gate

G1 originally held only for states *this project* rendered. Since `judge` took a
state as free text, any caller — including a model — could concatenate thirty
blocks into a string that happened to contain the seven section names, and the gate
would then be a matter of the caller's good behaviour.

The digest closes it: a state exists only as a pair with the summary it came from,
and the hash covers both. This is an **integrity check, not a security control** —
anyone can recompute one — and the README says so rather than implying otherwise.

### Defects found while building it

**The forbidden-key path was useless for finding the key.** The refusal reported
the parent (`$`) rather than the offending key, so a caller with a nested payload
was told a forbidden key existed *somewhere*. It now names the path
(`$.outer.inner[0].perBlock`).

**`state` had no output schema while its two sibling tools did.** Caught by the
suite's schema-conformance test, which walks every tool rather than the ones the
author remembered.

**`index.mjs` defined its own copy of `FORBIDDEN_KEYS` and the other constants
while also re-exporting them from `lib/constants.mjs`.** Two copies of the constant
the gate actually reads is how a gate stops working while still passing its own
tests. The local copy is gone; there is one definition.

### Decisions worth stating

* **A missing service is `wait`, never permission.** "I could not decide" is not
  "go ahead", in all three of the situations that produce it.
* **An answer outside the vocabulary is refused, not coerced to `wait`.** Coercion
  would turn a broken service into a plausible verdict.
* **A state over budget is exit 2, not a verdict.** A state too large to send is a
  configuration problem, and reporting it as "unsafe to compact" would make an
  infrastructure limit look like a finding about the session.
* **`safeMax >= waitMin` is refused at load**, because it makes `wait` unreachable
  and a configuration that removes a verdict is not a tuning choice.
* **A single-labelled corpus is refused rather than scored.** "No lost case was let
  through" over a corpus with no lost cases is true and meaningless.
* **An empty scan is refused.** Nothing verified is not a clean result.
* **A service-absent run is exit 0 with every case counted SKIP**, and `allSkipped`
  is reported so the distinction is not left to inference.

### Limits

`safe_to_compact` means nothing *recorded* is unlanded. A session holding work in a
form the transcript does not capture looks identical, and this tool cannot tell the
difference.
