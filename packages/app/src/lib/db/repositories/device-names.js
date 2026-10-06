/**
 * Repository for device_names domain operations.
 *
 * @module @atoll/app/lib/db/repositories/device-names
 */

/**
 * Creates a device names repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The device names repository API.
 */
export function createDeviceNamesRepository({ db }) {
  /**
   * Retrieves a single device name record for a user and device ID.
   *
   * @param {string} userId - User identifier.
   * @param {string} deviceId - Server device identifier.
   * @returns {Promise<object | undefined>} Device record or undefined if missing.
   */
  async function get(userId, deviceId) {
    return db.queryOne(
      `SELECT user_id, device_id, encrypted_device_name, user_seq, updated_at, deleted_at
       FROM device_names
       WHERE user_id = ? AND device_id = ?`,
      [userId, deviceId]
    )
  }

  /**
   * Lists all device name records for a user, including tombstones, ordered by user_seq DESC.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<Array<object>>} List of device records.
   */
  async function listForUser(userId) {
    return db.query(
      `SELECT user_id, device_id, encrypted_device_name, user_seq, updated_at, deleted_at
       FROM device_names
       WHERE user_id = ?
       ORDER BY user_seq DESC`,
      [userId]
    )
  }

  /**
   * Lists active (non-tombstoned) device name records for a user, ordered by user_seq DESC.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<Array<object>>} List of active device records.
   */
  async function listActiveForUser(userId) {
    return db.query(
      `SELECT user_id, device_id, encrypted_device_name, user_seq, updated_at, deleted_at
       FROM device_names
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY user_seq DESC`,
      [userId]
    )
  }

  /**
   * Applies a remote device record from sync response or socket event.
   *
   * @param {object} params - Remote record parameters.
   * @param {string} params.userId - User identifier.
   * @param {string} params.deviceId - Server device identifier.
   * @param {string} params.encryptedDeviceName - Base64url ciphertext.
   * @param {number} params.userSeq - Server sequence number.
   * @param {number | null} [params.deletedAt=null] - Optional tombstone timestamp.
   * @returns {Promise<{ changes: number }>} Changes count ({ changes: 1 } if applied, { changes: 0 } if skipped).
   */
  async function applyRemote({ userId, deviceId, encryptedDeviceName, userSeq, deletedAt = null }) {
    const existing = await db.queryOne(
      'SELECT user_seq FROM device_names WHERE user_id = ? AND device_id = ?',
      [userId, deviceId]
    )
    if (existing && existing.user_seq >= userSeq) {
      return { changes: 0 }
    }
    return db.execute(
      `INSERT INTO device_names (user_id, device_id, encrypted_device_name, user_seq, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, device_id) DO UPDATE SET
         encrypted_device_name = excluded.encrypted_device_name,
         user_seq              = excluded.user_seq,
         updated_at            = excluded.updated_at,
         deleted_at            = excluded.deleted_at`,
      [userId, deviceId, encryptedDeviceName, userSeq, Date.now(), deletedAt]
    )
  }

  /**
   * Applies a batch of sync device records in user_seq order inside a single transaction.
   *
   * @param {string} userId - User identifier.
   * @param {Array<object>} rows - Array of remote device records.
   * @returns {Promise<{ applied: number, skipped: number }>} Batch application result counts.
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
   * Retrieves the highest user_seq recorded for a user.
   *
   * @param {string} userId - User identifier.
   * @returns {Promise<number>} Highest user_seq recorded, or 0 if no records exist.
   */
  async function getHighestSeq(userId) {
    const row = await db.queryOne(
      'SELECT MAX(user_seq) AS max_seq FROM device_names WHERE user_id = ?',
      [userId]
    )
    return row?.max_seq ?? 0
  }

  /**
   * Hard-deletes a single device name record (local-only / testing).
   *
   * @param {string} userId - User identifier.
   * @param {string} deviceId - Server device identifier.
   * @returns {Promise<{ changes: number }>} Result summary.
   */
  async function remove(userId, deviceId) {
    return db.execute(
      'DELETE FROM device_names WHERE user_id = ? AND device_id = ?',
      [userId, deviceId]
    )
  }

  /**
   * Hard-deletes all device name records.
   *
   * @returns {Promise<{ changes: number }>} Result summary.
   */
  async function clearAll() {
    return db.execute('DELETE FROM device_names')
  }

  return {
    get,
    listForUser,
    listActiveForUser,
    applyRemote,
    applyBatch,
    getHighestSeq,
    remove,
    clearAll
  }
}
