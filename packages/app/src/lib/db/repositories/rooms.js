/**
 * Rooms repository factory module.
 *
 * Provides storage methods for caching room metadata, member associations,
 * disappearing message timer configurations, and metadata versions.
 *
 * @module @atoll/app/lib/db/repositories/rooms
 */

/**
 * Creates a rooms repository instance.
 *
 * @param {object} options - Options.
 * @param {object} options.db - Opened or lazy database handle from createDb.
 * @returns {object} Rooms repository async interface.
 */
export function createRoomsRepository({ db }) {
  /**
   * Retrieves a cached room record by room_id.
   *
   * @param {string} roomId - The unique room identifier.
   * @returns {Promise<object | undefined>} Cached room row or undefined if not found.
   */
  async function get(roomId) {
    const row = await db.queryOne(
      'SELECT room_id, name, avatar_file_id, description, disappearing_timer, metadata_version, updated_at FROM rooms WHERE room_id = ?',
      [roomId]
    )
    return row ?? undefined
  }

  /**
   * Inserts or updates a room record using partial upsert semantics.
   * Non-provided fields retain existing cached values via COALESCE.
   * Exception: metadata_version is always updated to the new provided value or defaults to 1.
   *
   * @param {object} params - Upsert parameters.
   * @param {string} params.roomId - Room identifier.
   * @param {string | null} [params.name] - Decrypted room name.
   * @param {string | null} [params.avatarFileId] - Avatar attachment file identifier.
   * @param {string | null} [params.description] - Decrypted room description.
   * @param {number | null} [params.disappearingTimer] - Disappearing message timer in seconds.
   * @param {number} [params.metadataVersion=1] - Monotonic room metadata version.
   * @returns {Promise<{ changes: number }>} Execution result with modified row count.
   */
  async function upsert({
    roomId,
    name = null,
    avatarFileId = null,
    description = null,
    disappearingTimer = null,
    metadataVersion = 1
  }) {
    const now = Date.now()
    return db.execute(
      `INSERT INTO rooms (room_id, name, avatar_file_id, description, disappearing_timer, metadata_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET
         name                = COALESCE(excluded.name, rooms.name),
         avatar_file_id      = COALESCE(excluded.avatar_file_id, rooms.avatar_file_id),
         description         = COALESCE(excluded.description, rooms.description),
         disappearing_timer  = COALESCE(excluded.disappearing_timer, rooms.disappearing_timer),
         metadata_version    = excluded.metadata_version,
         updated_at          = excluded.updated_at`,
      [roomId, name, avatarFileId, description, disappearingTimer, metadataVersion, now]
    )
  }

  /**
   * Removes a cached room record and all related rows from room_members and room_order
   * in a single transaction.
   *
   * @param {string} roomId - Room identifier to remove.
   * @returns {Promise<{ changes: number }>} Execution result with modified row count from rooms deletion.
   */
  async function remove(roomId) {
    return db.transaction(async () => {
      await db.execute('DELETE FROM room_members WHERE room_id = ?', [roomId])
      await db.execute('DELETE FROM room_order WHERE room_id = ?', [roomId])
      return db.execute('DELETE FROM rooms WHERE room_id = ?', [roomId])
    })
  }

  /**
   * Lists a page of cached rooms ordered by updated_at DESC.
   * Supports cursor-based pagination using the last seen updated_at timestamp.
   *
   * @param {object} [options={}] - Options.
   * @param {number} [options.limit=100] - Maximum rows to return.
   * @param {number} [options.cursor] - Pagination cursor (updated_at timestamp threshold).
   * @returns {Promise<Array<object>>} Page of room records.
   */
  async function list({ limit = 100, cursor } = {}) {
    if (cursor !== undefined && cursor !== null) {
      return db.query(
        'SELECT room_id, name, avatar_file_id, description, disappearing_timer, metadata_version, updated_at FROM rooms WHERE updated_at < ? ORDER BY updated_at DESC LIMIT ?',
        [cursor, limit]
      )
    }
    return db.query(
      'SELECT room_id, name, avatar_file_id, description, disappearing_timer, metadata_version, updated_at FROM rooms ORDER BY updated_at DESC LIMIT ?',
      [limit]
    )
  }

  /**
   * Returns the total count of cached room rows.
   *
   * @returns {Promise<number>} Total cached rows.
   */
  async function count() {
    const row = await db.queryOne('SELECT COUNT(*) AS c FROM rooms', [])
    return row?.c ?? 0
  }

  /**
   * Deletes all cached room records and their associated room_members and room_order rows in a single transaction.
   *
   * @returns {Promise<{ changes: number }>} Execution result with modified row count from rooms table deletion.
   */
  async function clearAll() {
    return db.transaction(async () => {
      await db.execute('DELETE FROM room_members', [])
      await db.execute('DELETE FROM room_order', [])
      return db.execute('DELETE FROM rooms', [])
    })
  }

  return {
    get,
    upsert,
    remove,
    list,
    count,
    clearAll
  }
}
