# Changelog

## Unreleased

### Fixed — the mutation test only ran on the machine it was written on

`scripts/mutation-test.mjs.py` hard-coded
`D:\Projects\phociane-project\_work\build\dsh-context-verdict` — an old path from
before the project directory was reorganised, and a Windows path besides. On any
other checkout it would point at nothing. It now derives the repository root from
`__file__`, which is what lets the new CI job actually run it.

### Added — CI and an OIDC publishing path

`ci.yml` runs the unit suite and the packed-artefact self-check on Linux, Windows
and macOS (Node 22 and 24), plus the mutation test on Linux. `release.yml`
publishes with npm trusted publishing (`id-token: write`, npm >= 11.5.1); until a
trusted publisher is configured on npmjs.com there is no token to fall back to,
which is the intended failure.

## 0.1.2 — 2026-10-14

The most serious defect this project has had, found by running the released
package against a **real** session transcript rather than a fixture.

### Blocker — the extractor read the wrong record shape, so every session looked clean

`summarise()` was written against an invented record shape. Run against a live
`~/.dsh/sessions/**/session.v4.jsonl.zstd` — 5,951 records, 1,032 tool calls, 38
open todos, 433 file writes — the **released 0.1.1** returned:

```
records fed : 5951
todos       : 0
uncommitted : 0
unlanded    : 0
verdict     : safe_to_compact
```

`safe_to_compact` is the verdict that lets a compaction proceed. On a session with
38 open todos and 433 file writes, this tool said there was nothing to lose. It is
the exact failure the project exists to prevent, produced by the project itself.

Three details were wrong, and **each one alone was enough** to make the count zero:

| detail | invented shape | real shape |
|---|---|---|
| discriminator | `kind`, or a `type` of `write`/`edit` | `type: "tool/call"`, tool name in `data.name` |
| todo text | `what` | `content`, nested under `data.todos` |
| tool arguments | an object | **a JSON string** |

After the fix, the same session gives:

```
todos       : 34
uncommitted : 161
risk_hints  : ["161 file(s) changed and not committed","34 todo(s) not done"]
unlanded    : 195
verdict     : preserve_first
```

Two further corrections came out of it:

* **repeated edits to one file are one unlanded file.** 433 writes touched 161
  distinct paths, and reporting the write count beside a 161-entry list trains a
  reader to distrust both numbers. The risk hints are now derived *after*
  deduplication, so each hint's number matches the list it describes — a test
  asserts that, because a summary whose numbers disagree with its own lists is
  worse than no summary.
* **`pwsh` is deliberately not a writing tool.** A shell command may write a file,
  and treating every shell call as a write would report uncommitted work for a
  session that only read things. The omission is the safe direction: over-reporting
  sends a session to `preserve_first` for nothing, while guessing the other way
  loses the work.

### How it was found, and what that says about the earlier checks

Three independent verifiers looked at 0.1.1, and one of them flagged this as a
**residual uncertainty it could not resolve** — the host's transcript format was
not readable from the checkout, so it declined to call it a defect. It was right to
flag it and right to be careful.

The gap was in what the tests used, not in how many there were. Fifty-two assertions
could not catch it because every one of them fed the extractor records in the shape
the extractor expected. A test that shares an assumption with the code cannot test
that assumption.

So the fix is not only the parser. `fixtures/real-session-records.json` holds
records copied from a live transcript, the artefact check reads it and requires
unlanded work to be found, and removing the real-shape support makes the check go
red — verified by mutation, not asserted.

The artefact check went from 74 conditions to 81.

### Tests

44 → 52 assertions, with a dedicated group for the real shape: a real `todo/write`,
a real `tool/call`, reads and shell calls not counting as writes, repeated edits
deduping to one file, the hints matching their lists, a real working session not
being `safe_to_compact`, and — the other direction — a real session with nothing
unlanded still being `safe_to_compact`, so the fix is not simply "always refuse".
## 0.1.1 — 2026-10-14

Three defects from an independent verification pass over 0.1.0, one of them the
exact failure this project exists to prevent.

### Blocker — a session of recorded decisions was reported `safe_to_compact`

`unlandedCount` summed todos, uncommitted files, questions and next steps, and
**omitted decisions**. The state renderer printed a `DECIDED` section, the README
called a decision "work existing nowhere durable", and the count did not include it.

So a session whose only unlanded work was recorded decisions got
`unlandedCount === 0` — the single value that makes `decideLocally` answer
`safe_to_compact` **without asking anyone**:

```
4 recorded decisions -> decisions 4, unlandedCount 0
                     -> safe_to_compact, decidedBy local, service never asked
```

The count and the field set have to cover the same fields, or the summary reports
work that the verdict cannot see. `unlandedCount` now includes decisions, and a
test asserts that every field the renderer prints as unlanded contributes at least
one to the count.

### Major — an unrecognised verdict in a corpus was scored as a pass

`classifyCase` compared `verdict === 'safe_to_compact'` and had no vocabulary check,
so on a `lost` case **any** other value — a typo, a casing change, `undefined` —
fell through to `ok`. A spelling change at the emitter would turn every lost case
green: exit 0, `lostLetThroughRate` 0, a report that reads as completely clean.

The rule against inventing an answer already covered a missing `label`; it did not
cover a missing or unknown `verdict`. Now both are refused with `CV_BAD_CORPUS`.

### Major — the forbidden-key gate did not cover the service response

The gate ran on the way in (`{state, summary, digest}`) and on the way out (the
result), and **never on what the service returned**. A service answering
`{answer: 'wait', perBlock: [...]}` was accepted and the payload silently dropped.

That is precisely the harm the gate exists to prevent: a plausible verdict returned
while hiding that something upstream produces the forbidden shape. Worse in one
direction than silence — a service that had decided per block would have its
reasoning discarded and its answer presented as a session-level finding.

It is refused now, and the reasoning is recorded in `interpret()`.

### The artefact verifier could not prove its own claims

The verifier's subject is **absence**, and absence is the hardest thing to check: a
gate that has been removed looks exactly like a gate that found nothing wrong. A
mutation test over the verifier itself found four gaps — including the decisions
term above, which had shipped.

`scripts/mutation-test.mjs.py` now removes each gate in turn and requires the
artefact check to go red. All eight are caught:

| mutation | caught by |
|---|---|
| service-response gate removed | `G3 APPLIES TO THE SERVICE RESPONSE` |
| recursive walk removed | `forbidden keys are refused at depth and inside arrays` |
| forbidden-key check disabled | `A FORBIDDEN KEY IS REFUSED` |
| four-option assertion disabled | `A FOUR-OPTION REQUEST IS REFUSED` |
| digest comparison disabled | `A HAND-ASSEMBLED STATE IS REFUSED` |
| single-label refusal disabled | `A SINGLE-LABELLED CORPUS IS REFUSED` |
| unrecognised-verdict refusal disabled | `AN UNRECOGNISED CORPUS VERDICT IS REFUSED` |
| decisions term removed | `THE UNLANDED COUNT COVERS EVERY UNLANDED FIELD` |

Two of those checks were added *because* the mutation test found them missing; the
verifier went from 68 conditions to 74.

One mutation was replaced rather than fixed: the first version changed only an error
*message* (`here` → `where`), which is semantically harmless, so a green verdict was
correct rather than blind. That made it a bad mutation, not a gap, and the
replacement disables the gate outright.

### Also recorded

`tau` is accepted, validated, and **read by nothing**. It is kept because a shared
profile may carry it, and the docs now say plainly that it has no effect rather than
implying otherwise.

### Tests

43 → 44 assertions.

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
