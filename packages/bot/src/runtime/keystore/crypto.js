import { scrypt, createCipheriv, createDecipheriv } from 'node:crypto'

/**
 * Derives the keystore encryption key from a passphrase and salt.
 *
 * Spec §14.9: scrypt with N=2^17, r=8, p=1, output 32 bytes. The
 * memory requirement is 128 * N * r = 128 MiB; Node's default maxmem
 * is 32 MiB, so maxmem must be raised explicitly.
 *
 * @param {string} secret - The passphrase.
 * @param {Uint8Array} salt - The 16-byte salt.
 * @returns {Promise<Uint8Array>} The 32-byte derived key.
 */
export function deriveKey (secret, salt) {
  return new Promise((resolve, reject) => {
    scrypt(
      secret,
      salt,
      32,
      {
        N: 131072,
        r: 8,
        p: 1,
        maxmem: 256 * 1024 * 1024
      },
      (err, derivedKey) => {
        if (err) {
          reject(err)
        } else {
          resolve(new Uint8Array(derivedKey.buffer, derivedKey.byteOffset, derivedKey.byteLength))
        }
      }
    )
  })
}

/**
 * Encrypts a plaintext buffer with AES-256-GCM.
 *
 * @param {Uint8Array} key - The 32-byte key from `deriveKey`.
 * @param {Uint8Array} nonce - The 12-byte nonce.
 * @param {Uint8Array} plaintext - The bytes to encrypt.
 * @returns {Uint8Array} `ciphertext || tag` as one buffer.
 */
export function encrypt (key, nonce, plaintext) {
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = cipher.update(plaintext)
  const finalBytes = cipher.final()
  const tag = cipher.getAuthTag()
  return new Uint8Array(Buffer.concat([ciphertext, finalBytes, tag]))
}

/**
 * Decrypts a `ciphertext || tag` buffer with AES-256-GCM.
 *
 * @param {Uint8Array} key - The 32-byte key from `deriveKey`.
 * @param {Uint8Array} nonce - The 12-byte nonce.
 * @param {Uint8Array} ciphertextWithTag - The bytes to decrypt.
 * @returns {Uint8Array} The recovered plaintext.
 * @throws {Error} When the tag does not verify or input is invalid.
 */
export function decrypt (key, nonce, ciphertextWithTag) {
  if (ciphertextWithTag.length < 16) {
    throw new Error('Ciphertext buffer too short to contain auth tag')
  }
  const tagSliceIndex = ciphertextWithTag.length - 16
  const ciphertext = ciphertextWithTag.subarray(0, tagSliceIndex)
  const tag = ciphertextWithTag.subarray(tagSliceIndex)

  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  const decrypted = decipher.update(ciphertext)
  const finalBytes = decipher.final()
  return new Uint8Array(Buffer.concat([decrypted, finalBytes]))
}
