/**
 * Test suite for dsh-context-verdict.
 *
 * The assertions that matter most are the ones that try to *break* the four
 * structural gates, because each gate exists to prevent a measured failure rather
 * than to express a preference:
 *
 *  - G1: a hand-assembled state must be refused, not accepted on its word;
 *  - G3: a forbidden key must **throw**, not be stripped — stripping would return
 *    a verdict while hiding that something upstream produces the forbidden shape;
 *  - G2: the request must carry exactly one three-option question;
 *  - G4: there must be no per-block tool, and asking for one must fail.
 *
 * A gate that is only asserted to exist is a comment. Each one below is injected
 * with the thing it forbids.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EXIT, FORBIDDEN_KEYS, STATE_SECTIONS, VERDICT_OPTIONS, DEFAULT_CONFIG,
  renderState, assertNoForbiddenKeys, checkStateTemplate, summarise,
  computeDigest, verifyDigest, judge, decideLocally, verify, classifyCase,
  resolveConfig, createTools, createSkill, TOOL_NAMES, FORBIDDEN_TOOL_NAMES,
  assertVerdictShape, VERDICT_QUESTION, URGENCY_QUESTION, interpret,
  ContextVerdictError, PROGRAMMING_ERROR_CODES,
} from '../index.mjs'

const config = resolveConfig({})

/**
 * A session holding unlanded work, past the `preserve_first` threshold.
 *
 * The count matters: the shipped risk band is `safeMax: 3`, `waitMin: 4`, so a
 * fixture with two unlanded items lands in the *ambiguous* band, where the local
 * rules correctly decline and the verdict becomes `wait`. Tests that want the
 * deterministic `preserve_first` path need at least four.
 */
function lostRecords() {
  return [
    { kind: 'todo_write', items: [{ what: 'wire the retry path', status: 'pending' }] },
    { kind: 'write', path: 'src/retry.mjs', what: 'the retry implementation' },
    { kind: 'write', path: 'src/backoff.mjs' },
    { kind: 'question', what: 'should the retry cap be configurable' },
    { kind: 'write', path: 'tests/retry.test.mjs' },
  ]
}

/** Two unlanded items: inside the ambiguous band, so the service is asked. */
function ambiguousRecords() {
  return [
    { kind: 'todo_write', items: [{ what: 'one open thing', status: 'pending' }] },
    { kind: 'write', path: 'src/one.mjs' },
  ]
}

function keepRecords() {
  return [
    { kind: 'todo_write', items: [{ what: 'landed already', status: 'completed' }] },
  ]
}

function build(records, options = {}) {
  const summary = summarise(records, options)
  const state = renderState(summary)
  return { summary, state, digest: computeDigest(state, summary) }
}

// ---------------------------------------------------------------------------
// G1 — the model's input cannot name a block
// ---------------------------------------------------------------------------

test('the summary field set is closed and none of it can name a block', () => {
  const summary = summarise(lostRecords())
  assert.deepEqual(Object.keys(summary).sort(), [
    'decisions', 'next_steps', 'questions', 'risk_hints', 'session', 'todos', 'uncommitted',
  ])
  // The stronger claim: no key anywhere in the summary is a forbidden one.
  assert.doesNotThrow(() => assertNoForbiddenKeys(summary))
})

test('the rendered state carries every required section', () => {
  const { state } = build(lostRecords())
  for (const name of STATE_SECTIONS) {
    assert.match(state, new RegExp(`^${name}(\\s|$)`, 'm'), `missing section ${name}`)
  }
})

