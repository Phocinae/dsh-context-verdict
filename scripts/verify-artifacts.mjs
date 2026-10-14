#!/usr/bin/env node
/**
 * Inspect the packed artefact before publishing.
 *
 * This project's whole subject is a capability that must be *absent*, and absence
 * is the hardest thing to check: a gate that no longer exists looks exactly like a
 * gate that found nothing wrong. So the checks below inject the things the design
 * forbids and require the code to refuse them. If the refusal stops working, this
 * script goes red rather than reporting a clean package.
 *
 * Three classes, in increasing order of how easily they would ship unnoticed:
 *
 *  1. **Structure** — the patch exists and names the package, `files[]` covers
 *     every required file.
 *  2. **Presence** — the three tools exist and their schemas stay inside the host's
 *     subset.
 *  3. **Absence, by injection** — a forbidden key throws, a hand-assembled state is
 *     refused, a four-option request is refused, and a single-labelled corpus is
 *     refused. Each of these is the gate working; each would pass silently if the
 *     gate had been removed.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const checked = []

function check(label, condition, detail = '') {
  checked.push(label)
  if (!condition) failures.push(detail ? `${label}: ${detail}` : label)
}

function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))
}

const pkg = readJson('package.json')

// --- 1. structure -----------------------------------------------------------
const patchPath = pkg.dsh?.bundle?.patch
check('package.json declares dsh.bundle.patch', typeof patchPath === 'string', String(patchPath))
check('manifestVersion is 1', pkg.dsh?.manifestVersion === 1, String(pkg.dsh?.manifestVersion))
check('the patch file exists', existsSync(join(ROOT, patchPath ?? '')), String(patchPath))
const patch = readFileSync(join(ROOT, patchPath), 'utf8')
check('THE PATCH NAMES THE PACKAGE', patch.includes(`name: ${pkg.name}`),
  `the patch must mount a module named exactly ${pkg.name}`)
check('the patch enables the bundle', /insert:/.test(patch))

const REQUIRED = [
  'index.mjs', 'tools.mjs',
  'lib/constants.mjs', 'lib/config.mjs', 'lib/errors.mjs', 'lib/state.mjs',
  'lib/summary.mjs', 'lib/digest.mjs', 'lib/judge.mjs', 'lib/verify.mjs', 'lib/skill.mjs',
  'skills/context-verdict/SKILL.md',
  'cordis.patch.yml', 'README.md', 'README-zh.md', 'ARCHITECTURE.md', 'CHANGELOG.md',
  'LICENSE',
]
for (const rel of REQUIRED) check(`file exists: ${rel}`, existsSync(join(ROOT, rel)))
const files = pkg.files ?? []
for (const rel of REQUIRED) {
  check(`files[] covers ${rel}`,
    files.some((entry) => rel === entry || rel.startsWith(`${entry}/`)),
    `"${rel}" would not travel with the package`)
}
check('files[] does not include tests', !files.includes('test'))
check('files[] does not include scripts', !files.includes('scripts'))
check('files[] declares an explicit allow-list', files.length > 0 && !files.includes('*'))
check('no runtime dependencies', Object.keys(pkg.dependencies ?? {}).length === 0)
check('license is declared', typeof pkg.license === 'string' && pkg.license !== '')

// --- 2 and 3. behaviour, including the refusals -----------------------------
try {
  // `pathToFileURL`, not the bare path: on Windows an absolute path is `D:\...`,
  // which the ESM loader rejects outright.
  const mod = await import(pathToFileURL(join(ROOT, 'index.mjs')).href)

  check('BUNDLE_NAME matches package.json', mod.BUNDLE_NAME === pkg.name,
    `${mod.BUNDLE_NAME} vs ${pkg.name}`)

  let threw = null
  try { mod.createPlugin(null, {}) } catch (error) { threw = error }
  check('createPlugin refuses a ctx with no .inject()', threw !== null)

  const config = mod.resolveConfig({})

  // Presence: the three tools, and no fourth.
  const tools = mod.createTools(config)
  check('exactly three tools', tools.length === 3, String(tools.length))
  for (const name of ['context_verdict_build', 'context_verdict_judge', 'context_verdict_state']) {
    check(`tool ${name} exists`, tools.some((tool) => tool.name === name))
  }
  for (const tool of tools) {
    check(`${tool.name} has parameters`, Boolean(tool.parameters))
    check(`${tool.name} has output.schema`, Boolean(tool.output?.schema))
  }

  // Absence, by injection. Each of these is a gate; if the gate were removed the
  // check would pass silently instead of failing.
  let refusal = null
  try { mod.assertNoForbiddenKeys({ perBlock: [] }) } catch (error) { refusal = error }
  check('A FORBIDDEN KEY IS REFUSED', refusal !== null,
    'perBlock was accepted: the per-block gate is gone')
  check('and the refusal names the path',
    refusal !== null && refusal.detail.some((line) => line.includes('perBlock')),
    refusal === null ? 'no refusal' : JSON.stringify(refusal.detail))
  check('and the refusal cites the measurement',
    refusal !== null && /0\.323/.test(refusal.message),
    'the refusal must say why, not only what')

  // Every forbidden key, so the constant cannot lose members unnoticed.
  let missingRefusals = []
  for (const key of mod.FORBIDDEN_KEYS) {
    let caught = false
    try { mod.assertNoForbiddenKeys({ [key]: 1 }) } catch { caught = true }
    if (!caught) missingRefusals.push(key)
  }
  check(`all ${mod.FORBIDDEN_KEYS.length} forbidden keys are refused`,
    missingRefusals.length === 0, `accepted: ${missingRefusals.join(', ')}`)

  // A four-option request must be refused; three is the whole vocabulary.
  let shapeRefusal = null
  try {
    mod.assertVerdictShape([{ ...mod.VERDICT_QUESTION, options: [...mod.VERDICT_OPTIONS, 'maybe'] }])
  } catch (error) { shapeRefusal = error }
  check('A FOUR-OPTION REQUEST IS REFUSED', shapeRefusal !== null)
  check('and the verdict vocabulary is still three',
    mod.VERDICT_OPTIONS.length === 3, String(mod.VERDICT_OPTIONS.length))

  // A hand-assembled state must be refused, which is what makes G1 structural.
  const summary = mod.summarise([
    { kind: 'todo_write', items: [{ what: 'x', status: 'pending' }] },
    { kind: 'write', path: 'a.mjs' },
    { kind: 'write', path: 'b.mjs' },
    { kind: 'write', path: 'c.mjs' },
  ])
  const state = mod.renderState(summary)
  const digest = mod.computeDigest(state, summary)
  const assembled = mod.STATE_SECTIONS.map((name) => `${name} (none)`).join('\n')
  let stateRefusal = null
  try { mod.verifyDigest(assembled, summary, digest) } catch (error) { stateRefusal = error }
  check('A HAND-ASSEMBLED STATE IS REFUSED', stateRefusal !== null,
    'a state that never came from the renderer was accepted')
  check('and the real state still verifies',
    mod.verifyDigest(state, summary, digest) === true)

  // A single-labelled corpus must be refused rather than scored.
  let corpusRefusal = null
  try { mod.verify([{ id: 'a', label: 'lost', verdict: 'wait' }]) } catch (error) { corpusRefusal = error }
  check('A SINGLE-LABELLED CORPUS IS REFUSED', corpusRefusal !== null,
    'a corpus with no keep case was scored, which verifies half the property')

  // The verdicts are exactly the three, in order.
  check('the verdict vocabulary is verbatim',
    JSON.stringify(mod.VERDICT_OPTIONS)
      === JSON.stringify(['safe_to_compact', 'wait', 'preserve_first']),
    JSON.stringify(mod.VERDICT_OPTIONS))
} catch (error) {
  check('index.mjs imports cleanly', false, String(error && error.message))
}

// --- report -----------------------------------------------------------------
console.log(`inspecting ${pkg.name}@${pkg.version} at ${ROOT}`)
console.log(`checked ${checked.length} conditions`)
if (failures.length === 0) {
  console.log('OK: the packed artefact would carry every file the patch needs, the '
    + 'patch names the package, and every capability this project must NOT have is '
    + 'still refused')
  process.exit(0)
}
console.log('')
for (const failure of failures) console.log(`FAIL ${failure}`)
process.exit(1)
