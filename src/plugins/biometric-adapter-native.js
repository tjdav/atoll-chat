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
 * Creates a NativeBiometricAdapter instance.
 *
 * @param {Object} [_instanceContext] - Optional instance context.
 * @returns {Object} The NativeBiometricAdapter instance.
 */
export function createNativeBiometricAdapter (_instanceContext) {
  return {
    /**
     * Checks if biometric authentication is available on the device.
     *
     * @returns {Promise<boolean>} Resolves to true for the stub.
     */
    isAvailable: async () => {
      return true
    },

    /**
     * Stub implementation to simulate storing a master key in secure enclave.
     *
     * @param {Uint8Array} key - The raw 256-bit AES Master Key.
     * @param {string} _username - The username of the logged-in user.
     * @param {string} userId - The unique identifier of the logged-in user.
     * @returns {Promise<void>}
     */
    storeMasterKey: async (key, _username, userId) => {
      console.info('[NativeBiometricAdapter] Bypassing native secure storage for now')
      const b64 = uint8ArrayToBase64(key)
      const payload = {
        mockSecureEnclave: true,
        key: b64
      }
      localStorage.setItem(`atoll_vault_wrap_${userId}`, JSON.stringify(payload))
    },

    /**
     * Stub implementation to simulate retrieving a master key from secure enclave.
     *
     * @param {string} userId - The unique identifier of the logged-in user.
     * @returns {Promise<Uint8Array>} Resolves to the decrypted AES Master Key.
     */
    retrieveMasterKey: async (userId) => {
      const rawData = localStorage.getItem(`atoll_vault_wrap_${userId}`)
      if (!rawData) {
        throw new Error('No biometric vault wrap found for this user.')
      }

      const { key } = JSON.parse(rawData)
      return base64ToUint8Array(key)
    },

    /**
     * Clears the encrypted biometric wrap from localStorage.
     *
     * @param {string} userId - The unique identifier of the logged-in user.
     * @returns {Promise<void>}
     */
    deleteMasterKey: async (userId) => {
      localStorage.removeItem(`atoll_vault_wrap_${userId}`)
    }
  }
}
