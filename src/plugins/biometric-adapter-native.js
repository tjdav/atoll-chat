/**
 * Helper to convert Uint8Array to Base64.
 *
 * @param {Uint8Array} u8 - The Uint8Array to convert.
 * @returns {string} The Base64 representation.
 */
function uint8ArrayToBase64 (u8) {
  let binary = ''
  const len = u8.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(u8[i])
  }
  return btoa(binary)
}

/**
 * Helper to convert Base64 to Uint8Array.
 *
 * @param {string} base64 - The Base64 string to convert.
 * @returns {Uint8Array} The Uint8Array.
 */
function base64ToUint8Array (base64) {
  const binaryString = atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * Creates a NativeBiometricAdapter instance using @capgo/capacitor-native-biometric.
 *
 * @returns {Object} The NativeBiometricAdapter instance.
 */
export function createNativeBiometricAdapter () {
  return {
    /**
     * Checks if biometric authentication is available on the device.
     *
     * @returns {Promise<boolean>} Resolves to true if available.
     */
    isAvailable: async () => {
      const { NativeBiometric } = await import('@capgo/capacitor-native-biometric')

      if (!NativeBiometric) {
        return false
      }
      const result = await NativeBiometric.isAvailable()

      return !!(result && result.isAvailable)
    },

    /**
     * Stores a master key securely in the device's Keychain (iOS) or Keystore (Android).
     *
     * @param {Uint8Array} key - The raw 256-bit AES Master Key.
     * @param {string} username - The username of the logged-in user.
     * @param {string} userId - The unique identifier of the logged-in user.
     * @returns {Promise<void>}
     * @throws {Error} If the biometric plugin is not available or storing credentials fails.
     */
    storeMasterKey: async (key, username, userId) => {
      try {
        const { NativeBiometric, AccessControl } = await import('@capgo/capacitor-native-biometric')

        if (!NativeBiometric) {
          throw new Error('Biometric plugin not available')
        }
        const b64 = uint8ArrayToBase64(key)

        await NativeBiometric.setCredentials({
          username: username || userId,
          password: b64,
          server: `atoll-chat-vault-${userId}`,
          accessControl: AccessControl.BIOMETRY_ANY,
          authValidityDuration: 15,
          title: 'Secure Vault Key',
          negativeButtonText: 'Cancel'
        })

        // Save a dummy payload in localStorage to indicate biometric unlock is enabled for this user.
        const payload = {
          mockSecureEnclave: false,
          userId
        }
        localStorage.setItem(`atoll_vault_wrap_${userId}`, JSON.stringify(payload))
      } catch (err) {
        throw err
      }
    },

    /**
     * Retrieves the securely stored master key after prompting biometric authentication.
     *
     * @param {string} userId - The unique identifier of the logged-in user.
     * @returns {Promise<Uint8Array>} Resolves to the decrypted AES Master Key.
     * @throws {Error} If retrieval or biometric verification fails.
     */
    retrieveMasterKey: async (userId) => {
      const rawData = localStorage.getItem(`atoll_vault_wrap_${userId}`)

      if (!rawData) {
        throw new Error('No biometric vault wrap found for this user.')
      }

      try {
        const { NativeBiometric } = await import('@capgo/capacitor-native-biometric')

        if (!NativeBiometric) {
          throw new Error('Biometric plugin not available')
        }

        const credentials = await NativeBiometric.getSecureCredentials({
          server: `atoll-chat-vault-${userId}`,
          reason: 'Unlock your secure vault',
          title: 'Verify Identity',
          subtitle: 'Scan your fingerprint to unlock Atoll Chat',
          description: 'This decrypts your zero-knowledge master key.',
          negativeButtonText: 'Cancel'
        })

        if (!credentials || !credentials.password) {
          throw new Error('Biometric retrieval failed or was canceled.')
        }

        return base64ToUint8Array(credentials.password)
      } catch (err) {
        throw err
      }
    },

    /**
     * Clears the securely stored master key and local indicator.
     *
     * @param {string} userId - The unique identifier of the logged-in user.
     * @returns {Promise<void>}
     */
    deleteMasterKey: async (userId) => {
      try {
        const { NativeBiometric } = await import('@capgo/capacitor-native-biometric')

        if (!NativeBiometric) {
          throw new Error('Biometric plugin not available')
        }

        await NativeBiometric.deleteCredentials({
          server: `atoll-chat-vault-${userId}`
        })
      } catch {
        // Ignored gracefully to allow clean fallback and non-blocking state cleanups
      }
      localStorage.removeItem(`atoll_vault_wrap_${userId}`)
    }
  }
}
