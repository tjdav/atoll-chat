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
     */
    async registerListeners (bus) {
      Network.addListener('networkStatusChange', (status) => {
        console.info('[NativeNetworkAdapter] Network status changed:', status)
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
        console.error('[NativeNetworkAdapter] Failed to get initial network status:', err)
      }
    }
  }
}
