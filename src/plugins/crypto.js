import { createPlugin } from 'coralite'

export default createPlugin({
  name: 'crypto-plugin',
  client: {
    helpers: {
      generateUserKeyPair: () => async () => {
        return await window.crypto.subtle.generateKey(
          {
            name: 'RSA-OAEP',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256'
          },
          true,
          ['encrypt', 'decrypt']
        )
      },
      exportPublicKey: () => async (publicKey) => {
        const exported = await window.crypto.subtle.exportKey(
          'spki',
          publicKey
        )
        const exportedAsString = String.fromCharCode.apply(null, new Uint8Array(exported))
        return btoa(exportedAsString)
      },
      importPublicKey: () => async (pem) => {
        const binaryDerString = atob(pem)
        const binaryDer = new Uint8Array(binaryDerString.length)
        for (let i = 0; i < binaryDerString.length; i++) {
          binaryDer[i] = binaryDerString.charCodeAt(i)
        }
        return await window.crypto.subtle.importKey(
          'spki',
          binaryDer,
          {
            name: 'RSA-OAEP',
            hash: 'SHA-256'
          },
          true,
          ['encrypt']
        )
      },
      generateConversationKey: () => async () => {
        return await window.crypto.subtle.generateKey(
          {
            name: 'AES-GCM',
            length: 256
          },
          true,
          ['encrypt', 'decrypt']
        )
      },
      encryptConversationKey: () => async (aesKey, publicKey) => {
        const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey)
        const encryptedKey = await window.crypto.subtle.encrypt(
          {
            name: 'RSA-OAEP'
          },
          publicKey,
          rawAesKey
        )
        const encryptedKeyString = String.fromCharCode.apply(null, new Uint8Array(encryptedKey))
        return btoa(encryptedKeyString)
      },
      decryptConversationKey: () => async (encryptedAesKeyBase64, privateKey) => {
        const encryptedKeyString = atob(encryptedAesKeyBase64)
        const encryptedKey = new Uint8Array(encryptedKeyString.length)
        for (let i = 0; i < encryptedKeyString.length; i++) {
          encryptedKey[i] = encryptedKeyString.charCodeAt(i)
        }
        const rawAesKey = await window.crypto.subtle.decrypt(
          {
            name: 'RSA-OAEP'
          },
          privateKey,
          encryptedKey
        )
        return await window.crypto.subtle.importKey(
          'raw',
          rawAesKey,
          {
            name: 'AES-GCM'
          },
          true,
          ['encrypt', 'decrypt']
        )
      },
      encryptMessage: () => async (text, aesKey) => {
        const iv = window.crypto.getRandomValues(new Uint8Array(12))
        const encodedText = new TextEncoder().encode(text)
        const ciphertext = await window.crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: iv
          },
          aesKey,
          encodedText
        )

        const ciphertextString = String.fromCharCode.apply(null, new Uint8Array(ciphertext))
        const ivString = String.fromCharCode.apply(null, iv)

        return {
          ciphertext: btoa(ciphertextString),
          iv: btoa(ivString)
        }
      },
      decryptMessage: () => async (ciphertextBase64, ivBase64, aesKey) => {
        const ciphertextString = atob(ciphertextBase64)
        const ciphertext = new Uint8Array(ciphertextString.length)
        for (let i = 0; i < ciphertextString.length; i++) {
          ciphertext[i] = ciphertextString.charCodeAt(i)
        }

        const ivString = atob(ivBase64)
        const iv = new Uint8Array(ivString.length)
        for (let i = 0; i < ivString.length; i++) {
          iv[i] = ivString.charCodeAt(i)
        }

        const decryptedBytes = await window.crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: iv
          },
          aesKey,
          ciphertext
        )

        return new TextDecoder().decode(decryptedBytes)
      }
    }
  }
})
