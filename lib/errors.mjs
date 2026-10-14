/**
 * Error codes and the error type.
 *
 * The vocabulary is "programming errors" rather than reason codes for verdicts:
 * this project's verdicts are `safe_to_compact` / `wait` / `preserve_first`, and
 * everything here is a defect in how the tool was called or built. Mixing the two
 * would let a bug look like a finding.
 */

export const PROGRAMMING_ERROR_CODES = Object.freeze({
  BAD_CONTEXT: 'CV_BAD_CONTEXT',
  BAD_CONFIG: 'CV_BAD_CONFIG',
  BAD_STATE: 'CV_BAD_STATE',
  STATE_OVER_BUDGET: 'CV_STATE_OVER_BUDGET',
  STATE_INVALID: 'CV_STATE_INVALID',
  STATE_STALE: 'CV_STATE_STALE',
  DIGEST_MISMATCH: 'CV_DIGEST_MISMATCH',
  FORBIDDEN_KEY: 'CV_FORBIDDEN_KEY',
  BAD_VERDICT_SHAPE: 'CV_BAD_VERDICT_SHAPE',
  BAD_CORPUS: 'CV_BAD_CORPUS',
  BAD_SESSION: 'CV_BAD_SESSION',
  SERVICE_UNAVAILABLE: 'CV_SERVICE_UNAVAILABLE',
  // G4: the API surface has no per-item command, so this code exists to name the
  // attempt rather than to handle it.
  NO_PER_BLOCK_API: 'CV_NO_PER_BLOCK_API',
})

export class ContextVerdictError extends Error {
  constructor(code, message, detail = null, exitCode = 3) {
    if (!Object.values(PROGRAMMING_ERROR_CODES).includes(code)) {
      throw new Error(
        `unregistered error code ${JSON.stringify(code)}: add it to `
          + 'PROGRAMMING_ERROR_CODES, because a code no reader can look up is not '
          + 'actionable',
      )
    }
    super(`${code}: ${message}`)
    this.name = 'ContextVerdictError'
    this.code = code
    this.detail = detail
    this.exitCode = exitCode
  }
}
