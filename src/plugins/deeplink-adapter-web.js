/**
 * Creates an instance of the Web Deep Link Adapter.
 *
 * @param {Object} [_instanceContext] Optional instance context.
 * @returns {Object} Exposes standard deep link adapter methods.
 */
export function createWebDeepLinkAdapter (_instanceContext) {
  return {
    /**
     * Initializes the adapter to read URL on boot and listen to popstate navigations.
     *
     * @param {Object} bus Global event bus.
     */
    initialize (bus) {
      const getRoutePayload = (pathname, search) => {
        const queryParams = {}
        try {
          const params = new URLSearchParams(search)
          for (const [key, value] of params.entries()) {
            queryParams[key] = value
          }
        } catch (err) {
          console.error('[WebDeepLinkAdapter] Failed to parse search parameters:', err)
        }
        return {
          path: pathname,
          queryParams
        }
      }

      /* Broadcast initial route on boot */
      const initialPayload = getRoutePayload(window.location.pathname, window.location.search)
      console.log('[WebDeepLinkAdapter] Initial route on boot:', initialPayload)
      bus.emit('app:route_requested', initialPayload)

      /* Listen to browser popstate for runtime URL updates */
      const onPopState = () => {
        const payload = getRoutePayload(window.location.pathname, window.location.search)
        console.log('[WebDeepLinkAdapter] Route updated via popstate:', payload)
        bus.emit('app:route_requested', payload)
      }

      window.addEventListener('popstate', onPopState)

      if (_instanceContext && _instanceContext.signal) {
        _instanceContext.signal.addEventListener('abort', () => {
          window.removeEventListener('popstate', onPopState)
        })
      }
    }
  }
}
