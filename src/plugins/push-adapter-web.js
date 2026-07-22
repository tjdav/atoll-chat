/**
 * Converts a URL-safe Base64 string to a Uint8Array.
 *
 * @param {string} base64String - The URL-safe Base64 VAPID public key.
 * @returns {Uint8Array} The converted Uint8Array.
 */
function urlBase64ToUint8Array (base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  if (outputArray.length !== 65 || outputArray[0] !== 4) {
    console.error(`[WebPushAdapter] Invalid VAPID public key format. Expected 65-byte uncompressed P-256 key starting with 0x04 (got ${outputArray.length} bytes, first byte: 0x${outputArray[0]?.toString(16)}).`)
  }

  return outputArray
}

/**
 * Creates a WebPushAdapter instance.
 *
 * @param {Object} [_instanceContext] - Optional instance context.
 * @returns {Object} The WebPushAdapter instance.
 */
export function createWebPushAdapter (_instanceContext) {
  return {
    /**
     * Prompts the browser for Notification permissions.
     *
     * @returns {Promise<boolean>} Resolves to true if granted, false otherwise.
     */
    async requestPermission () {
      if (!('Notification' in window)) {
        console.warn('[WebPushAdapter] This browser does not support notifications.')
        return false
      }
      if (Notification.permission === 'granted') {
        return true
      }
      if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission()
        return permission === 'granted'
      }
      return false
    },

    /**
     * Registers a PushManager subscription using the provided VAPID public key.
     *
     * @param {string} vapidKey - The VAPID public key.
     * @returns {Promise<Object|null>} The subscription payload, or null if unsupported.
     */
    async register (vapidKey) {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[WebPushAdapter] Service workers or Push notifications are not supported.')
        return null
      }

      const registration = await navigator.serviceWorker.ready
      if (!registration) {
        throw new Error('[WebPushAdapter] Service worker registration not found')
      }

      let subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        return subscription.toJSON()
      }

      if (!vapidKey) {
        throw new Error('[WebPushAdapter] VAPID public key is required for subscription.')
      }

      const applicationServerKey = urlBase64ToUint8Array(vapidKey)
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      })

      return subscription.toJSON()
    }
  }
}
