/**
 * @typedef {object} PausePolicy
 * @property {<T>(fn: () => Promise<T> | T) => Promise<GuardResult<T>>} guard -
 *   Wraps a handler invocation.
 * @property {() => boolean} isPaused - Whether the policy is paused.
 * @property {() => { paused: boolean, consecutive_failures: number,
 *   first_failure_at: number | null }} state - A snapshot of the
 *   internal state, for diagnostics.
 */

/**
 * @template T
 * @typedef {{ kind: 'paused' } | { kind: 'success', value: T } |
 *   { kind: 'failure', error: unknown }} GuardResult
 */

/**
 * Creates the pause-on-failure policy.
 *
 * Tracks consecutive handler failures. After `threshold` failures
 * within `windowMs`, the policy enters the paused state, fires
 * `reportPause` once, and returns `{ kind: 'paused' }` from every
 * subsequent `guard()` call until the process restarts.
 *
 * A success resets the failure counter. A failure whose first-in-
 * streak timestamp is older than `windowMs` also resets the counter
 * before counting itself.
 *
 * @param {object} deps
 * @param {(reason: { threshold: number, window_ms: number,
 *   first_failure_at: string }) => Promise<void>} deps.reportPause -
 *   Called exactly once when the policy pauses. The runtime wires it
 *   to the server's pause endpoint. Rejections are logged and
 *   ignored.
 * @param {import('./diagnostics/logger.js').Logger} [deps.logger] -
 *   Optional logger.
 * @param {number} [deps.threshold=3] - Failures required to pause.
 * @param {number} [deps.windowMs=60000] - The rolling window in
 *   milliseconds.
 * @param {() => number} [deps.now=Date.now] - The clock. Parameterized
 *   for testing.
 * @returns {PausePolicy} The policy.
 */
export function createPausePolicy ({
  reportPause,
  logger,
  threshold = 3,
  windowMs = 60000,
  now = Date.now
}) {
  if (typeof reportPause !== 'function') {
    throw new Error('reportPause must be a function')
  }

  let paused = false
  let consecutiveFailures = 0
  /** @type {number | null} */
  let firstFailureAt = null

  /**
   * Resets the consecutive failure counter and window anchor.
   */
  function recordSuccess () {
    if (paused) {
      return
    }
    consecutiveFailures = 0
    firstFailureAt = null
    logger?.debug('pause policy counter reset on success')
  }

  /**
   * Records a handler failure. Increments failure counter or resets streak
   * if outside window boundary, and pauses if threshold reached.
   */
  function recordFailure () {
    if (paused) {
      return
    }
    const nowMs = now()
    if (firstFailureAt === null || nowMs - firstFailureAt > windowMs) {
      firstFailureAt = nowMs
      consecutiveFailures = 1
      logger?.debug('pause policy failure streak started', {
        meta: {
          consecutive_failures: 1,
          first_failure_at: firstFailureAt
        }
      })
    } else {
      consecutiveFailures++
      logger?.debug('pause policy failure count incremented', {
        meta: {
          consecutive_failures: consecutiveFailures,
          first_failure_at: firstFailureAt
        }
      })
    }

    if (consecutiveFailures >= threshold) {
      pause(firstFailureAt)
    }
  }

  /**
   * Pauses the policy and triggers the reportPause callback once.
   *
   * @param {number} firstFailureAtMs - Timestamp of first failure in streak.
   */
  function pause (firstFailureAtMs) {
    paused = true
    const payload = {
      threshold,
      window_ms: windowMs,
      first_failure_at: new Date(firstFailureAtMs).toISOString()
    }
    logger?.warn('bot paused', { meta: payload })
    Promise.resolve()
      .then(() => reportPause(payload))
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger?.error('pause report failed', { meta: { error: errorMsg } })
      })
  }

  return {
    async guard (fn) {
      if (paused) {
        return { kind: 'paused' }
      }

      let value
      try {
        value = await fn()
      } catch (err) {
        recordFailure()
        return {
          kind: 'failure',
          error: err
        }
      }

      recordSuccess()
      return {
        kind: 'success',
        value
      }
    },

    isPaused () {
      return paused
    },

    state () {
      return {
        paused,
        consecutive_failures: consecutiveFailures,
        first_failure_at: firstFailureAt
      }
    }
  }
}
