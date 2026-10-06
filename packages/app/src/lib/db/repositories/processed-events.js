/**
 * Repository for processed_events domain operations.
 *
 * @module @atoll/app/lib/db/repositories/processed-events
 */

/**
 * Builds a composite event key string from source, event name, and sequence.
 *
 * @param {string} source - Event source / prefix identifier (e.g., 'read', 'device').
 * @param {string} eventName - Name of the event.
 * @param {string | number} sequence - Monotonic sequence number or unique identifier.
 * @returns {string} Composite event key string.
 */
export function makeKey(source, eventName, sequence) {
  return `${source}:${eventName}:${sequence}`
}

/**
 * Creates a processed events repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The processed events repository API.
 */
export function createProcessedEventsRepository({ db }) {
  /**
   * Checks whether an event key has already been processed.
   *
   * @param {string} eventKey - Composite event key.
   * @returns {Promise<boolean>} True if key exists in processed_events, false otherwise.
   */
  async function has(eventKey) {
    const row = await db.queryOne(
      `SELECT 1 AS present FROM processed_events WHERE event_key = ? LIMIT 1`,
      [eventKey]
    )
    return Boolean(row?.present)
  }

  /**
   * Convenience wrapper checking whether an event key constructed from parts has been processed.
   *
   * @param {string} source - Event source prefix.
   * @param {string} eventName - Name of event.
   * @param {string | number} sequence - Sequence number or identifier.
   * @returns {Promise<boolean>} True if processed, false otherwise.
   */
  async function hasKey(source, eventName, sequence) {
    return has(makeKey(source, eventName, sequence))
  }

  /**
   * Idempotently marks an event key as processed.
   *
   * @param {string} eventKey - Composite event key.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function mark(eventKey) {
    return db.execute(
      `INSERT OR IGNORE INTO processed_events (event_key, processed_at) VALUES (?, ?)`,
      [eventKey, Date.now()]
    )
  }

  /**
   * Convenience wrapper idempotently marking an event constructed from parts as processed.
   *
   * @param {string} source - Event source prefix.
   * @param {string} eventName - Name of event.
   * @param {string | number} sequence - Sequence number or identifier.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function markKey(source, eventName, sequence) {
    return mark(makeKey(source, eventName, sequence))
  }

  /**
   * Idempotently marks multiple event keys as processed in a single transaction.
   *
   * @param {Array<string>} keys - Array of composite event keys.
   * @returns {Promise<{ changes: number }>} Aggregated execution result summary.
   */
  async function markBatch(keys) {
    const now = Date.now()
    return db.transaction(async () => {
      let total = 0
      for (const key of keys) {
        const r = await db.execute(
          `INSERT OR IGNORE INTO processed_events (event_key, processed_at) VALUES (?, ?)`,
          [key, now]
        )
        total += r.changes
      }
      return { changes: total }
    })
  }

  /**
   * Deletes all processed event entries older than the specified timestamp.
   *
   * @param {number} beforeMs - Threshold timestamp in milliseconds since epoch.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function prune(beforeMs) {
    return db.execute(
      `DELETE FROM processed_events WHERE processed_at < ?`,
      [beforeMs]
    )
  }

  /**
   * Counts total number of processed event records.
   *
   * @returns {Promise<number>} Total record count.
   */
  async function count() {
    const row = await db.queryOne(`SELECT COUNT(*) AS cnt FROM processed_events`)
    return row?.cnt ?? 0
  }

  /**
   * Deletes all records in processed_events.
   *
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function clearAll() {
    return db.execute(`DELETE FROM processed_events`)
  }

  return {
    has,
    hasKey,
    mark,
    markKey,
    markBatch,
    prune,
    count,
    clearAll
  }
}
