/**
 * Converts a URL-safe Base64 string to a Uint8Array.
 *
 * @param {string} base64String - The URL-safe Base64 VAPID public key.
 * @returns {Uint8Array} The converted Uint8Array.
 * @throws {Error} Re-throws unexpected formatting errors.
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
     * @throws {Error} Re-throws unexpected exceptions during permission requests.
     */
    async requestPermission () {
      if (!('Notification' in window)) {
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
     * @throws {Error} Throws an error if VAPID public key is missing, or unexpected registration issues occur.
     */
    async register (vapidKey) {
      if (!vapidKey) {
        throw new Error('[WebPushAdapter] VAPID public key is required for registration.')
      }

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
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

      const applicationServerKey = urlBase64ToUint8Array(vapidKey)
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      })

      return subscription.toJSON()
    }
  }
}
