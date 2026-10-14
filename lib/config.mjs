/**
 * Configuration resolution.
 *
 * Every key has a documented default. Overrides that cannot be honoured throw at
 * load rather than degrading quietly, and the risk thresholds are validated as an
 * ordered pair — `safeMax` above `waitMin` would make `preserve_first` unreachable,
 * which is a configuration the caller cannot have meant.
 */
import { DEFAULT_CONFIG } from './constants.mjs'
import { ContextVerdictError, PROGRAMMING_ERROR_CODES } from './errors.mjs'

export function resolveConfig(options = {}) {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CONFIG, 'options must be an object', null, 3)
  }

  const stateCharCap = options.stateCharCap ?? DEFAULT_CONFIG.stateCharCap
  if (!Number.isInteger(stateCharCap) || stateCharCap < 1) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CONFIG,
      `stateCharCap must be a positive integer, got ${JSON.stringify(options.stateCharCap)}`,
      null,
      3,
    )
  }

  const risk = { ...DEFAULT_CONFIG.risk, ...(options.risk ?? {}) }
  for (const key of ['safeMax', 'waitMin']) {
    if (!Number.isInteger(risk[key]) || risk[key] < 0) {
      throw new ContextVerdictError(
        PROGRAMMING_ERROR_CODES.BAD_CONFIG,
        `risk.${key} must be a non-negative integer, got ${JSON.stringify(risk[key])}`,
        null,
        3,
      )
    }
  }
  if (risk.safeMax >= risk.waitMin) {
    // `safeMax >= waitMin` leaves no band for `wait`, so a session with more than
    // `safeMax` unlanded items jumps straight to `preserve_first`. The caller
    // cannot have meant that, and accepting it would silently remove a verdict
    // from the vocabulary -- which is exactly the shape G2 forbids.
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CONFIG,
      `risk.safeMax (${risk.safeMax}) must be less than risk.waitMin (${risk.waitMin}). `
        + 'With no gap between them the `wait` verdict becomes unreachable, and a '
        + 'configuration that removes a verdict from the vocabulary is refused '
        + 'rather than accepted.',
      [`safeMax: ${risk.safeMax}`, `waitMin: ${risk.waitMin}`],
      3,
    )
  }

  const tau = options.tau ?? null
  if (tau !== null && (typeof tau !== 'number' || Number.isNaN(tau) || tau < 0 || tau > 1)) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CONFIG,
      `tau must be a number in [0,1] or null, got ${JSON.stringify(options.tau)}`,
      null,
      3,
    )
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIG.timeoutMs
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CONFIG,
      `timeoutMs must be a positive integer, got ${JSON.stringify(options.timeoutMs)}`,
      null,
      3,
    )
  }

  const endpoint = options.endpoint ?? DEFAULT_CONFIG.endpoint
  if (typeof endpoint !== 'string' || endpoint === '') {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CONFIG, 'endpoint must be a non-empty string', null, 3)
  }

  // Two service sources at once is a contradiction: one of them would silently
  // win, and which one wins would depend on argument order.
  if (options.fakeService && options.endpoint) {
    throw new ContextVerdictError(
      PROGRAMMING_ERROR_CODES.BAD_CONFIG,
      '--fake-service and endpoint were both given. Two sources for the same service '
        + 'means one silently wins, and which one wins would depend on argument '
        + 'order. Refused rather than resolved.',
      null,
      3,
    )
  }

  return Object.freeze({
    stateCharCap,
    risk: Object.freeze({ ...risk }),
    tau,
    timeoutMs,
    endpoint,
    fakeService: options.fakeService ?? null,
    statePath: options.statePath ?? null,
  })
}
