/**
 * Repository for room_preferences domain operations.
 *
 * @module @atoll/app/lib/db/repositories/room-preferences
 */

/**
 * Creates a room preferences repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The room preferences repository API.
 */
export function createRoomPreferencesRepository({ db }) {
  /**
   * Retrieves a single deserialized preference value for a user, room, and key tuple.
   *
   * @param {string} userId - User identifier who owns the preference.
   * @param {string} roomId - Room identifier.
   * @param {string} key - Preference key name.
   * @returns {Promise<any>} Deserialized preference value, or undefined if missing or malformed JSON.
   */
  async function get(userId, roomId, key) {
    const row = await db.queryOne(
      'SELECT value_json FROM room_preferences WHERE user_id = ? AND room_id = ? AND key = ?',
      [userId, roomId, key]
    )
    if (!row) return undefined
    try {
      return JSON.parse(row.value_json)
    } catch {
      return undefined
    }
  }

  /**
   * Retrieves all preferences for a user in a room as a key-value mapping object.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @returns {Promise<Record<string, any>>} Mapping of preference keys to deserialized values.
   */
  async function getAll(userId, roomId) {
    const rows = await db.query(
      'SELECT key, value_json FROM room_preferences WHERE user_id = ? AND room_id = ?',
      [userId, roomId]
    )
    const out = {}
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value_json)
      } catch {
        // Skip malformed entries
      }
    }
    return out
  }

  /**
   * Upserts a single room preference value.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @param {string} key - Preference key.
   * @param {any} value - Value to store (must be JSON-serializable).
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function set(userId, roomId, key, value) {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      throw new Error('Value cannot be serialized to JSON')
    }
    return db.execute(
      `INSERT INTO room_preferences (user_id, room_id, key, value_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, room_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      [userId, roomId, key, serialized, Date.now()]
    )
  }

  /**
   * Upserts multiple preference entries for a user and room pair within a single transaction.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @param {Record<string, any>} entries - Map of preference keys to values.
   * @returns {Promise<{ changes: number }>} Execution result summary with total changes.
   */
  async function setMany(userId, roomId, entries) {
    const now = Date.now()
    return db.transaction(async () => {
      let total = 0
      for (const [key, value] of Object.entries(entries)) {
        const serialized = JSON.stringify(value)
        if (serialized === undefined) {
          throw new Error(`Value for key "${key}" cannot be serialized to JSON`)
        }
        const r = await db.execute(
          `INSERT INTO room_preferences (user_id, room_id, key, value_json, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, room_id, key) DO UPDATE SET
             value_json = excluded.value_json,
             updated_at = excluded.updated_at`,
          [userId, roomId, key, serialized, now]
        )
        total += r.changes
      }
      return { changes: total }
    })
  }

  /**
   * Deletes a single preference entry.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @param {string} key - Preference key.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function remove(userId, roomId, key) {
    return db.execute(
      'DELETE FROM room_preferences WHERE user_id = ? AND room_id = ? AND key = ?',
      [userId, roomId, key]
    )
  }

  /**
   * Deletes all preference entries for a user in a specified room.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function removeAllInRoom(userId, roomId) {
    return db.execute(
      'DELETE FROM room_preferences WHERE user_id = ? AND room_id = ?',
      [userId, roomId]
    )
  }

  /**
   * Lists all preference key names existing for a user in a room, sorted ascending.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @returns {Promise<string[]>} List of preference keys sorted ascending.
   */
  async function listKeys(userId, roomId) {
    const rows = await db.query(
      'SELECT key FROM room_preferences WHERE user_id = ? AND room_id = ? ORDER BY key ASC',
      [userId, roomId]
    )
    return rows.map((r) => r.key)
  }

  /**
   * Counts total preference rows stored for a user across all rooms.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<number>} Total number of stored preference rows.
   */
  async function count(userId) {
    const row = await db.queryOne(
      'SELECT COUNT(*) AS c FROM room_preferences WHERE user_id = ?',
      [userId]
    )
    return row?.c ?? 0
  }

  /**
   * Clears all room_preferences rows across all users and rooms.
   *
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function clearAll() {
    return db.execute('DELETE FROM room_preferences', [])
  }

  return {
    get,
    getAll,
    set,
    setMany,
    remove,
    removeAllInRoom,
    listKeys,
    count,
    clearAll
  }
}
