import { promises as fs } from 'node:fs'

import crypto from 'node:crypto'
import { deriveStorageKey, encrypt, decrypt } from './crypto.js'

/**
 * The prefix reserved for runtime state. Author keys must not start
 * with this string. `Storage.clear()` preserves keys with this prefix.
 */
export const RUNTIME_PREFIX = '_runtime:'

/**
 * Helper to check if a string is valid base64url and decodes to expected length.
 *
 * @param {unknown} str - The value to test.
 * @param {number} expectedLength - Exact byte length or minimum byte length.
 * @param {boolean} [minLength=false] - If true, expectedLength is a minimum.
 * @returns {boolean} True if valid base64url of required length.
 */
function isValidBase64url (str, expectedLength, minLength = false) {
  if (typeof str !== 'string' || str.length === 0) {
    return false
  }
  if (!/^[A-Za-z0-9_-]+$/.test(str)) {
    return false
  }
  try {
    const buf = Buffer.from(str, 'base64url')
    if (minLength) {
      return buf.byteLength >= expectedLength
    }
    return buf.byteLength === expectedLength
  } catch {
    return false
  }
}

/**
 * The encrypted key/value store for a single bot.
 *
 * Author keys and runtime keys share one flat map. Runtime keys use the
 * `RUNTIME_PREFIX` prefix. Author-facing access rejects the prefix at
 * the wrapper layer (B-026); this class permits any string key.
 *
 * Reads and writes are serialized. Each `set` and `delete` triggers a
 * whole-file rewrite after the in-memory state has been updated. The
 * write queue ensures ordered writes even when multiple operations are
 * issued concurrently.
 */
export class Storage {
  /**
   * @param {object} options
   * @param {string} options.path - Absolute path to the storage file.
   * @param {Uint8Array} options.seed - The 32-byte storage seed.
   * @param {string} options.botId - The bot's identifier, used as a
   *   cross-check on open.
   */
  constructor ({ path, seed, botId }) {
    this._path = path
    this._seed = seed
    this._botId = botId
    /** @type {Record<string, unknown>} */
    this._data = {}
    /** @type {Uint8Array | null} */
    this._key = null
    /** @type {Promise<void>} */
    this._writeQueue = Promise.resolve()
  }

  /**
   * Loads the storage file. Creates an empty map when the file does
   * not exist.
   *
   * @returns {Promise<void>}
   * @throws {Error} When the file exists but is not valid JSON, fails
   *   the outer schema check, has a `bot_id` mismatch, or fails to
   *   decrypt.
   */
  async open () {
    this._key = deriveStorageKey(this._seed)

    let rawContent
    try {
      rawContent = await fs.readFile(this._path, 'utf8')
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
        this._data = {}
        return
      }
      throw err
    }

    let outer
    try {
      outer = JSON.parse(rawContent)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`storage file is not valid JSON: ${message}`)
    }

    if (typeof outer !== 'object' || outer === null || Array.isArray(outer)) {
      throw new Error('storage file is malformed: outer content must be a JSON object')
    }

    if (outer.version !== 1) {
      throw new Error(`storage file is malformed: unsupported version ${String(outer.version)}`)
    }

    if (outer.bot_id !== this._botId) {
      throw new Error(`storage file is malformed: bot_id mismatch (expected ${this._botId}, got ${String(outer.bot_id)})`)
    }

    if (!isValidBase64url(outer.nonce, 12)) {
      throw new Error('storage file is malformed: nonce must be a 12-byte base64url string')
    }

    if (!isValidBase64url(outer.ct, 16, true)) {
      throw new Error('storage file is malformed: ct must be a base64url string of at least 16 bytes')
    }

    const nonceBuf = Buffer.from(outer.nonce, 'base64url')
    const ctBuf = Buffer.from(outer.ct, 'base64url')

    let decryptedBytes
    try {
      decryptedBytes = decrypt(this._key, nonceBuf, ctBuf)
    } catch {
      throw new Error('storage file cannot be decrypted; the seed may be wrong')
    }

    let parsed
    try {
      const plaintextStr = Buffer.from(decryptedBytes).toString('utf8')
      parsed = JSON.parse(plaintextStr)
    } catch {
      throw new Error('storage plaintext is not valid JSON')
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('storage plaintext must be a JSON object')
    }

    this._data = parsed
  }

  /**
   * Reads a value by key.
   *
   * @param {string} key - The storage key.
   * @returns {Promise<unknown>} The value, or undefined when the key
   *   is not present.
   */
  async get (key) {
    return this._data[key]
  }

  /**
   * Writes a value by key. The value must be JSON-serializable.
   *
   * @param {string} key - The storage key.
   * @param {unknown} value - The value to store.
   * @returns {Promise<void>}
   * @throws {Error} When the value cannot be serialized.
   */
  async set (key, value) {
    const prevHadKey = Object.prototype.hasOwnProperty.call(this._data, key)
    const prevVal = this._data[key]

    this._data[key] = value

    try {
      await this._enqueueFlush()
    } catch (err) {
      if (prevHadKey) {
        this._data[key] = prevVal
      } else {
        delete this._data[key]
      }
      throw err
    }
  }

  /**
   * Removes a value by key. A no-op when the key is not present.
   *
   * @param {string} key - The storage key.
   * @returns {Promise<void>}
   */
  async delete (key) {
    delete this._data[key]
    return this._enqueueFlush()
  }

  /**
   * Removes every author key. Keys with the `RUNTIME_PREFIX` prefix are
   * preserved.
   *
   * @returns {Promise<void>}
   */
  async clear () {
    for (const k of Object.keys(this._data)) {
      if (!k.startsWith(RUNTIME_PREFIX)) {
        delete this._data[k]
      }
    }
    return this._enqueueFlush()
  }

  /**
   * Waits for all pending writes to complete.
   *
   * @returns {Promise<void>}
   */
  async close () {
    return this._writeQueue
  }

  /**
   * Returns a snapshot of the current keys. Intended for diagnostics.
   * The values are not returned; only the keys.
   *
   * @returns {string[]}
   */
  keys () {
    return Object.keys(this._data)
  }

  /**
   * Enqueues a flush operation in the serialization queue.
   *
   * @private
   * @returns {Promise<void>}
   */
  _enqueueFlush () {
    this._writeQueue = this._writeQueue
      .catch(() => {
        // Ignore previous write errors in serialization chain
      })
      .then(() => this._flush())
    return this._writeQueue
  }

  /**
   * Flushes in-memory data to disk atomically.
   *
   * @private
   * @returns {Promise<void>}
   */
  async _flush () {
    if (!this._key) {
      this._key = deriveStorageKey(this._seed)
    }

    let serialized
    try {
      serialized = JSON.stringify(this._data)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`storage value is not JSON-serializable: ${message}`)
    }

    const nonce = crypto.randomBytes(12)
    const plaintextBuf = Buffer.from(serialized, 'utf8')
    const ctWithTag = encrypt(this._key, nonce, plaintextBuf)

    const outer = {
      version: 1,
      bot_id: this._botId,
      nonce: Buffer.from(nonce).toString('base64url'),
      ct: Buffer.from(ctWithTag).toString('base64url')
    }

    const outerStr = JSON.stringify(outer, null, 2)
    const tmpPath = `${this._path}.tmp`

    try {
      await fs.writeFile(tmpPath, outerStr, { mode: 0o600 })
      await fs.rename(tmpPath, this._path)
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {
        // Ignore failure to remove temp file on error
      })
      throw err
    }
  }
}
