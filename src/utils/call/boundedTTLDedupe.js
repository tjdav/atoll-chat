/**
 * BoundedTTLDedupe provides a memory-bounded Map store with time-to-live (TTL) expiration.
 * Utilizes Map insertion order for O(1) amortized lazy chronological pruning.
 */
export class BoundedTTLDedupe {
  /**
   * @param {number} [ttlMs=600000] - Time to live in milliseconds (default 10 minutes).
   * @param {number} [maxEntries=500] - Maximum entry capacity limit (default 500).
   */
  constructor (ttlMs = 10 * 60 * 1000, maxEntries = 500) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.entries = new Map()
  }

  /**
   * Prunes expired entries starting from the oldest insertion order.
   * Breaks immediately on the first non-expired entry (O(1) amortized).
   */
  prune () {
    const now = Date.now()
    for (const [id, timestamp] of this.entries) {
      if (now - timestamp > this.ttlMs) {
        this.entries.delete(id)
      } else {
        break
      }
    }
  }

  /**
   * Checks if an ID exists and is not expired.
   * @param {string} id - The entry key.
   * @returns {boolean}
   */
  has (id) {
    this.prune()
    return this.entries.has(id)
  }

  /**
   * Adds an entry ID with the current timestamp.
   * Performs lazy pruning and FIFO capacity eviction if limit is reached.
   * @param {string} id - The entry key.
   */
  add (id) {
    this.prune()

    if (this.entries.has(id)) {
      this.entries.delete(id)
    } else if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey)
      }
    }

    this.entries.set(id, Date.now())
  }

  /**
   * Clears all stored entries.
   */
  clear () {
    this.entries.clear()
  }

  /**
   * Returns current entries size.
   * @returns {number}
   */
  get size () {
    return this.entries.size
  }
}
