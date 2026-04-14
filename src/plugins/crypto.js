import { createPlugin } from 'coralite'

export default createPlugin({
  name: 'crypto-plugin',
  client: {
    setup (context) {
      // 1. generateECDHKeyPair: P-256 curve using Web Crypto API
      const generateECDHKeyPair = async () => {
        return window.crypto.subtle.generateKey(
          {
            name: 'ECDH',
            namedCurve: 'P-256'
          },
          true,
          ['deriveKey', 'deriveBits']
        )
      }

      // 2. generateAESKey: AES-GCM 256-bit
      const generateAESKey = async () => {
        return window.crypto.subtle.generateKey(
          {
            name: 'AES-GCM',
            length: 256
          },
          true,
          ['encrypt', 'decrypt']
        )
      }

      // 3. wrapKey and unwrapKey using AES-GCM direct encryption
      const wrapKey = async (keyToWrap, wrappingKey) => {
        // Export the key to raw format first
        const exportedKey = await window.crypto.subtle.exportKey(keyToWrap.type === 'private' ? 'pkcs8' : 'raw', keyToWrap)

        // Generate a random IV
        const iv = window.crypto.getRandomValues(new Uint8Array(12))

        // Encrypt the exported key using AES-GCM
        const encrypted = await window.crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv
          },
          wrappingKey,
          exportedKey
        )

        return {
          iv: Array.from(iv),
          ciphertext: Array.from(new Uint8Array(encrypted))
        }
      }

      const unwrapKey = async (wrappedData, wrappingKey, format = 'raw', importAlg = {
        name: 'AES-GCM',
        length: 256
      }, keyUsages = ['encrypt', 'decrypt']) => {
        const ivBuffer = new Uint8Array(wrappedData.iv)
        const ciphertextBuffer = new Uint8Array(wrappedData.ciphertext)

        const decryptedRawKey = await window.crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: ivBuffer
          },
          wrappingKey,
          ciphertextBuffer
        )

        return window.crypto.subtle.importKey(
          format,
          decryptedRawKey,
          importAlg,
          true,
          keyUsages
        )
      }

      // 4. deriveKeyFromPassword: PBKDF2 using SHA-256, 210000 iterations
      const deriveKeyFromPassword = async (password, salt) => {
        const encoder = new TextEncoder()
        const passwordBuffer = encoder.encode(password)

        // Ensure salt is a Uint8Array. If it's an array or string, convert it.
        let saltBuffer
        if (typeof salt === 'string') {
          saltBuffer = encoder.encode(salt)
        } else if (Array.isArray(salt)) {
          saltBuffer = new Uint8Array(salt)
        } else {
          saltBuffer = salt
        }

        const baseKey = await window.crypto.subtle.importKey(
          'raw',
          passwordBuffer,
          { name: 'PBKDF2' },
          false,
          ['deriveKey']
        )

        return window.crypto.subtle.deriveKey(
          {
            name: 'PBKDF2',
            salt: saltBuffer,
            iterations: 210000,
            hash: 'SHA-256'
          },
          baseKey,
          {
            name: 'AES-GCM',
            length: 256
          },
          true,
          ['encrypt', 'decrypt']
        )
      }

      const initPasswordFlow = (helpers) => {
        return helpers.subscribe('triggerPasswordSubmit', async (payload) => {
          try {
            // Usually you'd fetch the salt from the server/DB. Here we generate/use the provided one.
            let saltBuffer = payload.salt
            if (!saltBuffer) {
              // Fallback for testing, realistically user salt should be persistent
              saltBuffer = window.crypto.getRandomValues(new Uint8Array(16))
            }

            const derivedKey = await deriveKeyFromPassword(payload.password, saltBuffer)

            helpers.setState('triggerPasswordPromptResolved', {
              promptId: payload.promptId,
              key: derivedKey,

              ts: Date.now()
            })
          } catch (error) {
            console.error('Password derivation failed', error)
          }
        })
      }

      return {
        generateECDHKeyPair,
        generateAESKey,
        wrapKey,
        unwrapKey,
        deriveKeyFromPassword,
        initPasswordFlow
      }
    },
    helpers: {
      getCryptoManager: (globalContext) => {
        return () => ({
          generateECDHKeyPair: globalContext.values.generateECDHKeyPair,
          generateAESKey: globalContext.values.generateAESKey,
          wrapKey: globalContext.values.wrapKey,
          unwrapKey: globalContext.values.unwrapKey,
          deriveKeyFromPassword: globalContext.values.deriveKeyFromPassword,
          initPasswordFlow: globalContext.values.initPasswordFlow
        })
      }
    }
  }
})
