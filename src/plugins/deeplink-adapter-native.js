/**
 * Creates an instance of the Native Deep Link Adapter.
 *
 * @param {Object} instanceContext Global context of the instance.
 * @returns {Object} Exposes standard deep link adapter methods.
 */
export function createNativeDeepLinkAdapter (instanceContext) {
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
        const listener = await App.addListener('appUrlOpen', (event) => {
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

            bus.emit('app:route_requested', payload)
          } catch (err) {
            if (err instanceof TypeError || err instanceof ReferenceError) {
              throw err
            }
          }
        })

        const signal = instanceContext.signal
        signal.addEventListener('abort', () => {
          listener.remove()
        })
      } catch (err) {
        if (err && err.code !== 'MODULE_NOT_FOUND' && !err.message?.includes('Cannot find module')) {
          throw err
        }
      }
    }
  }
}
