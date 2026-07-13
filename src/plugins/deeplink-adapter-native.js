/**
 * Creates an instance of the Native Deep Link Adapter.
 *
 * @param {Object} [_instanceContext] Optional instance context.
 * @returns {Object} Exposes standard deep link adapter methods.
 */
export function createNativeDeepLinkAdapter (_instanceContext) {
  return {
    /**
     * Initializes the adapter to listen to native OS appUrlOpen events.
     *
     * @param {Object} bus Global event bus.
     * @returns {Promise<void>} Resolves when the listener is set up.
     */
    async initialize (bus) {
      try {
        const { App } = await import('@capacitor/app')
        await App.addListener('appUrlOpen', (event) => {
          console.log('[NativeDeepLinkAdapter] App URL opened event:', event)
          if (!event.url) {
            return
          }

          try {
            const parsed = new URL(event.url)
            const queryParams = {}
            const params = new URLSearchParams(parsed.search)
            for (const [key, value] of params.entries()) {
              queryParams[key] = value
            }

            const payload = {
              path: parsed.pathname,
              queryParams
            }

            console.log('[NativeDeepLinkAdapter] Emitting app:route_requested:', payload)
            bus.emit('app:route_requested', payload)
          } catch (err) {
            console.error('[NativeDeepLinkAdapter] Failed to parse opened URL:', event.url, err)
          }
        })
      } catch (err) {
        console.error('[NativeDeepLinkAdapter] Failed to load @capacitor/app or add listener:', err)
      }
    }
  }
}
