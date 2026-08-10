import { Network } from '@capacitor/network'

/**
 * Creates an instance of the Native Network Adapter.
 *
 * @returns {Object} An object exposing the native network adapter API.
 */
export function createNativeNetworkAdapter () {
  return {
    /**
     * Registers Capacitor Network change listeners to detect OS-level status.
     *
     * @param {Object} bus The global event bus.
     * @returns {Promise<void>} Resolves when listeners are registered and initial status has been processed.
     * @throws {Error} Propagates any error encountered while getting initial network status.
     */
    async registerListeners (bus) {
      Network.addListener('networkStatusChange', (status) => {
        bus.emit('app:network_change', {
          isOnline: status.connected
        })
      })

      try {
        const status = await Network.getStatus()
        bus.emit('app:network_change', {
          isOnline: status.connected
        })
      } catch (err) {
        bus.emit('app:network_change', {
          isOnline: false
        })
        throw err
      }
    }
  }
}
