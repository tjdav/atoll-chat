/**
 * Repository for drafts domain operations.
 *
 * @module @atoll/app/lib/db/repositories/drafts
 */

/**
 * Creates a drafts repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The drafts repository API.
 */
export function createDraftsRepository({ db }) {
  /**
   * Retrieves a draft row by room ID.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<object | undefined>} Draft row or undefined if not found.
   */
  async function get(roomId) {
    const row = await db.queryOne(
      `SELECT room_id, text, updated_at FROM drafts WHERE room_id = ?`,
      [roomId]
    )
    return row ?? undefined
  }

  /**
   * Convenience method to retrieve draft text string directly.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<string | null>} Draft text string or null if not found.
   */
  async function getText(roomId) {
    const row = await db.queryOne(
      `SELECT text FROM drafts WHERE room_id = ?`,
      [roomId]
    )
    return row?.text ?? null
  }

  /**
   * Deletes a draft for a specific room ID.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function remove(roomId) {
    return db.execute(`DELETE FROM drafts WHERE room_id = ?`, [roomId])
  }

  /**
   * Inserts or replaces a draft for a room. Empty or whitespace-only text deletes the draft row.
   *
   * @param {string} roomId - Room identifier.
   * @param {string} text - Draft text.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function set(roomId, text) {
    if (typeof text !== 'string' || text.trim() === '') {
      return remove(roomId)
    }
    const now = Date.now()
    return db.execute(
      `INSERT OR REPLACE INTO drafts (room_id, text, updated_at) VALUES (?, ?, ?)`,
      [roomId, text, now]
    )
  }

  /**
   * Lists all drafts ordered by updated_at DESC.
   *
   * @returns {Promise<Array<object>>} List of draft rows.
   */
  async function list() {
    return db.query(`SELECT room_id, text, updated_at FROM drafts ORDER BY updated_at DESC`)
  }

  /**
   * Returns the count of stored drafts.
   *
   * @returns {Promise<number>} Number of drafts.
   */
  async function count() {
    const res = await db.queryOne(`SELECT COUNT(*) AS count FROM drafts`)
    return res?.count ?? 0
  }

  /**
   * Deletes all draft rows.
   *
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function clearAll() {
    return db.execute(`DELETE FROM drafts`)
  }

  return {
    get,
    getText,
    set,
    remove,
    list,
    count,
    clearAll
  }
}
