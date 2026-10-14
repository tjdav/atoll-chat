/**
 * @typedef {object} OperatorResponse
 * @property {string} response - The operator's reply.
 * @property {'private' | 'public'} routing - Where the reply was delivered.
 * @property {string | null} roomId - The room the request originated in.
 * @property {string} respondedBy - The operator's user id.
 * @property {string} respondedAt - ISO 8601 timestamp.
 */

/**
 * @typedef {(response: OperatorResponse) => void | Promise<void>} Callback
 */

/**
 * @typedef {object} OperatorResponseEvent
 * @property {string} request_id
 * @property {string} response
 * @property {'private' | 'public'} routing
 * @property {string | null} [room_id]
 * @property {string} responded_by
 * @property {string} responded_at
 * @property {number} [bot_seq]
 */

/**
 * Creates the `ctx.onOperatorResponse` method and its dispatch handler.
 *
 * @param {object} deps
 * @param {import('../diagnostics/logger.js').Logger} [deps.logger] -
 *   Optional logger.
 * @returns {{
 *   onOperatorResponse: (handle: string, callback: Callback) => () => void,
 *   dispatch: (event: OperatorResponseEvent) => void,
 *   clear: () => void,
 *   size: () => number
 * }} The method, the dispatch handler, and lifecycle helpers.
 */
export function createOperatorResponseMethod ({ logger }) {
  /** @type {Map<string, Set<Callback>>} */
  const registry = new Map()

  /**
   * Registers a callback for an operator response handle.
   *
   * @param {string} handle - The request ID handle.
   * @param {Callback} callback - The callback function.
   * @returns {() => void} Unsubscribe function.
   */
  function onOperatorResponse (handle, callback) {
    if (typeof handle !== 'string' || handle.length === 0) {
      throw new TypeError(
        'ctx.onOperatorResponse: handle must be a non-empty string'
      )
    }

    if (typeof callback !== 'function') {
      throw new TypeError(
        'ctx.onOperatorResponse: callback must be a function'
      )
    }

    let set = registry.get(handle)
    if (!set) {
      set = new Set()
      registry.set(handle, set)
    }
    set.add(callback)

    logger?.debug('operator response registered', {
      meta: { request_id: handle }
    })

    let removed = false
    return () => {
      if (removed) {
        return
      }
      removed = true
      const s = registry.get(handle)
      if (!s) {
        return
      }
      s.delete(callback)
      if (s.size === 0) {
        registry.delete(handle)
      }
      logger?.debug('operator response unsubscribed', {
        meta: { request_id: handle }
      })
    }
  }

  /**
   * Dispatches a `bot.operator_response` channel event to registered callbacks.
   *
   * @param {OperatorResponseEvent} event - The wire event payload.
   */
  function dispatch (event) {
    if (!event || typeof event !== 'object') {
      logger?.warn('operator response: malformed event')
      return
    }

    const handle = event.request_id
    if (typeof handle !== 'string' || handle.length === 0) {
      logger?.warn('operator response: missing request_id')
      return
    }

    const set = registry.get(handle)
    if (!set || set.size === 0) {
      logger?.debug('operator response: no callback', {
        meta: { request_id: handle }
      })
      return
    }

    const response = {
      response: event.response,
      routing: event.routing,
      roomId: event.room_id ?? null,
      respondedBy: event.responded_by,
      respondedAt: event.responded_at
    }

    const callbacks = Array.from(set)
    for (const cb of callbacks) {
      try {
        const result = cb(response)
        if (result && typeof result.then === 'function') {
          result.catch((err) => {
            logger?.error('operator response callback failed', {
              meta: {
                request_id: handle,
                error: err instanceof Error ? err.message : String(err)
              }
            })
          })
        }
      } catch (err) {
        logger?.error('operator response callback threw', {
          meta: {
            request_id: handle,
            error: err instanceof Error ? err.message : String(err)
          }
        })
      }
    }
  }

  /**
   * Clears all registered callbacks and handles.
   */
  function clear () {
    registry.clear()
  }

  /**
   * Returns the count of active handle registrations in the registry.
   *
   * @returns {number} The map size.
   */
  function size () {
    return registry.size
  }

  return {
    onOperatorResponse,
    dispatch,
    clear,
    size
  }
}
