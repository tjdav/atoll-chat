/**
 * Repository for starred_items domain operations.
 *
 * @module @atoll/app/lib/db/repositories/starred-items
 */

/**
 * Creates a starred items repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The starred items repository API.
 */
export function createStarredItemsRepository({ db }) {
  /**
   * Retrieves a single starred item record.
   *
   * @param {string} userId - User identifier.
   * @param {string} itemId - Item identifier.
   * @param {string} itemType - Item type ('attachment', 'message', 'link').
   * @returns {Promise<object | undefined>} Starred item record or undefined if missing.
   */
  async function get(userId, itemId, itemType) {
    return db.queryOne(
      `SELECT user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at
       FROM starred_items
       WHERE user_id = ? AND item_id = ? AND item_type = ?`,
      [userId, itemId, itemType]
    )
  }

  /**
   * Checks if an item is currently starred and active (not tombstoned).
   *
   * @param {string} userId - User identifier.
   * @param {string} itemId - Item identifier.
   * @param {string} itemType - Item type.
   * @returns {Promise<boolean>} True if starred and active.
   */
  async function isStarred(userId, itemId, itemType) {
    const row = await db.queryOne(
      `SELECT 1 AS present FROM starred_items
       WHERE user_id = ? AND item_id = ? AND item_type = ? AND deleted_at IS NULL
       LIMIT 1`,
      [userId, itemId, itemType]
    )
    return Boolean(row)
  }

  /**
   * Lists active starred items for a user with optional filter criteria and cursor pagination.
   *
   * @param {string} userId - User identifier.
   * @param {object} [options={}] - Filter and pagination parameters.
   * @param {string} [options.type] - Filter by item_type.
   * @param {string} [options.roomId] - Filter by room_id.
   * @param {number} [options.limit=100] - Maximum records to return.
   * @param {object} [options.cursor] - Pagination cursor ({ starredAt, itemId }).
   * @returns {Promise<Array<object>>} List of active starred items.
   */
  async function listForUser(userId, { type, roomId, limit = 100, cursor } = {}) {
    const whereParts = ['user_id = ?', 'deleted_at IS NULL']
    const params = [userId]

    if (type) {
      whereParts.push('item_type = ?')
      params.push(type)
    }

    if (roomId) {
      whereParts.push('room_id = ?')
      params.push(roomId)
    }

    if (cursor && typeof cursor.starredAt === 'number' && typeof cursor.itemId === 'string') {
      whereParts.push('(starred_at < ? OR (starred_at = ? AND item_id < ?))')
      params.push(cursor.starredAt, cursor.starredAt, cursor.itemId)
    }

    params.push(limit)

    const sql = `SELECT user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at
       FROM starred_items
       WHERE ${whereParts.join(' AND ')}
       ORDER BY starred_at DESC, item_id DESC
       LIMIT ?`

    return db.query(sql, params)
  }

  /**
   * Convenience method to list up to 500 active starred items for a room.
   *
   * @param {string} userId - User identifier.
   * @param {string} roomId - Room identifier.
   * @returns {Promise<Array<object>>} List of active starred items in the room.
   */
  async function listForRoom(userId, roomId) {
    return listForUser(userId, { roomId, limit: 500 })
  }

  /**
   * Applies a remote starred item record from sync response or socket event.
   *
   * @param {object} params - Remote record parameters.
   * @param {string} params.userId - User identifier.
   * @param {string} params.itemId - Item identifier.
   * @param {string} params.itemType - Item type.
   * @param {string} params.roomId - Room identifier.
   * @param {number} params.userSeq - Server sequence number.
   * @param {number} params.starredAt - Timestamp when item was starred.
   * @param {number | null} [params.deletedAt=null] - Optional tombstone timestamp.
   * @returns {Promise<{ changes: number }>} Changes count ({ changes: 1 } if applied, { changes: 0 } if skipped).
   */
  async function applyRemote({ userId, itemId, itemType, roomId, userSeq, starredAt, deletedAt = null }) {
    const existing = await db.queryOne(
      'SELECT user_seq FROM starred_items WHERE user_id = ? AND item_id = ? AND item_type = ?',
      [userId, itemId, itemType]
    )
    if (existing && existing.user_seq >= userSeq) {
      return { changes: 0 }
    }
    return db.execute(
      `INSERT INTO starred_items (user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, item_id, item_type) DO UPDATE SET
         room_id    = excluded.room_id,
         user_seq   = excluded.user_seq,
         starred_at = excluded.starred_at,
         deleted_at = excluded.deleted_at`,
      [userId, itemId, itemType, roomId, userSeq, starredAt, deletedAt]
    )
  }

  /**
   * Convenience wrapper to apply a starred_item.added event with local time.
   *
   * @param {object} params - Event parameters.
   * @param {string} params.userId - User identifier.
   * @param {string} params.itemId - Item identifier.
   * @param {string} params.itemType - Item type.
   * @param {string} params.roomId - Room identifier.
   * @param {number} params.userSeq - Server sequence number.
   * @returns {Promise<{ changes: number }>} Result summary.
   */
  async function applyAddedEvent({ userId, itemId, itemType, roomId, userSeq }) {
    return applyRemote({
      userId,
      itemId,
      itemType,
      roomId,
      userSeq,
      starredAt: Date.now(),
      deletedAt: null
    })
  }

  /**
   * Convenience wrapper to apply a starred_item.removed event.
   *
   * @param {object} params - Event parameters.
   * @param {string} params.userId - User identifier.
   * @param {string} params.itemId - Item identifier.
   * @param {string} params.itemType - Item type.
   * @param {number} params.userSeq - Server sequence number.
   * @returns {Promise<{ changes: number }>} Result summary.
   */
  async function applyRemovedEvent({ userId, itemId, itemType, userSeq }) {
    const existing = await db.queryOne(
      'SELECT room_id, starred_at, user_seq FROM starred_items WHERE user_id = ? AND item_id = ? AND item_type = ?',
      [userId, itemId, itemType]
    )
    if (!existing) {
      return { changes: 0 }
    }
    if (existing.user_seq >= userSeq) {
      return { changes: 0 }
    }
    return db.execute(
      'UPDATE starred_items SET user_seq = ?, deleted_at = ? WHERE user_id = ? AND item_id = ? AND item_type = ?',
      [userSeq, Date.now(), userId, itemId, itemType]
    )
  }

  /**
   * Applies a batch of remote starred item records in user_seq order inside a transaction.
   *
   * @param {string} userId - User identifier.
   * @param {Array<object>} rows - Remote records.
   * @returns {Promise<{ applied: number, skipped: number }>} Result counts.
   */
  async function applyBatch(userId, rows) {
    const sorted = [...rows].sort((a, b) => a.userSeq - b.userSeq)
    return db.transaction(async () => {
      let applied = 0
      let skipped = 0
      for (const row of sorted) {
        const r = await applyRemote({ userId, ...row })
        if (r.changes > 0) {
          applied += 1
        } else {
          skipped += 1
        }
      }
      return { applied, skipped }
    })
  }

  /**
   * Hard-deletes a single starred item record (local-only / testing).
   *
   * @param {string} userId - User identifier.
   * @param {string} itemId - Item identifier.
   * @param {string} itemType - Item type.
   * @returns {Promise<{ changes: number }>} Result summary.
   */
  async function remove(userId, itemId, itemType) {
    return db.execute(
      'DELETE FROM starred_items WHERE user_id = ? AND item_id = ? AND item_type = ?',
      [userId, itemId, itemType]
    )
  }

  /**
   * Counts active (non-tombstoned) starred items for a user.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<number>} Active count.
   */
  async function countForUser(userId) {
    const row = await db.queryOne(
      'SELECT COUNT(*) AS c FROM starred_items WHERE user_id = ? AND deleted_at IS NULL',
      [userId]
    )
    return row?.c ?? 0
  }

  /**
   * Counts active (non-tombstoned) starred items of a specific type for a user.
   *
   * @param {string} userId - User identifier.
   * @param {string} itemType - Item type.
   * @returns {Promise<number>} Active count.
   */
  async function countByType(userId, itemType) {
    const row = await db.queryOne(
      'SELECT COUNT(*) AS c FROM starred_items WHERE user_id = ? AND item_type = ? AND deleted_at IS NULL',
      [userId, itemType]
    )
    return row?.c ?? 0
  }

  /**
   * Retrieves the highest user_seq recorded for a user.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<number>} Highest user_seq recorded, or 0 if no records exist.
   */
  async function getHighestSeq(userId) {
    const row = await db.queryOne(
      'SELECT MAX(user_seq) AS max_seq FROM starred_items WHERE user_id = ?',
      [userId]
    )
    return row?.max_seq ?? 0
  }

  /**
   * Hard-deletes all starred item records.
   *
   * @returns {Promise<{ changes: number }>} Result summary.
   */
  async function clearAll() {
    return db.execute('DELETE FROM starred_items')
  }

  return {
    get,
    isStarred,
    listForUser,
    listForRoom,
    applyRemote,
    applyAddedEvent,
    applyRemovedEvent,
    applyBatch,
    remove,
    countForUser,
    countByType,
    getHighestSeq,
    clearAll
  }
}
