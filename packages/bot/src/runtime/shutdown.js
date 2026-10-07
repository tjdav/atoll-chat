/**
 * @typedef {object} ShutdownTracker
 * @property {<T>(fn: () => Promise<T>) => Promise<T>} track - Runs the function and tracks it.
 * @property {(timeoutMs: number) => Promise<{ drained: boolean, remaining: number }>} waitForAll - Waits for every tracked operation to settle.
 * @property {() => void} startShutdown - Sets the shutting-down flag.
 * @property {() => boolean} isShuttingDown - Whether startShutdown has been called.
 * @property {() => number} inFlightCount - The current count of in-flight operations.
 */

/**
 * Creates the shutdown tracker.
 *
 * Tracks in-flight handler invocations so the runtime can drain them
 * before closing resources. `startShutdown()` signals dispatch sites
 * to refuse new work; `waitForAll(ms)` waits for the current set to
 * empty within the budget.
 *
 * @param {import('./diagnostics/logger.js').Logger} [logger] - Optional logger.
 * @returns {ShutdownTracker} The shutdown tracker instance.
 */
export function createShutdownTracker (logger) {
  /** @type {Set<Promise<any>>} */
  const inflight = new Set()
  let shuttingDown = false

  return {
    /**
     * Runs the function and tracks it.
     *
     * @template T
     * @param {() => Promise<T>} fn - Function to track.
     * @returns {Promise<T>} Promise returning the function result.
     */
    async track (fn) {
      const promise = fn()
      inflight.add(promise)
      try {
        return await promise
      } finally {
        inflight.delete(promise)
      }
    },

    /**
     * Waits for every tracked operation to settle.
     *
     * @param {number} timeoutMs - Timeout budget in milliseconds.
     * @returns {Promise<{ drained: boolean, remaining: number }>} Result indicating whether all operations drained.
     */
    async waitForAll (timeoutMs) {
      if (inflight.size === 0) {
        return {
          drained: true,
          remaining: 0
        }
      }
      if (timeoutMs <= 0) {
        return {
          drained: false,
          remaining: inflight.size
        }
      }

      const snapshot = Array.from(inflight)

      /** @type {any} */
      let timerId = null

      const allSettled = Promise.allSettled(snapshot).then(() => {
        if (timerId !== null) {
          clearTimeout(timerId)
        }
        return {
          drained: true,
          remaining: 0
        }
      })

      /** @type {Promise<{ drained: boolean, remaining: number }>} */
      const timer = new Promise((resolve) => {
        timerId = setTimeout(() => {
          resolve({
            drained: false,
            remaining: inflight.size
          })
        }, timeoutMs)
      })

      return Promise.race([allSettled, timer])
    },

    startShutdown () {
      if (!shuttingDown) {
        shuttingDown = true
        logger?.info('shutdown started')
      }
    },

    isShuttingDown () {
      return shuttingDown
    },

    inFlightCount () {
      return inflight.size
    }
  }
}

/**
 * Installs SIGTERM and SIGINT handlers.
 *
 * @param {object} deps - Dependencies.
 * @param {() => Promise<void>} deps.onSignal - Callback invoked on signal.
 * @param {import('./diagnostics/logger.js').Logger} [deps.logger] - Optional logger.
 * @returns {() => void} Cleanup function.
 */
export function installSignalHandlers ({ onSignal, logger }) {
  let triggered = false

  /**
   * Internal signal listener.
   *
   * @param {string} signal - Signal name.
   */
  async function handler (signal) {
    if (triggered) {
      logger?.warn('shutdown: signal received during shutdown', { meta: { signal } })
      return
    }
    triggered = true
    logger?.info('shutdown: signal received', { meta: { signal } })
    try {
      await onSignal()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger?.error('shutdown: handler failed', { meta: { error: errorMsg } })
    }
  }

  const sigtermListener = () => {
    handler('SIGTERM')
  }
  const sigintListener = () => {
    handler('SIGINT')
  }

  process.on('SIGTERM', sigtermListener)
  process.on('SIGINT', sigintListener)

  return () => {
    process.off('SIGTERM', sigtermListener)
    process.off('SIGINT', sigintListener)
  }
}

/**
 * Runs the shutdown sequence.
 *
 * @param {object} deps - Dependencies.
 * @param {{ stop: (opts?: { drainMs?: number }) => Promise<{ drained: boolean, remaining: number }> }} deps.runtime - Runtime instance.
 * @param {number} [deps.drainMs=30000] - Drain budget in milliseconds.
 * @param {import('./diagnostics/logger.js').Logger} [deps.logger] - Optional logger.
 * @returns {Promise<number>} Exit code (0 for success, 1 for failure/timeout).
 */
export async function runShutdownSequence ({ runtime, drainMs = 30000, logger }) {
  logger?.info('shutdown: starting', { meta: { drain_ms: drainMs } })
  try {
    const result = await runtime.stop({ drainMs })
    if (!result.drained) {
      logger?.warn('shutdown: drain timeout', { meta: { remaining: result.remaining } })
      return 1
    }
    logger?.info('shutdown: complete')
    return 0
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger?.error('shutdown: failed', { meta: { error: errorMsg } })
    return 1
  }
}
