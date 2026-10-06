/**
 * Room members repository factory module.
 *
 * Provides storage methods for managing room membership associations,
 * user roles, and membership join timestamps.
 *
 * @module @atoll/app/lib/db/repositories/room-members
 */

/**
 * Creates a room members repository instance.
 *
 * @param {object} options - Options.
 * @param {object} options.db - Opened or lazy database handle from createDb.
 * @returns {object} Room members repository async interface.
 */
export function createRoomMembersRepository({ db }) {
  /**
   * Lists all members of a given room ordered by joined_at ASC.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<Array<object>>} List of room member records.
   */
  async function listInRoom(roomId) {
    return db.query(
      'SELECT room_id, user_id, role, joined_at FROM room_members WHERE room_id = ? ORDER BY joined_at ASC',
      [roomId]
    )
  }

  /**
   * Retrieves a single membership record for a specific room and user pair.
   *
   * @param {string} roomId - Room identifier.
   * @param {string} userId - User identifier.
   * @returns {Promise<object | undefined>} Member record or undefined if not found.
   */
  async function get(roomId, userId) {
    const row = await db.queryOne(
      'SELECT room_id, user_id, role, joined_at FROM room_members WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    )
    return row ?? undefined
  }

  /**
   * Adds or updates a room member record.
   *
   * @param {object} params - Parameters.
   * @param {string} params.roomId - Room identifier.
   * @param {string} params.userId - User identifier.
   * @param {string} params.role - Member role ('owner', 'moderator', 'member').
   * @param {number} [params.joinedAt] - Timestamp in milliseconds since epoch. Defaults to Date.now().
   * @returns {Promise<{ changes: number }>} Execution result with modified row count.
   */
  async function addMember({ roomId, userId, role, joinedAt }) {
    const now = joinedAt ?? Date.now()
    return db.execute(
      `INSERT INTO room_members (room_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET
         role      = excluded.role,
         joined_at = excluded.joined_at`,
      [roomId, userId, role, now]
    )
  }

  /**
   * Removes a single member record from a room.
   *
   * @param {string} roomId - Room identifier.
   * @param {string} userId - User identifier.
   * @returns {Promise<{ changes: number }>} Execution result with modified row count.
   */
  async function removeMember(roomId, userId) {
    return db.execute('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId])
  }

  /**
   * Removes all member records for a given room.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution result with modified row count.
   */
  async function removeAllInRoom(roomId) {
    return db.execute('DELETE FROM room_members WHERE room_id = ?', [roomId])
  }

  /**
   * Lists room identifiers for all rooms a user belongs to, ordered by joined_at DESC.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<Array<string>>} List of room identifiers.
   */
  async function listRoomsForUser(userId) {
    const rows = await db.query(
      'SELECT room_id FROM room_members WHERE user_id = ? ORDER BY joined_at DESC',
      [userId]
    )
    return rows.map((r) => r.room_id)
  }

  /**
   * Returns the count of members in a specific room.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<number>} Member count.
   */
  async function countInRoom(roomId) {
    const row = await db.queryOne('SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?', [roomId])
    return row?.c ?? 0
  }

  /**
   * Deletes all rows from the room_members table.
   *
   * @returns {Promise<{ changes: number }>} Execution result with modified row count.
   */
  async function clearAll() {
    return db.execute('DELETE FROM room_members', [])
  }

  return {
    listInRoom,
    get,
    addMember,
    removeMember,
    removeAllInRoom,
    listRoomsForUser,
    countInRoom,
    clearAll
  }
}