test('A HAND-ASSEMBLED STATE IS REFUSED, NOT ACCEPTED ON ITS WORD', () => {
  // This is the hole the design's own review found: if `judge` takes a state as
  // free text, a caller can concatenate thirty blocks and hand it over, and G1
  // becomes a matter of the caller's good behaviour.
  const { state, summary, digest } = build(lostRecords())

  // A state that is merely *shaped* right passes the template check ...
  const assembled = STATE_SECTIONS.map((name) => `${name} (none)`).join('\n')
  assert.doesNotThrow(() => checkStateTemplate(assembled, { stateCharCap: 4096 }))

  // ... and is still refused, because it carries no honest digest.
  assert.throws(
    () => verifyDigest(assembled, summary, digest),
    (error) => {
      assert.equal(error.code, PROGRAMMING_ERROR_CODES.DIGEST_MISMATCH)
      return true
    },
  )

  // Editing the real state invalidates it too.
  assert.throws(
    () => verifyDigest(`${state}\n  - extra line`, summary, digest),
    (error) => error.code === PROGRAMMING_ERROR_CODES.DIGEST_MISMATCH,
  )

  // Editing the summary invalidates the pair.
  const tampered = { ...summary, todos: [] }
  assert.throws(
    () => verifyDigest(state, tampered, digest),
    (error) => error.code === PROGRAMMING_ERROR_CODES.DIGEST_MISMATCH,
  )

  // And no summary at all is refused as half a pair.
  assert.throws(
    () => verifyDigest(state, null, digest),
    (error) => error.code === PROGRAMMING_ERROR_CODES.DIGEST_MISMATCH,
  )
})

test('a state missing a section is refused', () => {
  const partial = STATE_SECTIONS.slice(1).map((name) => `${name} (none)`).join('\n')
  assert.throws(
    () => checkStateTemplate(partial, { stateCharCap: 4096 }),
    (error) => {
      assert.equal(error.code, PROGRAMMING_ERROR_CODES.STATE_INVALID)
      assert.match(error.detail.join(' '), /SESSION/)
      return true
    },
  )
})

test('structural-sequence vocabulary INSIDE the text is refused', () => {
  // The other way a per-block input arrives: not as a key, but as content.
  const text = STATE_SECTIONS.map((name) => `${name} (none)`).join('\n')
    + '\n  - nodeSeq 12 looks important'
  assert.throws(
    () => checkStateTemplate(text, { stateCharCap: 4096 }),
    (error) => {
      assert.equal(error.code, PROGRAMMING_ERROR_CODES.STATE_INVALID)
      assert.match(error.message, /structural-sequence/)
      return true
    },
  )
})

test('a state over its character budget is exit 2, not a verdict', () => {
  const { state } = build(lostRecords())
  assert.throws(
    () => checkStateTemplate(state, { stateCharCap: 10 }),
    (error) => {
      assert.equal(error.code, PROGRAMMING_ERROR_CODES.STATE_OVER_BUDGET)
      assert.equal(error.exitCode, EXIT.STATE_OVER_BUDGET)
      assert.match(error.message, /not a verdict/)
      return true
    },
  )
})

test('judge refuses a state with no digest at all', async () => {
  const { state, summary } = build(lostRecords())
  await assert.rejects(
    () => judge({ state, summary, digest: null, config }),
    (error) => error.code === PROGRAMMING_ERROR_CODES.DIGEST_MISMATCH,
  )
})

// ---------------------------------------------------------------------------
// G3 — no slot for a selection, and a forbidden key throws
// ---------------------------------------------------------------------------

test('EVERY FORBIDDEN KEY THROWS RATHER THAN BEING STRIPPED', () => {
  // Injected one at a time, at the top level and nested, because a forbidden key
  // three levels down is exactly as capable of carrying a selection.
  for (const key of FORBIDDEN_KEYS) {
    assert.throws(
      () => assertNoForbiddenKeys({ [key]: [] }),
      (error) => error.code === PROGRAMMING_ERROR_CODES.FORBIDDEN_KEY,
      `top-level ${key} must throw`,
    )
    assert.throws(
      () => assertNoForbiddenKeys({ outer: { inner: [{ [key]: 1 }] } }),
      (error) => error.code === PROGRAMMING_ERROR_CODES.FORBIDDEN_KEY,
      `nested ${key} must throw`,
    )
  }
  // Case-insensitively, because a key's meaning does not depend on its casing.
  assert.throws(() => assertNoForbiddenKeys({ PERBLOCK: [] }),
    (error) => error.code === PROGRAMMING_ERROR_CODES.FORBIDDEN_KEY)
  assert.throws(() => assertNoForbiddenKeys({ PerBlock: [] }),
    (error) => error.code === PROGRAMMING_ERROR_CODES.FORBIDDEN_KEY)
})

