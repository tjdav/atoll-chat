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
 * Creates a WebBiometricAdapter instance.
 *
 * @param {Object} [_instanceContext] - Optional instance context.
 * @returns {Object} The WebBiometricAdapter instance.
 */
export function createWebBiometricAdapter (_instanceContext) {
  return {
    /**
     * Checks if window.PublicKeyCredential and the prf extension are supported.
     *
     * @returns {Promise<boolean>} True if WebAuthn PRF is supported, false otherwise.
     */
    isAvailable: async () => {
      return typeof window !== 'undefined' && !!window.PublicKeyCredential
    },

    /**
     * Registers a new WebAuthn credential, derives a PRF seed, encrypts the provided master key,
     * and saves the metadata locally.
     *
     * @param {Uint8Array} key - The raw 256-bit AES Master Key.
     * @param {string} username - The username of the logged-in user.
     * @param {string} userId - The unique identifier of the logged-in user.
     * @returns {Promise<void>}
     */
    storeMasterKey: async (key, username, userId) => {
      if (!window.PublicKeyCredential) {
        throw new Error('WebAuthn is not supported on this device.')
      }

      const prfSalt = window.crypto.getRandomValues(new Uint8Array(32))
      const challenge = window.crypto.getRandomValues(new Uint8Array(32))

      const creationOptions = {
        challenge,
        rp: {
          name: 'Atoll Chat',
          id: window.location.hostname
        },
        user: {
          id: window.crypto.getRandomValues(new Uint8Array(16)),
          name: username,
          displayName: username
        },
        pubKeyCredParams: [
          {
            alg: -7,
            type: 'public-key'
          },
          {
            alg: -257,
            type: 'public-key'
          }
        ],
        authenticatorSelection: {
          userVerification: 'required',
          residentKey: 'required',
          requireResidentKey: true
        },
        extensions: {
          prf: {
            eval: {
              first: prfSalt
            }
          }
        }
      }

      const credential = await navigator.credentials.create({
        publicKey: creationOptions
      })

      if (!credential) {
        throw new Error('Credential creation failed.')
      }

      const extensionResults = credential.getClientExtensionResults()
      const prfEnabled = !!(extensionResults.prf && extensionResults.prf.enabled)

      if (!prfEnabled) {
        throw new Error('This authenticator does not support the PRF extension.')
      }

      let prfResult = null
      if (extensionResults.prf && extensionResults.prf.results && extensionResults.prf.results.first) {
        prfResult = new Uint8Array(extensionResults.prf.results.first)
      } else if (extensionResults.prf && extensionResults.prf.first) {
        prfResult = new Uint8Array(extensionResults.prf.first)
      }

      if (!prfResult) {
        throw new Error('WebAuthn PRF extension result was not found.')
      }

      const prfSeed = new Uint8Array(prfResult)

      const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        prfSeed,
        {
          name: 'AES-GCM'
        },
        false,
        ['encrypt']
      )

      const iv = window.crypto.getRandomValues(new Uint8Array(12))
      const encryptedBuffer = await window.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv
        },
        cryptoKey,
        key
      )

      const ciphertext = new Uint8Array(encryptedBuffer)

      const payload = {
        credentialId: uint8ArrayToBase64(new Uint8Array(credential.rawId)),
        salt: uint8ArrayToBase64(prfSalt),
        iv: uint8ArrayToBase64(iv),
        ciphertext: uint8ArrayToBase64(ciphertext)
      }

      localStorage.setItem(`atoll_vault_wrap_${userId}`, JSON.stringify(payload))
    },

    /**
     * Prompts WebAuthn authentication to reconstruct the PRF seed, retrieves metadata from localStorage,
     * decrypts and returns the raw AES Master Key.
     *
     * @param {string} userId - The unique identifier of the logged-in user.
     * @returns {Promise<Uint8Array>} Resolves to the decrypted AES Master Key.
     */
    retrieveMasterKey: async (userId, userRecord) => {
      const rawData = localStorage.getItem(`atoll_vault_wrap_${userId}`)
      if (!rawData) {
        if (userRecord && userRecord.passkey_credential_id && userRecord.passkey_prf_salt) {
          const { deriveKeyFromPasskey } = await import('../utils/cryptoUtils.js')
          const credentialId = base64ToUint8Array(userRecord.passkey_credential_id)
          const prfSalt = base64ToUint8Array(userRecord.passkey_prf_salt)
          const challenge = window.crypto.getRandomValues(new Uint8Array(32))
          return deriveKeyFromPasskey(credentialId, challenge, prfSalt)
        }
        throw new Error('No biometric vault wrap found for this user.')
      }

      const {
        credentialId,
        salt,
        iv,
        ciphertext
      } = JSON.parse(rawData)

      const challenge = window.crypto.getRandomValues(new Uint8Array(32))

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [
            {
              type: 'public-key',
              id: base64ToUint8Array(credentialId)
            }
          ],
          userVerification: 'required',
          extensions: {
            prf: {
              eval: {
                first: base64ToUint8Array(salt)
              }
            }
          }
        }
      })

      if (!assertion) {
        throw new Error('WebAuthn assertion failed.')
      }

      const extensionResults = assertion.getClientExtensionResults()
      let prfBuffer = null
      if (extensionResults.prf && extensionResults.prf.results && extensionResults.prf.results.first) {
        prfBuffer = extensionResults.prf.results.first
      } else if (extensionResults.prf && extensionResults.prf.first) {
        prfBuffer = extensionResults.prf.first
      }

      if (!prfBuffer) {
        throw new Error('WebAuthn PRF extension result was not found.')
      }

      const prfSeed = new Uint8Array(prfBuffer)

      const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        prfSeed,
        {
          name: 'AES-GCM'
        },
        false,
        ['decrypt']
      )

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: base64ToUint8Array(iv)
        },
        cryptoKey,
        base64ToUint8Array(ciphertext)
      )

      return new Uint8Array(decryptedBuffer)
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
