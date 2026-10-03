/**
 * Display name encryption and decryption per Client Specification v1.0 §6.20.
 * Uses AES-256-GCM via Web Crypto API.
 */

/**
 * Encrypts a user display name string using AES-256-GCM per client spec §6.20.
 *
 * Output format: nonce (12 bytes) || ciphertext || auth tag (16 bytes).
 * Length invariant: encryptDisplayName('Alice', key).length === 12 + 5 + 16 = 33 bytes.
 *
 * @param {string} displayName Plaintext display name UTF-8 string
 * @param {Uint8Array} displayNameKey 32-byte AES-256 key (e.g. derived via deriveDisplayNameKey)
 * @returns {Promise<Uint8Array>} Concatenated nonce and AES-GCM ciphertext with tag
 */
export async function encryptDisplayName(displayName, displayNameKey) {
  if (typeof displayName !== 'string') {
    throw new TypeError('displayName must be a string');
  }
  if (!(displayNameKey instanceof Uint8Array) || displayNameKey.length !== 32) {
    throw new TypeError('displayNameKey must be a 32-byte Uint8Array');
  }

  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(displayName);
  if (plaintextBytes.length > 256) {
    throw new Error('Display name exceeds 256 bytes.');
  }

  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    displayNameKey,
    'AES-GCM',
    false,
    ['encrypt']
  );

  const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    plaintextBytes
  );

  const encryptedBytes = new Uint8Array(encryptedBuffer);
  const result = new Uint8Array(nonce.length + encryptedBytes.length);
  result.set(nonce, 0);
  result.set(encryptedBytes, nonce.length);

  return result;
}

/**
 * Decrypts an encrypted display name byte array using AES-256-GCM per client spec §6.20.
 *
 * @param {Uint8Array} encryptedBytes Byte array containing nonce (12 bytes) || ciphertext || tag (16 bytes)
 * @param {Uint8Array} displayNameKey 32-byte AES-256 key
 * @returns {Promise<string>} Decrypted UTF-8 display name string
 */
export async function decryptDisplayName(encryptedBytes, displayNameKey) {
  if (!(encryptedBytes instanceof Uint8Array)) {
    throw new TypeError('encryptedBytes must be a Uint8Array');
  }
  if (!(displayNameKey instanceof Uint8Array) || displayNameKey.length !== 32) {
    throw new TypeError('displayNameKey must be a 32-byte Uint8Array');
  }
  if (encryptedBytes.length < 12 + 16) {
    throw new Error('encryptedBytes is too short to contain a valid nonce and auth tag');
  }

  const nonce = encryptedBytes.subarray(0, 12);
  const ciphertextWithTag = encryptedBytes.subarray(12);

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    displayNameKey,
    'AES-GCM',
    false,
    ['decrypt']
  );

  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decryptedBuffer);
}
