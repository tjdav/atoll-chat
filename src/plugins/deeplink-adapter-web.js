/**
 * Creates an instance of the Web Deep Link Adapter.
 *
 * @param {Object} instanceContext Global context of the instance.
 * @returns {Object} Exposes standard deep link adapter methods.
 */
export function createWebDeepLinkAdapter (instanceContext) {
  return {
    /**
     * Initializes the adapter to read URL on boot and listen to popstate navigations.
     *
     * @param {Object} bus Global event bus.
     */
    initialize (bus) {
      /**
       * Parses pathname and search parameters into a route payload.
       *
       * @param {string} pathname The current window location pathname.
       * @param {string} search The current window location search string.
       * @returns {Object} The route payload with path and query parameters.
       */
      const getRoutePayload = (pathname, search) => {
        const queryParams = {}
        try {
          const params = new URLSearchParams(search)
          for (const [key, value] of params.entries()) {
            queryParams[key] = value
          }
        } catch (err) {
          if (err instanceof TypeError || err instanceof ReferenceError) {
            throw err
          }
        }
        return {
          path: pathname,
          queryParams
        }
      }

      /* Broadcast initial route on boot */
      const initialPayload = getRoutePayload(window.location.pathname, window.location.search)
      bus.emit('app:route_requested', initialPayload)

      /* Listen to browser popstate for runtime URL updates */
      const onPopState = () => {
        const payload = getRoutePayload(window.location.pathname, window.location.search)
        bus.emit('app:route_requested', payload)
      }

      window.addEventListener('popstate', onPopState)

      instanceContext.signal.addEventListener('abort', () => {
        window.removeEventListener('popstate', onPopState)
      })
    }
  }
}
