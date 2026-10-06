/**
 * Repository for read_state domain operations.
 *
 * @module @atoll/app/lib/db/repositories/read-state
 */

/**
 * Creates a read state repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The read state repository API.
 */
export function createReadStateRepository({ db }) {
  /**
   * Retrieves read state for a specific user and room pair.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @returns {Promise<object | undefined>} Read state row or undefined if not found.
   */
  async function get(userId, roomId) {
    const row = await db.queryOne(
      `SELECT user_id, room_id, last_read_message_id, last_read_at, marked_unread, updated_at
       FROM read_state
       WHERE user_id = ? AND room_id = ?`,
      [userId, roomId]
    )
    return row ?? undefined
  }

  /**
   * Convenience wrapper retrieving read state for a room and user pair.
   *
   * @param {string} roomId - Room identifier.
   * @param {string} userId - User identifier.
   * @returns {Promise<object | undefined>} Read state row or undefined if not found.
   */
  async function getForRoom(roomId, userId) {
    return get(userId, roomId)
  }

  /**
   * Inserts or updates read position for a user and room pair, preserving marked_unread.
   *
   * @param {object} params - Read state parameters.
   * @param {string} params.userId - User identifier.
   * @param {string} params.roomId - Room identifier.
   * @param {string} [params.lastReadMessageId] - ID of last read message.
   * @param {number} [params.lastReadAt] - Local wall-clock timestamp of when read position was set.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function upsert({ userId, roomId, lastReadMessageId = null, lastReadAt = null }) {
    const now = Date.now()
    return db.execute(
      `INSERT INTO read_state (user_id, room_id, last_read_message_id, last_read_at, marked_unread, updated_at)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(user_id, room_id) DO UPDATE SET
         last_read_message_id = COALESCE(excluded.last_read_message_id, read_state.last_read_message_id),
         last_read_at         = COALESCE(excluded.last_read_at, read_state.last_read_at),
         updated_at           = excluded.updated_at`,
      [userId, roomId, lastReadMessageId, lastReadAt, now]
    )
  }

  /**
   * Sets the manual unread flag for a user and room pair.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @param {boolean} markedUnread - True if manually marked unread, false otherwise.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function setMarkedUnread(userId, roomId, markedUnread) {
    const val = markedUnread ? 1 : 0
    const now = Date.now()
    const existing = await get(userId, roomId)
    if (!existing) {
      return db.execute(
        `INSERT INTO read_state (user_id, room_id, marked_unread, updated_at)
         VALUES (?, ?, ?, ?)`,
        [userId, roomId, val, now]
      )
    }
    return db.execute(
      `UPDATE read_state
       SET marked_unread = ?, updated_at = ?
       WHERE user_id = ? AND room_id = ?`,
      [val, now, userId, roomId]
    )
  }

  /**
   * Clears the manual unread flag for a user and room pair.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function clearMarkedUnread(userId, roomId) {
    return setMarkedUnread(userId, roomId, false)
  }

  /**
   * Lists all read state records for a specific user, ordered by updated_at DESC.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<Array<object>>} List of read state rows.
   */
  async function listForUser(userId) {
    return db.query(
      `SELECT user_id, room_id, last_read_message_id, last_read_at, marked_unread, updated_at
       FROM read_state
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
      [userId]
    )
  }

  /**
   * Deletes a read state record for a specific user and room pair.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function remove(userId, roomId) {
    return db.execute(
      `DELETE FROM read_state WHERE user_id = ? AND room_id = ?`,
      [userId, roomId]
    )
  }

  /**
   * Deletes all read state records.
   *
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function removeAll() {
    return db.execute(`DELETE FROM read_state`)
  }

  /**
   * Alias for removeAll to maintain repository consistency.
   *
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function clearAll() {
    return removeAll()
  }

  return {
    get,
    getForRoom,
    upsert,
    setMarkedUnread,
    clearMarkedUnread,
    listForUser,
    remove,
    removeAll,
    clearAll
  }
}