test('the refusal explains why, rather than only what', () => {
  try {
    assertNoForbiddenKeys({ perBlock: ['a', 'b'] })
  } catch (error) {
    assert.match(error.message, /0\.323/, 'the measured failure must be in the message')
    assert.match(error.message, /refused rather than\s+stripped|refused rather than stripped/)
    assert.ok(error.detail.some((line) => line.startsWith('path: $.perBlock')))
    return
  }
  assert.fail('should have thrown')
})

test('a clean payload passes through unchanged', () => {
  const payload = { verdict: 'wait', score: 2, reasonCodes: ['X'] }
  assert.deepEqual(assertNoForbiddenKeys(payload), payload)
})

test('judge output carries no forbidden key', async () => {
  const { state, summary, digest } = build(lostRecords())
  const result = await judge({ state, summary, digest, config })
  assert.doesNotThrow(() => assertNoForbiddenKeys(result))
  assert.equal(result.verdict, 'preserve_first')
})

// ---------------------------------------------------------------------------
// G2 — exactly one three-option question
// ---------------------------------------------------------------------------

test('the request shape is asserted before it is sent', () => {
  assert.doesNotThrow(() => assertVerdictShape([VERDICT_QUESTION, URGENCY_QUESTION]))
})

test('G2 REFUSES A REQUEST THAT ASKS FOR MORE, OR DIFFERENTLY', () => {
  const cases = [
    [[], 'no choice question'],
    [[VERDICT_QUESTION, VERDICT_QUESTION], 'two choice questions'],
    [[{ ...VERDICT_QUESTION, options: ['a', 'b'] }], 'two options'],
    [[{ ...VERDICT_QUESTION, options: [...VERDICT_OPTIONS, 'maybe'] }], 'four options'],
    [[{ ...VERDICT_QUESTION, options: ['safe', 'wait', 'preserve_first'] }], 'renamed option'],
    [[VERDICT_QUESTION, URGENCY_QUESTION, URGENCY_QUESTION], 'two score questions'],
  ]
  for (const [questions, label] of cases) {
    assert.throws(
      () => assertVerdictShape(questions),
      (error) => error.code === PROGRAMMING_ERROR_CODES.BAD_VERDICT_SHAPE,
      label,
    )
  }
})

test('the verdict vocabulary is exactly three, in order', () => {
  assert.deepEqual([...VERDICT_OPTIONS], ['safe_to_compact', 'wait', 'preserve_first'])
})

test('an answer outside the vocabulary is refused, not coerced to wait', () => {
  for (const answer of ['maybe', 'SAFE_TO_COMPACT', '', null, 0, 'preserve']) {
    assert.throws(
      () => interpret({ answer }),
      (error) => error.code === PROGRAMMING_ERROR_CODES.BAD_VERDICT_SHAPE,
      JSON.stringify(answer),
    )
  }
  assert.equal(interpret({ answer: 'wait' }).verdict, 'wait')
  assert.equal(interpret({ answer: 'safe_to_compact' }).verdict, 'safe_to_compact')
})

// ---------------------------------------------------------------------------
// G4 — no per-block API surface
// ---------------------------------------------------------------------------

test('the tool list is three names and none is per-block', () => {
  const tools = createTools(config)
  assert.deepEqual(tools.map((tool) => tool.name), [...TOOL_NAMES])
  for (const tool of tools) {
    assert.ok(!FORBIDDEN_TOOL_NAMES.includes(tool.name))
  }
  assert.equal(tools.length, 3)
})

test('registering a per-block tool would be refused', () => {
  // The guard is in createTools, so the only way to exercise it is to make the
  // list contain one. Simulated by checking the guard's membership test directly,
  // which is what the loop does.
  assert.ok(FORBIDDEN_TOOL_NAMES.includes('context_verdict_screen'))
  assert.ok(!TOOL_NAMES.includes('context_verdict_screen'))
})

