import { definePlugin } from 'coralite'

/**
 * Biometric Plugin for Atoll Chat.
 * Provides biometric lock/unlock support on native mobile platforms via Capacitor
 * and falls back gracefully to a standard Web biometric flow on desktop/web environments.
 */
export default definePlugin({
  name: 'biometric',
  client: {
    /**
     * Symmetrical context resolver for the Biometric plugin (Phase 1).
     *
     * @param {Object} _pluginContext - Symmetrical build-time plugin configuration context.
     * @returns {Function} Symmetrical local instance context resolver function.
     */
    context: (_pluginContext) => {
      let resolvedAdapter = null

      /**
       * Dynamically retrieves and instantiates the correct platform biometric adapter.
       * Caches the resolved adapter after initialization.
       *
       * @param {Object} instanceContext - The Coralite runtime instance context.
       * @returns {Promise<Object>} The resolved platform-specific biometric adapter.
       * @throws {Error} If dynamic module import fails due to an unexpected system or network error.
       */
      const getAdapter = async (instanceContext) => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            const { createNativeBiometricAdapter } = await import('./biometric-adapter-native.js')
            resolvedAdapter = createNativeBiometricAdapter(instanceContext)
            return resolvedAdapter
          }
        } catch (err) {
          const isMissingModule = err instanceof Error && (
            err.code === 'MODULE_NOT_FOUND' ||
            err.message.includes('Failed to resolve') ||
            err.message.includes('Cannot find module')
          )
          if (!isMissingModule) {
            throw err
          }
          // Gracefully handle expected import failures on non-native environments by falling back to the Web adapter.
        }

        const { createWebBiometricAdapter } = await import('./biometric-adapter-web.js')
        resolvedAdapter = createWebBiometricAdapter(instanceContext)
        return resolvedAdapter
      }

      /**
       * Symmetrical local instance context resolver for the Biometric plugin (Phase 2).
       *
       * @param {Object} instanceContext - The local Coralite component instance context.
       * @returns {Object} Symmetrical instance API wrapper namespace for biometric interactions.
       */
      return (instanceContext) => {
        const api = {
          /**
           * Checks if biometric unlock is supported and available on the current platform/browser.
           *
           * @returns {Promise<boolean>} True if available, false otherwise.
           * @throws {Error} If the underlying adapter fails unexpectedly.
           */
          isAvailable: async () => {
            const adapter = await getAdapter(instanceContext)
            return adapter.isAvailable()
          },

          /**
           * Encrypts and securely stores the raw AES Master Key under a biometric-derived key.
           *
           * @param {Uint8Array} key - The raw 256-bit AES Master Key.
           * @param {string} username - The username of the logged-in user.
           * @param {string} userId - The unique identifier of the logged-in user.
           * @returns {Promise<void>}
           * @throws {Error} If the secure storage operation fails.
           */
          storeMasterKey: async (key, username, userId) => {
            const adapter = await getAdapter(instanceContext)
            return adapter.storeMasterKey(key, username, userId)
          },

          /**
           * Prompts for biometric verification, decrypts, and returns the raw AES Master Key.
           *
           * @param {string} userId - The unique identifier of the logged-in user.
           * @param {Object} userRecord - The PocketBase user record object.
           * @returns {Promise<Uint8Array>} Resolves to the decrypted AES Master Key.
           * @throws {Error} If verification fails or the master key cannot be retrieved.
           */
          retrieveMasterKey: async (userId, userRecord) => {
            const adapter = await getAdapter(instanceContext)
            return adapter.retrieveMasterKey(userId, userRecord)
          },

          /**
           * Deletes the securely stored AES Master Key metadata.
           *
           * @param {string} userId - The unique identifier of the logged-in user.
           * @returns {Promise<void>}
           * @throws {Error} If deletion fails.
           */
          deleteMasterKey: async (userId) => {
            const adapter = await getAdapter(instanceContext)
            return adapter.deleteMasterKey(userId)
          }
        }

        api.$biometric = api
        return api
      }
    }
  }
})
