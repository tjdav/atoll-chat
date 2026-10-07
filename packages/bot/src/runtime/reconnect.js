/**
 * Default sleep implementation.
 *
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>}
 */
function defaultSleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Computes the delay before the next reconnect attempt.
 *
 * Uses exponential backoff with proportional jitter. The base delay
 * doubles on each attempt, capped at `maxBackoffMs`. Jitter is
 * applied as ±`jitter * base`, where `base` is the uncapped delay.
 *
 * @param {object} params
 * @param {number} params.attempt - The attempt number. 1 for the
 *   first reconnect after a close.
 * @param {number} params.baseBackoffMs - Base delay in milliseconds.
 * @param {number} params.maxBackoffMs - Maximum delay before jitter.
 * @param {number} params.jitter - Fractional jitter amount, e.g. 0.2
 *   for ±20%.
 * @param {() => number} [params.random=Math.random] - Random source.
 *   Parameterized for testing.
 * @returns {number} The delay in milliseconds, clamped to
 *   [0, maxBackoffMs * (1 + jitter)].
 */
export function computeBackoffDelay ({
  attempt, baseBackoffMs, maxBackoffMs, jitter, random = Math.random
}) {
  const exponential = Math.min(baseBackoffMs * Math.pow(2, attempt - 1), maxBackoffMs)
  const delta = exponential * jitter * ((2 * random()) - 1)
  return Math.max(0, exponential + delta)
}

/**
 * @typedef {object} ReconnectController
 * @property {() => void} start - Begins watching for WebSocket
 *   closes. Idempotent.
 * @property {() => Promise<void>} stop - Cancels the pending sleep
 *   and awaits the current loop iteration. Idempotent.
 * @property {(roomId: string) => Promise<void>} notifySseClosed - Called by the
 *   runtime when an SSE stream closes. Triggers an SSE reconnect
 *   pass with its own backoff.
 * @property {() => number} currentAttempt - The WebSocket attempt
 *   counter for diagnostics.
 */

/**
 * Creates the reconnect controller.
 *
 * The controller drives the WebSocket client's reconnect loop and,
 * separately, reconnects any SSE streams the runtime reports as
 * disconnected. Both use the same backoff parameters.
 *
 * The controller does not perform the initial connection. The
 * runtime's `start()` calls `ws.connect()` directly. The controller
 * begins watching after that call succeeds.
 *
 * @param {object} deps
 * @param {import('./transport/websocket.js').WebSocketClient} deps.ws -
 *   The WebSocket client.
 * @param {number} deps.baseBackoffMs - Base delay.
 * @param {number} deps.maxBackoffMs - Cap.
 * @param {number} deps.jitter - Fractional jitter.
 * @param {number} [deps.stableConnectionMs=5000] - A connection
 *   lasting at least this long is considered stable and resets the
 *   attempt counter.
 * @param {() => Promise<void>} deps.onConnected - Runs after each
 *   successful reconnect. Errors are logged but do not abort the
 *   loop.
 * @param {(roomId?: string) => Promise<void>} deps.reconnectSse - Runs after each
 *   successful WebSocket reconnect and on every SSE close. Reconnects
 *   the SSE streams.
 * @param {(ms: number) => Promise<void>} [deps.sleep=defaultSleep] -
 *   The sleep function. Parameterized for testing.
 * @param {() => number} [deps.now=Date.now] - The clock.
 * @param {() => number} [deps.random=Math.random] - Random source.
 * @param {import('./diagnostics/logger.js').Logger} [deps.logger] -
 *   Optional logger.
 * @returns {ReconnectController} The controller.
 */
