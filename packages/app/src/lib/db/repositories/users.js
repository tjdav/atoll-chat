/**
 * Users repository factory module.
 *
 * Provides storage methods for caching user profile metadata, display names,
 * and identity public keys for local resolution.
 *
 * @module @atoll/app/lib/db/repositories/users
 */

/**
 * Creates a users repository instance.
 *
 * @param {object} options - Options.
 * @param {object} options.db - Opened or lazy database handle from createDb.
 * @returns {object} Users repository async interface.
 */
export function createUsersRepository({ db }) {
  /**
   * Retrieves a cached user record by user_id.
   *
   * @param {string} userId - The unique user identifier.
   * @returns {Promise<object | undefined>} Cached user row or undefined if not found.
   */
  async function get(userId) {
    const row = await db.queryOne(
      'SELECT user_id, display_name, identity_pubkey, profile_version, cached_at FROM users WHERE user_id = ?',
      [userId]
    )
    return row ?? undefined
  }

  /**
   * Inserts or updates a user record using partial upsert semantics.
   * Non-provided or explicit null fields retain existing cached values via COALESCE.
   *
   * @param {object} params - Upsert parameters.
   * @param {string} params.userId - User identifier.
   * @param {string | null} [params.displayName] - Decrypted display name.
   * @param {string | null} [params.identityPubkey] - Base64url encoded identity public key.
   * @param {number} [params.profileVersion=1] - Monotonic profile version.
   * @returns {Promise<{ changes: number }>} Execution result with modified row count.
   */
  async function upsert({ userId, displayName = null, identityPubkey = null, profileVersion = 1 }) {
    const now = Date.now()
    return db.execute(
      `INSERT INTO users (user_id, display_name, identity_pubkey, profile_version, cached_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         display_name    = COALESCE(excluded.display_name, users.display_name),
         identity_pubkey = COALESCE(excluded.identity_pubkey, users.identity_pubkey),
         profile_version = excluded.profile_version,
         cached_at       = excluded.cached_at`,
      [userId, displayName, identityPubkey, profileVersion, now]
    )
  }

  /**
   * Removes a cached user record by user_id.
   *
   * @param {string} userId - User identifier to remove.
   * @returns {Promise<{ changes: number }>} Execution result with modified row count.
   */
  async function remove(userId) {
    return db.execute('DELETE FROM users WHERE user_id = ?', [userId])
  }

  /**
   * Lists a page of cached users ordered by cached_at DESC.
   * Supports cursor-based pagination using the last seen cached_at timestamp.
   *
   * @param {object} [options={}] - Options.
   * @param {number} [options.limit=100] - Maximum rows to return.
   * @param {number} [options.cursor] - Pagination cursor (cached_at timestamp threshold).
   * @returns {Promise<Array<object>>} Page of user records.
   */
  async function list({ limit = 100, cursor } = {}) {
    if (cursor !== undefined && cursor !== null) {
      return db.query(
        'SELECT user_id, display_name, identity_pubkey, profile_version, cached_at FROM users WHERE cached_at < ? ORDER BY cached_at DESC LIMIT ?',
        [cursor, limit]
      )
    }
    return db.query(
      'SELECT user_id, display_name, identity_pubkey, profile_version, cached_at FROM users ORDER BY cached_at DESC LIMIT ?',
      [limit]
    )
  }

  /**
   * Returns the total count of cached user rows.
   *
   * @returns {Promise<number>} Total cached rows.
   */
  async function count() {
    const row = await db.queryOne('SELECT COUNT(*) AS c FROM users', [])
    return row?.c ?? 0
  }

  /**
   * Deletes all cached user records from the users table.
   *
   * @returns {Promise<{ changes: number }>} Execution result with modified row count.
   */
  async function clearAll() {
    return db.execute('DELETE FROM users', [])
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