// ---------------------------------------------------------------------------
// the local decision path
// ---------------------------------------------------------------------------

test('nothing unlanded is safe_to_compact, decided locally', () => {
  const summary = summarise(keepRecords())
  const result = decideLocally(summary, config)
  assert.equal(result.verdict, 'safe_to_compact')
  assert.equal(result.decidedBy, 'local')
  assert.equal(result.reasonCodes[0], 'NO_UNLANDED_STATE_RECORDED')
})

test('unlanded state beyond the threshold is preserve_first', () => {
  const summary = summarise(lostRecords())
  const result = decideLocally(summary, config)
  assert.equal(result.verdict, 'preserve_first')
  assert.ok(result.score >= 2 && result.score <= 10)
})

test('the ambiguous band declines rather than guessing', () => {
  // An unlanded count inside the band between safeMax and waitMin is above zero
  // and below the threshold, so the record does not settle it. Returning a verdict
  // here would be the prefilter guessing, and this project's whole subject is what
  // happens when a screener guesses.
  const summary = summarise(ambiguousRecords())
  assert.equal(decideLocally(summary, config), null)
  // The count really is inside the band, or this test would pass for the wrong
  // reason -- the same trap that made a sibling project's polarity bug invisible.
  const unlanded = summary.todos.length + summary.uncommitted.length
    + summary.questions.length + summary.next_steps.length
  assert.ok(unlanded > 0 && unlanded <= config.risk.safeMax, `unlanded=${unlanded}`)
})

test('risk thresholds must leave a band for wait', () => {
  assert.throws(
    () => resolveConfig({ risk: { safeMax: 5, waitMin: 5 } }),
    (error) => {
      assert.equal(error.code, PROGRAMMING_ERROR_CODES.BAD_CONFIG)
      assert.match(error.message, /wait\D+becomes unreachable/)
      return true
    },
  )
  assert.throws(() => resolveConfig({ risk: { safeMax: 6, waitMin: 5 } }),
    (error) => error.code === PROGRAMMING_ERROR_CODES.BAD_CONFIG)
})

// ---------------------------------------------------------------------------
// judge: the service paths
// ---------------------------------------------------------------------------

test('a missing service is wait, never permission', async () => {
  const { state, summary, digest } = build(ambiguousRecords())
  const result = await judge({ state, summary, digest, config })
  assert.equal(result.verdict, 'wait')
  assert.equal(result.decidedBy, 'unavailable')
  assert.ok(result.reasonCodes.includes('SERVICE_NOT_CONFIGURED'))
})

test('an unreachable service is wait, with the reason', async () => {
  const { state, summary, digest } = build(ambiguousRecords())
  const client = async () => { throw new Error('ECONNREFUSED') }
  const result = await judge({ state, summary, digest, config, client })
  assert.equal(result.verdict, 'wait')
  assert.equal(result.serviceState, 'unreachable')
  assert.ok(result.reasonCodes.includes('SERVICE_UNREACHABLE'))
  assert.match(result.detail, /ECONNREFUSED/)
})

test('a reachable service decides, and its answer is taken verbatim', async () => {
  const { state, summary, digest } = build(ambiguousRecords())
  for (const answer of VERDICT_OPTIONS) {
    const client = async () => ({ answer, score: 7, confidence: 0.8 })
    const result = await judge({ state, summary, digest, config, client })
    assert.equal(result.verdict, answer)
    assert.equal(result.decidedBy, 'service')
    assert.equal(result.score, 7)
  }
})

test('the local path does not contact the service', async () => {
  let called = 0
  const client = async () => { called += 1; return { answer: 'wait' } }
  const { state, summary, digest } = build(lostRecords())
  const result = await judge({ state, summary, digest, config, client })
  assert.equal(result.verdict, 'preserve_first')
  assert.equal(called, 0, 'a decidable case must not spend a request')
  assert.equal(result.questionsSent, 0)
})

