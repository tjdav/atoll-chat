import { StorageReservedPrefixError } from '../../errors.js'
import { RUNTIME_PREFIX } from '../storage/index.js'

/**
 * Validates a storage key against basic type and reserved prefix rules.
 *
 * @param {unknown} key - The key to validate.
 * @returns {asserts key is string}
 */
function validateKey (key) {
  if (typeof key !== 'string') {
    throw new TypeError(`Storage key must be a non-empty string; received ${typeof key}`)
  }
  if (key.length === 0) {
    throw new TypeError('Storage key must be a non-empty string; received empty string')
  }
  if (key.startsWith(RUNTIME_PREFIX)) {
    throw new StorageReservedPrefixError(
      `Storage key "${key}" uses the reserved prefix "${RUNTIME_PREFIX}"`
    )
  }
}

/**
 * Creates the author-facing `ctx.storage` store.
 *
 * Wraps an internal `Storage` instance (B-009) and rejects any key
 * beginning with the reserved prefix `_runtime:`. The runtime uses
 * those keys internally; the author must not.
 *
 * Reads are direct delegations. There is no cache.
 *
 * @typedef {object} StorageStore
 * @property {(key: string) => Promise<unknown>} get
 * @property {(key: string, value: unknown) => Promise<void>} set
 * @property {(key: string) => Promise<void>} delete
 * @property {() => Promise<void>} clear
 * @property {() => string[]} keys
 */

/**
 * @param {object} deps - Dependencies.
 * @param {import('../storage/index.js').Storage} deps.storage - The
 *   underlying storage backend. Must be open.
 * @returns {StorageStore} The store.
 */
export function createStorageStore ({ storage }) {
  return {
    /**
     * Reads a value by key.
     *
     * @param {string} key - The storage key.
     * @returns {Promise<unknown>} The stored value.
     */
    async get (key) {
      validateKey(key)
      return storage.get(key)
    },

    /**
     * Writes a value by key.
     *
     * @param {string} key - The storage key.
     * @param {unknown} value - The value to store.
     * @returns {Promise<void>}
     */
    async set (key, value) {
      validateKey(key)
      return storage.set(key, value)
    },

    /**
     * Removes a value by key.
     *
     * @param {string} key - The storage key.
     * @returns {Promise<void>}
     */
    async delete (key) {
      validateKey(key)
      return storage.delete(key)
    },

    /**
     * Removes every author key.
     *
     * @returns {Promise<void>}
     */
    async clear () {
      return storage.clear()
    },

    /**
     * Returns a snapshot of current keys.
     *
     * @returns {string[]} Key names.
     */
    keys () {
      return storage.keys()
    }
  }
}
