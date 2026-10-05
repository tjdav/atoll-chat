import { hkdfSync, createCipheriv, createDecipheriv } from 'node:crypto'

/**
 * Derives the storage encryption key from the bot's storage seed.
 *
 * Spec §9: HKDF with info "bot-storage-v1", output 32 bytes. The seed
 * is a 32-byte uniform random value from the keystore. HKDF-Expand is
 * used directly; no Extract step is needed because the seed is already
 * a uniform PRK.
 *
 * @param {Uint8Array} seed - The 32-byte storage seed.
 * @returns {Uint8Array} The 32-byte encryption key.
 */
export function deriveStorageKey (seed) {
  if (!(seed instanceof Uint8Array) || seed.byteLength !== 32) {
    throw new Error('Storage seed must be a 32-byte Uint8Array')
  }
  const derived = hkdfSync('sha256', seed, Buffer.alloc(0), Buffer.from('bot-storage-v1', 'utf8'), 32)
  return new Uint8Array(derived)
}

/**
 * Encrypts a plaintext buffer with AES-256-GCM.
 *
 * @param {Uint8Array} key - The 32-byte key from `deriveStorageKey`.
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
 * @param {Uint8Array} key - The 32-byte key from `deriveStorageKey`.
 * @param {Uint8Array} nonce - The 12-byte nonce.
 * @param {Uint8Array} ciphertextWithTag - The bytes to decrypt.
 * @returns {Uint8Array} The recovered plaintext.
 * @throws {Error} When the tag does not verify.
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