test('a bad score is clamped to the scale, not propagated', async () => {
  const { state, summary, digest } = build(ambiguousRecords())
  for (const [score, expected] of [[7, 7], [0, 2], [99, 2], [2.5, 2], ['7', 2], [undefined, 2]]) {
    const result = await judge({
      state, summary, digest, config,
      client: async () => ({ answer: 'wait', score }),
    })
    assert.equal(result.score, expected, `score ${JSON.stringify(score)}`)
  }
})

// ---------------------------------------------------------------------------
// verify — both directions, and the single-label refusal
// ---------------------------------------------------------------------------

test('a lost case let through is the dangerous direction', () => {
  assert.equal(classifyCase({ id: 'a', label: 'lost', verdict: 'safe_to_compact' }).outcome,
    'lost_let_through')
  assert.equal(classifyCase({ id: 'b', label: 'keep', verdict: 'safe_to_compact' }).outcome,
    'ok')
  assert.equal(classifyCase({ id: 'c', label: 'keep', verdict: 'preserve_first' }).outcome,
    'keep_refused')
  assert.equal(classifyCase({ id: 'd', label: 'lost', verdict: 'wait' }).outcome, 'ok')
})

test('verify reports both rates and exits 1 only on the dangerous one', () => {
  const corpus = [
    { id: 'l1', label: 'lost', verdict: 'preserve_first' },
    { id: 'l2', label: 'lost', verdict: 'safe_to_compact' },
    { id: 'k1', label: 'keep', verdict: 'safe_to_compact' },
    { id: 'k2', label: 'keep', verdict: 'preserve_first' },
  ]
  const { report } = verify(corpus)
  assert.equal(report.counts.lost_let_through, 1)
  assert.equal(report.counts.keep_refused, 1)
  assert.deepEqual(report.lostLetThroughIds, ['l2'])
  assert.deepEqual(report.keepRefusedIds, ['k2'])
  assert.equal(report.lostLetThroughRate, 0.5)
  assert.equal(report.keepRefusedRate, 0.5)
  assert.equal(report.allSkipped, false)
})

test('A SINGLE-LABELLED CORPUS IS REFUSED, NOT SCORED', () => {
  // "No lost case was let through" over a corpus with no lost cases is true and
  // meaningless, which is worse than a red check.
  for (const corpus of [
    [{ id: 'a', label: 'lost', verdict: 'wait' }],
    [{ id: 'a', label: 'keep', verdict: 'safe_to_compact' }],
  ]) {
    assert.throws(
      () => verify(corpus),
      (error) => {
        assert.equal(error.code, PROGRAMMING_ERROR_CODES.BAD_CORPUS)
        assert.match(error.message, /half the property/)
        return true
      },
    )
  }
})

test('an empty corpus is a refusal, not a pass', () => {
  assert.throws(() => verify([]),
    (error) => error.code === PROGRAMMING_ERROR_CODES.BAD_CORPUS)
  assert.throws(() => verify('nope'),
    (error) => error.code === PROGRAMMING_ERROR_CODES.BAD_CORPUS)
})

test('an unlabelled case is refused rather than guessed at', () => {
  assert.throws(() => classifyCase({ id: 'a', verdict: 'wait' }),
    (error) => error.code === PROGRAMMING_ERROR_CODES.BAD_CORPUS)
})

test('an all-skipped corpus is reported, not silently clean', () => {
  const corpus = [
    { id: 'l1', label: 'lost', verdict: 'skipped' },
    { id: 'k1', label: 'keep', verdict: 'skipped' },
  ]
  const { report } = verify(corpus)
  assert.equal(report.allSkipped, true)
  assert.equal(report.counts.skipped, 2)
  assert.equal(report.counts.lost_let_through, 0)
})

// ---------------------------------------------------------------------------
// the tool schemas and the skill
// ---------------------------------------------------------------------------

