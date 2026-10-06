/**
 * Repository for outbox domain operations.
 *
 * @module @atoll/app/lib/db/repositories/outbox
 */

/**
 * Creates an outbox repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The outbox repository API.
 */
export function createOutboxRepository({ db }) {
  /**
   * Enqueues a message for sending if not already present in the outbox.
   *
   * @param {object} params - Enqueue parameters.
   * @param {string} params.messageId - Message identifier.
   * @param {string} params.roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function enqueue({ messageId, roomId }) {
    const now = Date.now()
    return db.execute(
      `INSERT INTO outbox (message_id, room_id, enqueued_at, attempts, next_attempt_at, last_attempt_at, last_error)
       VALUES (?, ?, ?, 0, ?, NULL, NULL)
       ON CONFLICT(message_id) DO NOTHING`,
      [messageId, roomId, now, now]
    )
  }

  /**
   * Returns the next due outbox row without removing it.
   *
   * @returns {Promise<object | undefined>} Next due row or undefined if none eligible.
   */
  async function dequeue() {
    const now = Date.now()
    const row = await db.queryOne(
      `SELECT message_id, room_id, enqueued_at, attempts, next_attempt_at, last_attempt_at, last_error
       FROM outbox
       WHERE next_attempt_at <= ?
       ORDER BY next_attempt_at ASC, enqueued_at ASC
       LIMIT 1`,
      [now]
    )
    return row ?? undefined
  }

  /**
   * Returns the first outbox row in FIFO order regardless of next_attempt_at timestamp.
   *
   * @returns {Promise<object | undefined>} First row or undefined if outbox is empty.
   */
  async function peek() {
    const row = await db.queryOne(
      `SELECT message_id, room_id, enqueued_at, attempts, next_attempt_at, last_attempt_at, last_error
       FROM outbox
       ORDER BY next_attempt_at ASC, enqueued_at ASC
       LIMIT 1`
    )
    return row ?? undefined
  }

  /**
   * Lists a page of outbox rows in FIFO order with optional cursor pagination.
   *
   * @param {object} [options] - Query options.
   * @param {number} [options.limit=100] - Maximum rows to return.
   * @param {object} [options.cursor] - Cursor for pagination containing nextAttemptAt and enqueuedAt.
   * @returns {Promise<Array<object>>} Array of outbox rows.
   */
  async function list({ limit = 100, cursor } = {}) {
    if (cursor) {
      const nextAttemptAt = cursor.nextAttemptAt ?? cursor.next_attempt_at
      const enqueuedAt = cursor.enqueuedAt ?? cursor.enqueued_at
      return db.query(
        `SELECT message_id, room_id, enqueued_at, attempts, next_attempt_at, last_attempt_at, last_error
         FROM outbox
         WHERE (next_attempt_at > ?) OR (next_attempt_at = ? AND enqueued_at > ?)
         ORDER BY next_attempt_at ASC, enqueued_at ASC
         LIMIT ?`,
        [nextAttemptAt, nextAttemptAt, enqueuedAt, limit]
      )
    }

    return db.query(
      `SELECT message_id, room_id, enqueued_at, attempts, next_attempt_at, last_attempt_at, last_error
       FROM outbox
       ORDER BY next_attempt_at ASC, enqueued_at ASC
       LIMIT ?`,
      [limit]
    )
  }

  /**
   * Retrieves a specific outbox row by message ID.
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<object | undefined>} Outbox row or undefined if not found.
   */
  async function get(messageId) {
    const row = await db.queryOne(
      `SELECT message_id, room_id, enqueued_at, attempts, next_attempt_at, last_attempt_at, last_error
       FROM outbox
       WHERE message_id = ?`,
      [messageId]
    )
    return row ?? undefined
  }

  /**
   * Removes an outbox row after successful message send.
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function markSent(messageId) {
    return db.execute(`DELETE FROM outbox WHERE message_id = ?`, [messageId])
  }

  /**
   * Updates an outbox row after a failed send attempt or deletes it on terminal failure.
   *
   * @param {string} messageId - Message identifier.
   * @param {string} error - Error message text.
   * @param {object} [options] - Failure options.
   * @param {number} [options.attempts] - New attempt count.
   * @param {number} [options.nextAttemptAt] - Next attempt timestamp in ms.
   * @param {boolean} [options.terminal=false] - Whether failure is terminal.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function markFailed(messageId, error, { attempts, nextAttemptAt, terminal = false } = {}) {
    if (terminal) {
      return db.execute(`DELETE FROM outbox WHERE message_id = ?`, [messageId])
    }

    const now = Date.now()
    return db.execute(
      `UPDATE outbox
       SET attempts = ?, next_attempt_at = ?, last_attempt_at = ?, last_error = ?
       WHERE message_id = ?`,
      [attempts, nextAttemptAt, now, error, messageId]
    )
  }

  /**
   * Returns total count of outbox rows.
   *
   * @returns {Promise<number>} Number of outbox rows.
   */
  async function count() {
    const res = await db.queryOne(`SELECT COUNT(*) AS c FROM outbox`)
    return res?.c ?? 0
  }

  /**
   * Returns count of due outbox rows ready for attempt.
   *
   * @returns {Promise<number>} Number of due outbox rows.
   */
  async function countDue() {
    const now = Date.now()
    const res = await db.queryOne(
      `SELECT COUNT(*) AS c FROM outbox WHERE next_attempt_at <= ?`,
      [now]
    )
    return res?.c ?? 0
  }

  /**
   * Lists all outbox rows for a specific room in FIFO order.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<Array<object>>} Outbox rows for the room.
   */
  async function listByRoom(roomId) {
    return db.query(
      `SELECT message_id, room_id, enqueued_at, attempts, next_attempt_at, last_attempt_at, last_error
       FROM outbox
       WHERE room_id = ?
       ORDER BY next_attempt_at ASC, enqueued_at ASC`,
      [roomId]
    )
  }

  /**
   * Removes all outbox rows for a specific room.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function removeByRoom(roomId) {
    return db.execute(`DELETE FROM outbox WHERE room_id = ?`, [roomId])
  }

  /**
   * Removes a single outbox row by message ID.
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function remove(messageId) {
    return db.execute(`DELETE FROM outbox WHERE message_id = ?`, [messageId])
  }

  /**
   * Deletes all outbox rows.
   *
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function clearAll() {
    return db.execute(`DELETE FROM outbox`)
  }

  return {
    enqueue,
    dequeue,
    peek,
    list,
    get,
    markSent,
    markFailed,
    count,
    countDue,
    listByRoom,
    removeByRoom,
    remove,
    clearAll
  }
}
