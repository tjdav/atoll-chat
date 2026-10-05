import crypto from 'node:crypto'

/**
 * The prefix used for all idempotency storage keys. Prepended to the
 * base64url-encoded SHA-256 digest of a trigger key.
 */
export const STORAGE_PREFIX = '_runtime:idempotency:'

/**
 * Validates a trigger key.
 *
 * @param {unknown} key - The trigger key to validate.
 * @throws {Error} When the key is not a non-empty string or starts with `_runtime:`.
 */
function validateKey (key) {
  if (typeof key !== 'string') {
    throw new Error('Trigger key must be a string')
  }
  if (key.length === 0) {
    throw new Error('Trigger key must not be empty')
  }
  if (key.startsWith('_runtime:')) {
    throw new Error('Trigger key must not start with "_runtime:"')
  }
}

/**
 * Computes the storage key for a trigger key using SHA-256 base64url digest.
 *
 * @param {string} key - The trigger key.
 * @returns {string} The full storage key with prefix.
 */
function toStorageKey (key) {
  const digest = crypto.createHash('sha256').update(key, 'utf8').digest('base64url')
  return `${STORAGE_PREFIX}${digest}`
}

/**
 * Records trigger keys for deduplication within a time window.
 *
 * Keys are hashed with SHA-256 for fixed-length storage. Operations
 * are serialized through an internal promise queue. Expired entries
 * are filtered on read and pruned opportunistically on write.
 */
export class IdempotencyStore {
  /**
   * @param {object} options
   * @param {import('../storage/index.js').Storage} options.storage -
   *   The storage backend. Must be already open.
   * @param {number} [options.ttlMs=300000] - The time-to-live for
   *   recorded keys, in milliseconds. Defaults to five minutes per
   *   spec §10.3.
   * @param {() => number} [options.now=Date.now] - The clock. Returns
   *   milliseconds since the epoch. Parameterized for testing.
   * @param {number} [options.pruneThreshold=100] - The number of
   *   record operations between opportunistic prune passes. Set to 0
   *   to disable opportunistic pruning.
   * @param {import('../diagnostics/logger.js').Logger} [options.logger] -
   *   Optional logger. Used only to report prune diagnostics. When
   *   absent, prune is silent.
   */
  constructor ({ storage, ttlMs = 300000, now = Date.now, pruneThreshold = 100, logger }) {
    this._storage = storage
    this._ttlMs = ttlMs
    this._now = now
    this._pruneThreshold = pruneThreshold
    this._logger = logger

    this._recordCount = 0
    /** @type {Promise<unknown>} */
    this._queue = Promise.resolve()
  }

  /**
   * Enqueues an operation into the promise queue.
   *
   * @private
   * @template T
   * @param {() => Promise<T> | T} operation - The operation to execute.
   * @returns {Promise<T>} The result of the operation.
   */
  _enqueue (operation) {
    const res = this._queue
      .catch(() => {})
      .then(() => operation())
    this._queue = res.catch(() => {})
    return res
  }

  /**
   * Schedules an opportunistic prune on the queue without blocking caller.
   *
   * @private
   */
  _schedulePrune () {
    if (this._pruneThreshold > 0) {
      this._recordCount++
      if (this._recordCount >= this._pruneThreshold) {
        this._recordCount = 0
        this._enqueue(() => this._pruneInternal())
      }
    }
  }

  /**
   * Internal prune implementation without enqueueing.
   *
   * @private
   * @returns {Promise<number>} Count of removed entries.
   */
  async _pruneInternal () {
    const now = this._now()
    const allKeys = this._storage.keys()
    const idempotencyKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX))

    /** @type {string[]} */
    const toDelete = []
    let corruptCount = 0

    for (const k of idempotencyKeys) {
      const val = await this._storage.get(k)
      if (typeof val === 'number') {
        if (now - val >= this._ttlMs) {
          toDelete.push(k)
        }
      } else {
        toDelete.push(k)
        corruptCount++
      }
    }

    if (corruptCount > 0 && this._logger) {
      this._logger.warn('corrupt idempotency entries pruned')
    }

    for (const k of toDelete) {
      await this._storage.delete(k)
    }

    const removed = toDelete.length
    if (removed > 0 && this._logger) {
      this._logger.info('idempotency prune', { removed })
    }

    return removed
  }

  /**
   * Internal clear implementation without enqueueing.
   *
   * @private
   * @returns {Promise<number>} Count of removed entries.
   */
  async _clearInternal () {
    const allKeys = this._storage.keys()
    const idempotencyKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX))

    for (const k of idempotencyKeys) {
      await this._storage.delete(k)
    }

    return idempotencyKeys.length
  }

  /**
   * Checks whether a trigger key has been recorded within the TTL
   * window.
   *
   * @param {string} key - The trigger key.
   * @returns {Promise<boolean>} True when the key is present and not
   *   expired.
   */
  async check (key) {
    validateKey(key)
    return this._enqueue(async () => {
      const storageKey = toStorageKey(key)
      const value = await this._storage.get(storageKey)

      if (value === undefined) {
        return false
      }

      if (typeof value === 'number') {
        return this._now() - value < this._ttlMs
      }

      if (this._logger) {
        this._logger.warn('idempotency entry is corrupt')
      }
      return false
    })
  }

  /**
   * Records a trigger key with the current time. Overwrites any
   * existing entry, refreshing its TTL.
   *
   * @param {string} key - The trigger key.
   * @returns {Promise<void>}
   */
  async record (key) {
    validateKey(key)
    return this._enqueue(async () => {
      const storageKey = toStorageKey(key)
      await this._storage.set(storageKey, this._now())
      this._schedulePrune()
    })
  }

  /**
   * Atomically checks whether a trigger key has been recorded. When
   * not, records it and returns false. When yes, returns true without
   * changing the entry. The check and record are serialized under the
   * same queue slot.
   *
   * @param {string} key - The trigger key.
   * @returns {Promise<boolean>} True when the key was already present
   *   and not expired. False when the key was absent or expired and
   *   has now been recorded.
   */
  async checkAndRecord (key) {
    validateKey(key)
    return this._enqueue(async () => {
      const storageKey = toStorageKey(key)
      const value = await this._storage.get(storageKey)

      if (typeof value === 'number' && this._now() - value < this._ttlMs) {
        return true
      }

      if (typeof value !== 'undefined' && typeof value !== 'number' && this._logger) {
        this._logger.warn('idempotency entry is corrupt')
      }

      await this._storage.set(storageKey, this._now())
      this._schedulePrune()
      return false
    })
  }

  /**
   * Removes a trigger key. A no-op when the key is not present. Used
   * by callers that recorded a key, then failed, and want to allow a
   * retry.
   *
   * @param {string} key - The trigger key.
   * @returns {Promise<void>}
   */
  async remove (key) {
    validateKey(key)
    return this._enqueue(async () => {
      const storageKey = toStorageKey(key)
      await this._storage.delete(storageKey)
    })
  }

  /**
   * Removes every expired entry. Returns the number of entries
   * removed.
   *
   * @returns {Promise<number>} The count of removed entries.
   */
  async prune () {
    return this._enqueue(() => this._pruneInternal())
  }

  /**
   * Removes every idempotency entry regardless of TTL. Used by
   * diagnostics and tests. Not called during normal operation.
   *
   * @returns {Promise<number>} The count of removed entries.
   */
  async clear () {
    return this._enqueue(() => this._clearInternal())
  }
}
