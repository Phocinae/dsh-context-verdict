# -*- coding: utf-8 -*-
"""Mutation-test the service-response check in verify-artifacts.mjs.

A verifier that reports OK on a mutated tree is decoration. This removes, one at a
time, each gate the artefact check claims to prove, restores the file, and reports
whether the check went red. Anything it does not catch is a check that would not
have caught the bug it was written for.
"""
import io
import os
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

REPO = r"D:\Projects\phociane-project\_work\build\dsh-context-verdict"

# (label, relative path, exact text to remove or alter)
MUTATIONS = [
    (
        "service-response gate (the hole that shipped)",
        "lib/judge.mjs",
        "  assertNoForbiddenKeys(response, '$.serviceResponse')\n",
        "",
    ),
    (
        "recursive forbidden-key scan",
        "lib/state.mjs",
        "      walk(child, `${where}.${key}`)\n",
        "",
    ),
    (
        # The first version of this mutation changed only the *message* (`here` ->
        # `where`), which is semantically harmless: the gate still refuses, so a
        # verifier reporting green is correct rather than blind. That made it a bad
        # mutation, not a gap. This one disables the gate outright.
        "the forbidden-key check itself",
        "lib/state.mjs",
        "      if (FORBIDDEN.has(key.toLowerCase())) {\n",
        "      if (false) {\n",
    ),
    (
        "the four-option shape assertion",
        "lib/judge.mjs",
        "  if (options.length !== VERDICT_OPTIONS.length) {\n",
        "  if (false) {\n",
    ),
    (
        "the digest comparison",
        "lib/digest.mjs",
        "  if (expected !== digest) {\n",
        "  if (false) {\n",
    ),
    (
        "the single-label corpus refusal",
        "lib/verify.mjs",
        "  if (missing.length > 0) {\n",
        "  if (false) {\n",
    ),
    (
        "the unrecognised-verdict refusal",
        "lib/verify.mjs",
        "  if (!SCORABLE_VERDICTS.has(verdict)) {\n",
        "  if (false) {\n",
    ),
    (
        "the decisions term in the unlanded count",
        "lib/summary.mjs",
        "+ summary.decisions.length",
        "",
    ),
]


def run_check():
    proc = subprocess.run(
        ["node", "scripts/verify-artifacts.mjs"],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def main():
    baseline_code, baseline_out = run_check()
    print("baseline: exit %d" % baseline_code)
    if baseline_code != 0:
        print("FAIL the artefact check is already red on an unmutated tree:")
        print(baseline_out[-800:])
        return 1

    uncaught = []
    for label, rel, old, new in MUTATIONS:
        path = os.path.join(REPO, rel.replace("/", os.sep))
        with open(path, "r", encoding="utf-8") as handle:
            original = handle.read()
        if old not in original:
            print("  ?? %-46s pattern absent, mutation not applied" % label)
            uncaught.append((label, "mutation could not be applied"))
            continue
        mutated = original.replace(old, new, 1)
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(mutated)
        try:
            code, out = run_check()
        finally:
            with open(path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(original)
        caught = code != 0
        fails = [line for line in out.splitlines() if line.startswith("FAIL")]
        marker = "caught " if caught else "MISSED "
        print("  %s %-46s exit %d%s"
              % (marker, label, code, ("  | " + fails[0][:70]) if fails else ""))
        if not caught:
            uncaught.append((label, "check stayed green"))

    # The tree must be back to where it started.
    code, _ = run_check()
    print("\nrestored: exit %d" % code)

    if uncaught or code != 0:
        if uncaught:
            print("\nFAIL %d mutation(s) not caught by the artefact check:" % len(uncaught))
            for label, why in uncaught:
                print("  - %s (%s)" % (label, why))
        return 1
    print("OK: every mutation was caught, and the tree restored clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