export function createReconnectController ({
  ws,
  baseBackoffMs,
  maxBackoffMs,
  jitter,
  stableConnectionMs = 5000,
  onConnected,
  reconnectSse,
  sleep = defaultSleep,
  now = Date.now,
  random = Math.random,
  logger
}) {
  let attempt = 0
  /** @type {number | null} */
  let connectedAt = null
  let stopped = true
  /** @type {(() => void) | null} */
  let unsubscribeClose = null

  /** @type {Promise<void> | null} */
  let currentLoopPromise = null
  /** @type {Promise<void> | null} */
  let currentConnectPromise = null

  /** @type {Set<() => void>} */
  const pendingSleepCancels = new Set()

  /** @type {Map<string, { attempt: number, inFlight: boolean, loopPromise: Promise<void> | null }>} */
  const sseStates = new Map()

  /**
   * Cancellable sleep wrapper.
   *
   * @param {number} ms - Sleep duration.
   * @returns {Promise<void>}
   */
  function cancellableSleep (ms) {
    if (stopped) {
      return Promise.resolve()
    }
    /** @type {((value?: void) => void) | null} */
    let cancel = null
    const cancelPromise = new Promise((resolve) => {
      cancel = resolve
    })
    if (cancel) {
      pendingSleepCancels.add(cancel)
    }

    const sleepPromise = Promise.resolve().then(() => sleep(ms)).catch(() => {})

    return Promise.race([sleepPromise, cancelPromise]).finally(() => {
      if (cancel) {
        pendingSleepCancels.delete(cancel)
      }
    })
  }

  /**
   * Main WebSocket reconnect loop.
   *
   * @returns {Promise<void>}
   */
  async function loop () {
    attempt++
    const delay = computeBackoffDelay({
      attempt,
      baseBackoffMs,
      maxBackoffMs,
      jitter,
      random
    })
    logger?.debug('reconnect scheduled', { meta: { attempt, delay_ms: delay } })
    await cancellableSleep(delay)
    if (stopped) {
      currentLoopPromise = null
      return
    }

    try {
      currentConnectPromise = ws.connect()
      await currentConnectPromise
      currentConnectPromise = null
      if (stopped) {
        currentLoopPromise = null
        return
      }

      connectedAt = now()
      logger?.info('reconnected', { meta: { attempt } })
      await onConnected().catch((err) => {
        logger?.warn('post-reconnect sequence failed', { meta: { error: err?.message ?? String(err) } })
      })
      await reconnectSse().catch((err) => {
        logger?.warn('sse reconnect pass failed', { meta: { error: err?.message ?? String(err) } })
      })
      currentLoopPromise = null
      // Successful connect. The loop stops; a future close re-triggers it.
    } catch (err) {
      currentConnectPromise = null
      logger?.warn('reconnect failed', { meta: { attempt, error: err instanceof Error ? err.message : String(err) } })
      if (stopped) {
        currentLoopPromise = null
        return
      }
      return loop()
    }
  }

  /**
   * Handles WebSocket close events.
   */
  function handleClose () {
    if (stopped) {
      return
    }
    if (connectedAt !== null && now() - connectedAt >= stableConnectionMs) {
      attempt = 0
    }
    connectedAt = null
    if (!currentLoopPromise) {
      currentLoopPromise = loop()
    }
  }

  /**
   * Performs the SSE reconnection loop for a specific room.
   *
   * @param {string} roomId - Room ID.
   * @returns {Promise<void>}
   */
  async function runSseReconnect (roomId) {
    let st = sseStates.get(roomId)
    if (!st) {
      st = { attempt: 0, inFlight: false, loopPromise: null }
      sseStates.set(roomId, st)
    }
    if (st.inFlight) {
      return
    }
    st.inFlight = true

    try {
      while (!stopped) {
        st.attempt++
        const delay = computeBackoffDelay({
          attempt: st.attempt,
          baseBackoffMs,
          maxBackoffMs,
          jitter,
          random
        })
        logger?.debug('sse reconnect scheduled', { meta: { room_id: roomId, attempt: st.attempt, delay_ms: delay } })
        await cancellableSleep(delay)
        if (stopped) {
          break
        }

        try {
          await reconnectSse(roomId)
          st.attempt = 0
          logger?.debug('sse reconnected', { meta: { room_id: roomId } })
          break
        } catch (err) {
          logger?.warn('sse reconnect failed', { meta: { room_id: roomId, error: err instanceof Error ? err.message : String(err) } })
          if (stopped) {
            break
          }
        }
      }
    } finally {
      st.inFlight = false
      st.loopPromise = null
    }
  }

  /**
   * Called by the runtime when an SSE stream closes.
   *
   * @param {string} roomId - Room ID.
   * @returns {Promise<void>}
   */
  async function notifySseClosed (roomId) {
    if (stopped) {
      return
    }
    let st = sseStates.get(roomId)
    if (!st) {
      st = { attempt: 0, inFlight: false, loopPromise: null }
      sseStates.set(roomId, st)
    }
    if (st.inFlight && st.loopPromise) {
      return st.loopPromise
    }
    st.loopPromise = runSseReconnect(roomId)
    return st.loopPromise
  }

  /**
   * Begins watching for WebSocket closes. Idempotent.
   */
  function start () {
    if (!stopped && unsubscribeClose) {
      return
    }
    stopped = false
    connectedAt = now()
    if (!unsubscribeClose) {
      unsubscribeClose = ws.on('close', handleClose)
    }
  }

  /**
   * Cancels pending sleeps and awaits current loop iterations. Idempotent.
   *
   * @returns {Promise<void>}
   */
  async function stop () {
    if (stopped) {
      return
    }
    stopped = true

    if (unsubscribeClose) {
      unsubscribeClose()
      unsubscribeClose = null
    }

    for (const cancel of pendingSleepCancels) {
      cancel()
    }
    pendingSleepCancels.clear()

    if (currentLoopPromise) {
      await currentLoopPromise.catch(() => {})
    }
    if (currentConnectPromise) {
      await currentConnectPromise.catch(() => {})
    }

    const ssePromises = Array.from(sseStates.values())
      .map((st) => st.loopPromise)
      .filter(Boolean)
    if (ssePromises.length > 0) {
      await Promise.allSettled(ssePromises)
    }
  }

  /**
   * Returns the WebSocket attempt counter.
   *
   * @returns {number}
   */
  function currentAttempt () {
    return attempt
  }

  return {
    start,
    stop,
    notifySseClosed,
    currentAttempt
  }
}
