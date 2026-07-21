import { definePlugin } from 'coralite'

export default definePlugin({
  name: 'biometric',
  client: {
    context: (_pluginContext) => {
      let resolvedAdapter = null

      const getAdapter = async (instanceContext) => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            console.info('[biometric-plugin] Native platform detected. Loading NativeBiometricAdapter.')
            const { createNativeBiometricAdapter } = await import('./biometric-adapter-native.js')
            resolvedAdapter = createNativeBiometricAdapter(instanceContext)
            return resolvedAdapter
          }
        } catch (_err) {
          // Fall back gracefully to WebBiometricAdapter
        }

        console.info('[biometric-plugin] Web platform detected. Loading WebBiometricAdapter.')
        const { createWebBiometricAdapter } = await import('./biometric-adapter-web.js')
        resolvedAdapter = createWebBiometricAdapter(instanceContext)
        return resolvedAdapter
      }

      return (instanceContext) => {
        const api = {
          /**
           * Checks if biometric unlock is supported and available on the current platform/browser.
           *
           * @returns {Promise<boolean>} True if available, false otherwise.
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
           */
          storeMasterKey: async (key, username, userId) => {
            const adapter = await getAdapter(instanceContext)
            return adapter.storeMasterKey(key, username, userId)
          },

          /**
           * Prompts for biometric verification, decrypts, and returns the raw AES Master Key.
           *
           * @param {string} userId - The unique identifier of the logged-in user.
           * @returns {Promise<Uint8Array>} Resolves to the decrypted AES Master Key.
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
