/**
 * Room order repository factory module.
 *
 * Provides storage methods for caching user custom room display order.
 *
 * @module @atoll/app/lib/db/repositories/room-order
 */

/**
 * Creates a room order repository instance.
 *
 * @param {object} options - Options.
 * @param {object} options.db - Opened or lazy database handle from createDb.
 * @returns {object} Room order repository async interface.
 */
export function createRoomOrderRepository({ db }) {
  /**
   * Lists room identifiers ordered by position ASC.
   *
   * @returns {Promise<Array<string>>} Ordered array of room identifiers.
   */
  async function list() {
    const rows = await db.query('SELECT room_id FROM room_order ORDER BY position ASC', [])
    return rows.map((r) => r.room_id)
  }

  /**
   * Replaces the entire room order sequence in a single transaction.
   * Assigns dense 0-based position indices.
   *
   * @param {Array<string>} roomIds - Array of room identifiers in desired order.
   * @returns {Promise<{ changes: number }>} Execution result with count of ordered rooms.
   */
  async function setOrder(roomIds) {
    const now = Date.now()
    return db.transaction(async () => {
      await db.execute('DELETE FROM room_order', [])
      let position = 0
      for (const roomId of roomIds) {
        await db.execute(
          'INSERT INTO room_order (room_id, position, updated_at) VALUES (?, ?, ?)',
          [roomId, position, now]
        )
        position += 1
      }
      return { changes: roomIds.length }
    })
  }

  /**
   * Reorders a room before another room in the cached sequence.
   * If either room is not present in the current order, returns { changes: 0 } without modifying order.
   *
   * @param {string} roomId - Room identifier to move.
   * @param {string} beforeRoomId - Target room identifier to place before.
   * @returns {Promise<{ changes: number }>} Execution result with count of ordered rooms or 0 if invalid.
   */
  async function moveBefore(roomId, beforeRoomId) {
    const current = await list()
    if (!current.includes(roomId) || !current.includes(beforeRoomId)) {
      return { changes: 0 }
    }
    const next = current.filter((id) => id !== roomId)
    const index = next.indexOf(beforeRoomId)
    next.splice(index, 0, roomId)
    return setOrder(next)
  }

  /**
   * Retrieves the zero-based position index of a room.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<number | undefined>} Zero-based position index or undefined if not ordered.
   */
  async function getPosition(roomId) {
    const row = await db.queryOne('SELECT position FROM room_order WHERE room_id = ?', [roomId])
    return row?.position ?? undefined
  }

  /**
   * Deletes all rows from the room_order table.
   *
   * @returns {Promise<{ changes: number }>} Execution result with modified row count.
   */
  async function clearAll() {
    return db.execute('DELETE FROM room_order', [])
  }

  return {
    list,
    setOrder,
    moveBefore,
    getPosition,
    clearAll
  }
}
