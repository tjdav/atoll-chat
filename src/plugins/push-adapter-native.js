/**
 * Creates a NativePushAdapter instance.
 *
 * @param {Object} [_instanceContext] - Optional instance context.
 * @returns {Object} The NativePushAdapter instance.
 */
export function createNativePushAdapter (_instanceContext) {
  return {
    /**
     * Stubs the notification permission request for native environments.
     *
     * @returns {Promise<boolean>} Resolves to true.
     */
    async requestPermission () {
      console.info('[NativePushAdapter] Requesting native push notification permissions (stubbed).')
      return true
    },

    /**
     * Stubs native push registration. Returns a mock device token.
     *
     * @returns {Promise<string>} A mock native device token.
     */
    async register () {
      console.info('[NativePushAdapter] Registering with FCM/APNs gateway (stubbed).')

      /*
       * ARCHITECTURAL BOUNDARY WARNING:
       * In a full-production native application (iOS/Android), when the mobile WebView is
       * suspended or completely terminated, a data-only push notification cannot reliably
       * wake up the JavaScript context.
       *
       * To achieve headless end-to-end decryption (E2EE) on a native platform:
       * 1. This client-side code will register for push notifications and send the FCM/APNs
       *    token to the PocketBase backend.
       * 2. When a new encrypted message is received, the backend sends a high-priority,
       *    data-only background notification to APNs/FCM.
       * 3. The mobile OS intercepts the notification *before* displaying it to the user:
       *    - iOS uses a `NotificationServiceExtension` (compiled Swift/Obj-C binary).
       *    - Android uses a background `FirebaseMessagingService` (compiled Java/Kotlin service).
       * 4. These native OS extensions must link against a native Libsodium wrapper.
       *    They fetch the encrypted payload, read the recipient's private key (stored in the
       *    device's secure Keychain/KeyStore), decrypt the message natively, and display a
       *    rich notification dynamically in native memory without waking up the main WebView.
       */

      return 'mock-fcm-token-12345'
    }
  }
}
