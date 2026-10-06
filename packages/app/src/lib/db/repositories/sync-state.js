/**
 * Repository for sync_state domain operations.
 *
 * @module @atoll/app/lib/db/repositories/sync-state
 */

/**
 * Creates a sync state repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The sync state repository API.
 */
export function createSyncStateRepository({ db }) {
  /**
   * Retrieves a single sync state record for a room ID.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<object | undefined>} Sync state record or undefined if missing.
   */
  async function get(roomId) {
    return db.queryOne(
      `SELECT room_id, epoch, seq, updated_at
       FROM sync_state
       WHERE room_id = ?`,
      [roomId]
    )
  }

  /**
   * Retrieves the (epoch, seq) cursor pair for a room ID.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ epoch: number, seq: number } | undefined>} Cursor pair or undefined if missing.
   */
  async function getCursor(roomId) {
    const row = await db.queryOne(
      `SELECT epoch, seq FROM sync_state WHERE room_id = ?`,
      [roomId]
    )
    return row ? { epoch: row.epoch, seq: row.seq } : undefined
  }

  /**
   * Unconditionally sets or updates the cursor for a room.
   *
   * @param {string} roomId - Room identifier.
   * @param {object} cursor - Cursor values.
   * @param {number} cursor.epoch - MLS epoch counter.
   * @param {number} cursor.seq - Sequence number within epoch.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function set(roomId, { epoch, seq }) {
    return db.execute(
      `INSERT INTO sync_state (room_id, epoch, seq, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET
         epoch      = excluded.epoch,
         seq        = excluded.seq,
         updated_at = excluded.updated_at`,
      [roomId, epoch, seq, Date.now()]
    )
  }

  /**
   * Advances the cursor for a room only if the new (epoch, seq) is strictly greater.
   *
   * @param {string} roomId - Room identifier.
   * @param {object} cursor - Proposed new cursor values.
   * @param {number} cursor.epoch - Proposed MLS epoch counter.
   * @param {number} cursor.seq - Proposed sequence number within epoch.
   * @returns {Promise<{ changes: number }>} Execution result summary ({ changes: 1 } if advanced, { changes: 0 } if skipped).
   */
  async function advance(roomId, { epoch, seq }) {
    return db.transaction(async () => {
      const current = await db.queryOne(
        `SELECT epoch, seq FROM sync_state WHERE room_id = ?`,
        [roomId]
      )
      if (current) {
        const sameOrLater =
          current.epoch > epoch || (current.epoch === epoch && current.seq >= seq)
        if (sameOrLater) {
          return { changes: 0 }
        }
      }
      return db.execute(
        `INSERT INTO sync_state (room_id, epoch, seq, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(room_id) DO UPDATE SET
           epoch      = excluded.epoch,
           seq        = excluded.seq,
           updated_at = excluded.updated_at`,
        [roomId, epoch, seq, Date.now()]
      )
    })
  }

  /**
   * Lists all sync state records ordered by updated_at DESC.
   *
   * @returns {Promise<Array<object>>} List of sync state records.
   */
  async function list() {
    return db.query(
      `SELECT room_id, epoch, seq, updated_at
       FROM sync_state
       ORDER BY updated_at DESC`
    )
  }

  /**
   * Removes the sync cursor for a room.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function remove(roomId) {
    return db.execute(
      `DELETE FROM sync_state WHERE room_id = ?`,
      [roomId]
    )
  }

  /**
   * Deletes every sync state record in the database.
   *
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function clearAll() {
    return db.execute(`DELETE FROM sync_state`)
  }

  return {
    get,
    getCursor,
    set,
    advance,
    list,
    remove,
    clearAll
  }
}
