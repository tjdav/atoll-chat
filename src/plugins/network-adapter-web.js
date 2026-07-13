/**
 * Creates an instance of the Web Network Adapter.
 *
 * @returns {Object} An object exposing the network adapter API.
 */
export function createWebNetworkAdapter () {
  return {
    /**
     * Registers window online and offline listeners to detect network status.
     *
     * @param {Object} bus The global event bus.
     */
    registerListeners (bus) {
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
          console.info('[WebNetworkAdapter] Browser went online.')
          bus.emit('app:network_change', {
            isOnline: true
          })
        })

        window.addEventListener('offline', () => {
          console.info('[WebNetworkAdapter] Browser went offline.')
          bus.emit('app:network_change', {
            isOnline: false
          })
        })

        bus.emit('app:network_change', {
          isOnline: navigator.onLine
        })
      }
    }
  }
}
