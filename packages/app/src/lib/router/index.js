/**
 * @file Router factory for Atoll in-page query parameter navigation.
 */

/**
 * @typedef {Record<string, string | null | undefined>} NavigationParams
 */

/**
 * Creates an in-page query parameter router.
 *
 * @param {object} [options]
 * @param {Window | object} [options.win] - Window or mock window object.
 * @param {string} [options.initialUrl] - Initial URL string for fallback/SSR.
 * @returns {object} Router instance.
 */
export function createRouter(options = {}) {
  const win = options.win ?? (typeof globalThis !== 'undefined' ? globalThis.window : undefined)
  const initialUrl = options.initialUrl ?? win?.location?.href ?? 'http://localhost/'

  const subscribers = new Set()

  /**
   * Parses the current window location or fallback initial URL.
   *
   * @private
   * @returns {URL} Parsed URL instance.
   */
  function getCurrentUrl() {
    const href = win?.location?.href ?? initialUrl
    return new URL(href, 'http://localhost')
  }

  /**
   * Notifies all subscribers of a URL state change.
   * Isolates errors so throwing subscribers do not prevent others from firing.
   *
   * @private
   */
  function notifySubscribers() {
    for (const cb of subscribers) {
      try {
        cb()
      } catch (err) {
        console.error('[router] Subscriber error:', err)
      }
    }
  }

  /**
   * Handler for browser popstate events.
   *
   * @private
   */
  function handlePopState() {
    notifySubscribers()
  }

  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('popstate', handlePopState)
  }

  return {
    /**
     * Gets the active 'rail' query parameter.
     *
     * @returns {string | null} Active rail ID or null.
     */
    getActiveRail() {
      const url = getCurrentUrl()
      return url.searchParams.get('rail')
    },

    /**
     * Gets the active 'detail' query parameter.
     *
     * @returns {string | null} Active detail view ID or null.
     */
    getActiveDetail() {
      const url = getCurrentUrl()
      return url.searchParams.get('detail')
    },

    /**
     * Gets the active 'id' selection query parameter.
     *
     * @returns {string | null} Selection ID or null.
     */
    getSelection() {
      const url = getCurrentUrl()
      return url.searchParams.get('id')
    },

    /**
     * Returns an object with all query parameters as string values.
     *
     * @returns {Record<string, string>} Map of all query parameters.
     */
    getParams() {
      const url = getCurrentUrl()
      const params = {}
      for (const [key, value] of url.searchParams.entries()) {
        params[key] = value
      }
      return params
    },

    /**
     * Navigates by updating the query string via history.pushState or history.replaceState.
     * Omits parameters whose values are null or undefined. Coerces other values with String().
     * Fires subscribers synchronously after navigation.
     *
     * @param {NavigationParams} params - Query parameters to update or set.
     * @param {object} [options] - Navigation options.
     * @param {boolean} [options.replace=false] - Whether to use replaceState instead of pushState.
     */
    navigate(params = {}, options = {}) {
      const url = getCurrentUrl()
      const searchParams = new URLSearchParams()

      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value))
        }
      }

      const queryString = searchParams.toString()
      const newPath = url.pathname + (queryString ? `?${queryString}` : '') + url.hash

      const replace = Boolean(options.replace)
      const method = replace ? 'replaceState' : 'pushState'

      if (win?.history && typeof win.history[method] === 'function') {
        win.history[method](null, '', newPath)
      }

      notifySubscribers()
    },

    /**
     * Navigates back in history by calling win.history.back().
     * Does not fire subscribers directly; the browser's popstate event fires them.
     */
    back() {
      if (win?.history && typeof win.history.back === 'function') {
        win.history.back()
      }
    },

    /**
     * Subscribes a callback listener for URL state changes.
     *
     * @param {() => void} cb - Callback function.
     * @returns {() => void} Unsubscribe function.
     */
    subscribe(cb) {
      if (typeof cb !== 'function') {
        return () => {}
      }
      subscribers.add(cb)
      return () => {
        subscribers.delete(cb)
      }
    },

    /**
     * Disposes the router instance by removing popstate listener and clearing subscribers.
     */
    dispose() {
      if (win && typeof win.removeEventListener === 'function') {
        win.removeEventListener('popstate', handlePopState)
      }
      subscribers.clear()
    }
  }
}
