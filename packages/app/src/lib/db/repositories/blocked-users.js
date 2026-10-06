/**
 * Repository for blocked_users domain operations.
 *
 * @module @atoll/app/lib/db/repositories/blocked-users
 */

/**
 * Creates a blocked users repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The blocked users repository API.
 */
export function createBlockedUsersRepository({ db }) {
  /**
   * Checks whether a specific user ID is blocked.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<boolean>} True if blocked, false otherwise.
   */
  async function isBlocked(userId) {
    const row = await db.queryOne(
      `SELECT 1 AS present FROM blocked_users WHERE user_id = ? LIMIT 1`,
      [userId]
    )
    return Boolean(row?.present)
  }

  /**
   * Lists all blocked users ordered by blocked_at DESC.
   *
   * @returns {Promise<Array<object>>} List of blocked user rows.
   */
  async function list() {
    return db.query(`SELECT user_id, blocked_at FROM blocked_users ORDER BY blocked_at DESC`)
  }

  /**
   * Adds a user to the block list using INSERT OR REPLACE.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function add(userId) {
    const now = Date.now()
    return db.execute(
      `INSERT OR REPLACE INTO blocked_users (user_id, blocked_at) VALUES (?, ?)`,
      [userId, now]
    )
  }

  /**
   * Removes a user from the block list.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function remove(userId) {
    return db.execute(`DELETE FROM blocked_users WHERE user_id = ?`, [userId])
  }

  /**
   * Returns the total count of blocked users.
   *
   * @returns {Promise<number>} Number of blocked users.
   */
  async function count() {
    const res = await db.queryOne(`SELECT COUNT(*) AS count FROM blocked_users`)
    return res?.count ?? 0
  }

  /**
   * Deletes all blocked user rows.
   *
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function clearAll() {
    return db.execute(`DELETE FROM blocked_users`)
  }

  return {
    isBlocked,
    list,
    add,
    remove,
    count,
    clearAll
  }
}
