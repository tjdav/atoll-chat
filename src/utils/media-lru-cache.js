/**
 * Bounded LRU Media Cache with DOM-Aware Deferred Tombstone Eviction and Logout Teardown Gate.
 */
export class MediaLRUCache {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.maxEntries=128]
   */
  constructor ({ maxEntries = 128 } = {}) {
    this.maxEntries = maxEntries
    this.cache = new Map()
    this.tombstones = new Set()
    this.activeRoomId = null
    this.isTornDown = false
  }

  /**
   * Sets active chat room ID and sweeps tombstones from previous rooms.
   *
   * @param {string|null} roomId
   */
  setActiveRoom (roomId) {
    this.activeRoomId = roomId
    this.flushTombstones()
  }

  /**
   * Immediately revokes and clears all deferred tombstones.
   */
  flushTombstones () {
    for (const entry of this.tombstones) {
      this._revokeEntry(entry)
    }
    this.tombstones.clear()
  }

  /**
   * Safely revokes blob: URLs associated with a cache entry.
   *
   * @param {Object|string} entry
   * @param {string|null} [exceptUrl=null]
   * @private
   */
  _revokeEntry (entry, exceptUrl = null) {
    if (!entry) {
      return
    }

    const urlsToRevoke = []

    if (typeof entry === 'string') {
      urlsToRevoke.push(entry)
    } else if (typeof entry === 'object') {
      if (entry.blobUrl) {
        urlsToRevoke.push(entry.blobUrl)
      }
      if (entry.thumbnailBlobUrl) {
        urlsToRevoke.push(entry.thumbnailBlobUrl)
      }
      if (entry.thumbnailPreviewUrl) {
        urlsToRevoke.push(entry.thumbnailPreviewUrl)
      }
    }

    for (const url of urlsToRevoke) {
      if (typeof url === 'string' && url.startsWith('blob:') && url !== exceptUrl) {
        try {
          URL.revokeObjectURL(url)
        } catch {
          // Ignore revocation errors
        }
      }
    }
  }

  /**
   * Retrieves an item from cache and marks it as most recently used.
   *
   * @param {string} key
   * @returns {*}
   */
  get (key) {
    if (!this.cache.has(key)) {
      return undefined
    }
    const value = this.cache.get(key)
    // Refresh MRU position
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  /**
   * Inserts or updates an entry in the LRU cache.
   * If torn down, immediately revokes blob URLs and rejects insertion.
   *
   * @param {string} key
   * @param {*} value
   * @returns {MediaLRUCache}
   */
  set (key, value) {
    if (this.isTornDown) {
      this._revokeEntry(value)
      return this
    }

    // Overwrite safety: if key already exists, revoke old entry except matching active URL
    if (this.cache.has(key)) {
      const oldEntry = this.cache.get(key)
      let exceptUrl = null
      if (typeof value === 'object' && value !== null && value.blobUrl) {
        exceptUrl = value.blobUrl
      } else if (typeof value === 'string') {
        exceptUrl = value
      }
      this._revokeEntry(oldEntry, exceptUrl)
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxEntries) {
      // Evict LRU (oldest) entry
      const oldestKey = this.cache.keys().next().value
      const oldestEntry = this.cache.get(oldestKey)

      const entryRoomId = typeof oldestEntry === 'object' && oldestEntry !== null
        ? (oldestEntry.roomId || oldestEntry.room_id)
        : null

      // If entry belongs to a non-active room, revoke immediately because DOM is unmounted
      if (entryRoomId && entryRoomId !== this.activeRoomId) {
        this._revokeEntry(oldestEntry)
      } else {
        // Active room or untagged entry: defer revocation to activeRoomTombstones to protect active DOM
        if (oldestEntry) {
          this.tombstones.add(oldestEntry)
        }
      }

      this.cache.delete(oldestKey)
    }

    this.cache.set(key, value)
    return this
  }

  /**
   * Checks if key exists in cache.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has (key) {
    return this.cache.has(key)
  }

  /**
   * Removes and revokes an entry from cache.
   *
   * @param {string} key
   * @returns {boolean}
   */
  delete (key) {
    if (this.cache.has(key)) {
      const entry = this.cache.get(key)
      this._revokeEntry(entry)
      return this.cache.delete(key)
    }
    return false
  }

  /**
   * Revokes all active cache and tombstone entries, clears collections, and sets teardown gate.
   */
  clear () {
    for (const entry of this.cache.values()) {
      this._revokeEntry(entry)
    }
    for (const entry of this.tombstones) {
      this._revokeEntry(entry)
    }
    this.cache.clear()
    this.tombstones.clear()
    this.isTornDown = true
  }

  /**
   * Resets teardown gate for fresh authentication sessions.
   */
  reset () {
    this.isTornDown = false
  }

  /**
   * Standard Map interface delegation
   */
  get size () {
    return this.cache.size
  }

  /**
   *
   */
  forEach (callback, thisArg) {
    this.cache.forEach(callback, thisArg)
  }

  /**
   *
   */
  keys () {
    return this.cache.keys()
  }

  /**
   *
   */
  values () {
    return this.cache.values()
  }

  /**
   *
   */
  entries () {
    return this.cache.entries()
  }

  /**
   *
   */
  [Symbol.iterator] () {
    return this.cache[Symbol.iterator]()
  }
}
