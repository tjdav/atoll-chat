import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToBase64url, base64urlToBytes } from '../codec/index.js';

/**
 * Storage security note:
 * Persisting an identity private key in localStorage is XSS-vulnerable.
 * A future task will replace this storage backend with the platform keychain (Capacitor)
 * or Stronghold (Tauri), without changing this module's public API.
 */

const IDENTITY_PRIVATE_KEY = 'atoll.identity.private';
const IDENTITY_PUBLIC_KEY = 'atoll.identity.public';

const inMemoryStorage = new Map();

/**
 * Helper to safely read from localStorage or in-memory fallback if localStorage is unavailable.
 *
 * @param {string} key Storage key
 * @returns {string|null} Stored string value or null
 */
function getStorageItem(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch (err) {
    // localStorage disabled or unavailable
  }
  return inMemoryStorage.get(key) ?? null;
}

/**
 * Helper to safely write to localStorage or in-memory fallback if localStorage is unavailable.
 *
 * @param {string} key Storage key
 * @param {string} value String value to store
 */
function setStorageItem(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch (err) {
    // localStorage disabled or unavailable
  }
  inMemoryStorage.set(key, value);
}

/**
 * Helper to safely remove an item from localStorage and in-memory fallback.
 *
 * @param {string} key Storage key
 */
function removeStorageItem(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch (err) {
    // localStorage disabled or unavailable
  }
  inMemoryStorage.delete(key);
}

/**
 * Generates an Ed25519 identity keypair using CSPRNG.
 * Does not persist the keypair automatically.
 *
 * @returns {Promise<{ privateKey: Uint8Array, publicKey: Uint8Array }>} Object containing 32-byte private key and 32-byte public key
 */
export async function generateIdentityKeypair() {
  const randomKeyFn = ed25519.utils.randomPrivateKey ?? ed25519.utils.randomSecretKey;
  const privateKey = randomKeyFn();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Retrieves the stored identity public key from storage.
 *
 * @returns {Uint8Array|null} 32-byte public key or null if not set
 */
export function getIdentityPublicKey() {
  const b64url = getStorageItem(IDENTITY_PUBLIC_KEY);
  if (!b64url) {
    return null;
  }
  return base64urlToBytes(b64url);
}

/**
 * Retrieves the stored identity private key from storage.
 *
 * @returns {Uint8Array|null} 32-byte private key or null if not set
 */
export function getIdentityPrivateKey() {
  const b64url = getStorageItem(IDENTITY_PRIVATE_KEY);
  if (!b64url) {
    return null;
  }
  return base64urlToBytes(b64url);
}

/**
 * Persists an Ed25519 identity keypair into storage as Base64URL encoded strings.
 *
 * @param {Uint8Array} privateKey 32-byte Ed25519 private key
 * @param {Uint8Array} publicKey 32-byte Ed25519 public key
 */
export function setIdentityKeypair(privateKey, publicKey) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new TypeError('privateKey must be a 32-byte Uint8Array');
  }
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
    throw new TypeError('publicKey must be a 32-byte Uint8Array');
  }

  setStorageItem(IDENTITY_PRIVATE_KEY, bytesToBase64url(privateKey));
  setStorageItem(IDENTITY_PUBLIC_KEY, bytesToBase64url(publicKey));
}

/**
 * Clears the stored identity keypair from storage.
 */
export function clearIdentityKeypair() {
  removeStorageItem(IDENTITY_PRIVATE_KEY);
  removeStorageItem(IDENTITY_PUBLIC_KEY);
}