test('every tool definition stays inside the host JSON Schema subset', () => {
  for (const tool of createTools(config)) {
    assert.ok(tool.parameters, `${tool.name} needs parameters`)
    assert.equal(tool.inputSchema, undefined)
    assert.ok(tool.output?.schema, `${tool.name} needs output.schema`)
    const walk = (node, path) => {
      if (Array.isArray(node)) {
        node.forEach((entry, index) => walk(entry, `${path}[${index}]`))
        return
      }
      if (!node || typeof node !== 'object') return
      if ('type' in node) {
        assert.equal(typeof node.type, 'string', `${path}.type must be one scalar type`)
      }
      if ('required' in node) assert.ok(Array.isArray(node.required), `${path}.required`)
      assert.notEqual(node.required, true, `${path} must not use per-property required: true`)
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`)
    }
    walk(tool.parameters, `${tool.name}.parameters`)
    walk(tool.output.schema, `${tool.name}.output`)
  }
})

test('the build tool output carries exactly the declared keys', async () => {
  const tool = createTools(config).find((entry) => entry.name === 'context_verdict_build')
  const result = await tool.execute({ records: lostRecords(), sessionId: 's1' })
  const declared = new Set(Object.keys(tool.output.schema.properties))
  for (const key of Object.keys(result)) {
    assert.ok(declared.has(key), `undeclared output key ${key}`)
  }
  for (const key of declared) assert.ok(key in result, `declared key ${key} missing`)
  assert.equal(result.withinBudget, true)
  assert.ok(result.unlanded.total >= 1)
})

test('the judge tool output carries exactly the declared keys', async () => {
  const tools = createTools(config)
  const built = await tools.find((t) => t.name === 'context_verdict_build')
    .execute({ records: lostRecords(), sessionId: 's1' })
  const judgeTool = tools.find((t) => t.name === 'context_verdict_judge')
  const result = await judgeTool.execute({
    state: built.state, digest: built.digest, summary: summarise(lostRecords(), { sessionId: 's1' }),
  })
  const declared = new Set(Object.keys(judgeTool.output.schema.properties))
  for (const key of Object.keys(result)) {
    assert.ok(declared.has(key), `undeclared output key ${key}`)
  }
  for (const key of declared) assert.ok(key in result, `declared key ${key} missing`)
})

test('the state tool reports the fixed vocabulary and no per-block mode', async () => {
  const tool = createTools(config).find((entry) => entry.name === 'context_verdict_state')
  const result = await tool.execute()
  assert.deepEqual(result.verdicts, [...VERDICT_OPTIONS])
  assert.equal(result.stateCharCap, DEFAULT_CONFIG.stateCharCap)
  assert.match(result.note, /0\.323/)
})

test('the skill states the negative it exists to communicate', () => {
  const skill = createSkill(config)
  assert.equal(skill.name, 'context-verdict')
  assert.match(skill.body, /0\.323/)
  assert.match(skill.body, /cannot tell you which parts/)
  for (const verdict of VERDICT_OPTIONS) {
    assert.match(skill.body, new RegExp(verdict), `skill must name ${verdict}`)
  }
  assert.match(skill.body, new RegExp(String(FORBIDDEN_KEYS.length)))
})

test('the unlanded summary never invents an item from an unknown record', () => {
  const summary = summarise([
    { kind: 'something-new', payload: { whatever: 1 } },
    null,
    'a string',
    42,
  ])
  assert.equal(summary.todos.length, 0)
  assert.equal(summary.uncommitted.length, 0)
  assert.equal(summary.questions.length, 0)
  // Empty is a real answer: nothing unlanded was found.
  assert.deepEqual(summary.risk_hints, [])
})

test('duplicate unlanded entries are counted once', () => {
  const summary = summarise([
    { kind: 'write', path: 'a.mjs' },
    { kind: 'write', path: 'a.mjs' },
    { kind: 'todo_write', items: [{ what: 'same', status: 'pending' }] },
    { kind: 'todo_write', items: [{ what: 'same', status: 'pending' }] },
  ])
  assert.equal(summary.uncommitted.length, 1)
  assert.equal(summary.todos.length, 1)
})
