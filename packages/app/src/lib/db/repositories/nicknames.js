/**
 * Repository for nicknames domain operations.
 *
 * @module @atoll/app/lib/db/repositories/nicknames
 */

/**
 * Creates a nicknames repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The nicknames repository API.
 */
export function createNicknamesRepository({ db }) {
  /**
   * Retrieves a nickname for a user in a room.
   *
   * @param {string} roomId - Room identifier.
   * @param {string} userId - Target user identifier.
   * @returns {Promise<string | null>} Nickname string or null if not set.
   */
  async function get(roomId, userId) {
    const row = await db.queryOne(
      'SELECT nickname FROM nicknames WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    )
    return row?.nickname ?? null
  }

  /**
   * Retrieves nicknames for a set of target users in a room.
   *
   * @param {string} roomId - Room identifier.
   * @param {string[]} userIds - Target user identifiers.
   * @returns {Promise<Record<string, string>>} Object mapping user_id to nickname.
   */
  async function getMany(roomId, userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) return {}
    const placeholders = userIds.map(() => '?').join(', ')
    const rows = await db.query(
      `SELECT user_id, nickname FROM nicknames WHERE room_id = ? AND user_id IN (${placeholders})`,
      [roomId, ...userIds]
    )
    const out = {}
    for (const row of rows) {
      out[row.user_id] = row.nickname
    }
    return out
  }

  /**
   * Upserts a nickname for a user in a room. Empty or whitespace-only nicknames delete the entry.
   *
   * @param {string} roomId - Room identifier.
   * @param {string} userId - Target user identifier.
   * @param {string} nickname - Nickname alias string.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function set(roomId, userId, nickname) {
    if (typeof nickname !== 'string' || nickname.trim() === '') {
      return remove(roomId, userId)
    }
    return db.execute(
      `INSERT INTO nicknames (room_id, user_id, nickname, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET
         nickname = excluded.nickname,
         updated_at = excluded.updated_at`,
      [roomId, userId, nickname, Date.now()]
    )
  }

  /**
   * Deletes a nickname entry for a user in a room.
   *
   * @param {string} roomId - Room identifier.
   * @param {string} userId - Target user identifier.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function remove(roomId, userId) {
    return db.execute(
      'DELETE FROM nicknames WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    )
  }

  /**
   * Lists all nickname records stored for a room, ordered by user_id ascending.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<Array<{ room_id: string, user_id: string, nickname: string, updated_at: number }>>} Array of nickname rows.
   */
  async function listInRoom(roomId) {
    return db.query(
      `SELECT room_id, user_id, nickname, updated_at
       FROM nicknames
       WHERE room_id = ?
       ORDER BY user_id ASC`,
      [roomId]
    )
  }

  /**
   * Lists room identifiers where a specified user has a nickname set, ordered by room_id ascending.
   *
   * @param {string} userId - Target user identifier.
   * @returns {Promise<string[]>} Array of room identifiers.
   */
  async function listRoomsForUser(userId) {
    const rows = await db.query(
      'SELECT room_id FROM nicknames WHERE user_id = ? ORDER BY room_id ASC',
      [userId]
    )
    return rows.map((r) => r.room_id)
  }

  /**
   * Deletes all nicknames stored in a room.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function removeAllInRoom(roomId) {
    return db.execute('DELETE FROM nicknames WHERE room_id = ?', [roomId])
  }

  /**
   * Counts the total number of nicknames stored in a room.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<number>} Total nickname count in room.
   */
  async function countInRoom(roomId) {
    const row = await db.queryOne(
      'SELECT COUNT(*) AS c FROM nicknames WHERE room_id = ?',
      [roomId]
    )
    return row?.c ?? 0
  }

  /**
   * Clears all nickname records across all rooms.
   *
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function clearAll() {
    return db.execute('DELETE FROM nicknames', [])
  }

  return {
    get,
    getMany,
    set,
    remove,
    listInRoom,
    listRoomsForUser,
    removeAllInRoom,
    countInRoom,
    clearAll
  }
}
