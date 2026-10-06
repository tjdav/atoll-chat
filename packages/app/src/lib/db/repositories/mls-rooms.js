/**
 * Repository for mls_rooms domain operations.
 *
 * @module @atoll/app/lib/db/repositories/mls-rooms
 */

/**
 * Creates an MLS rooms repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The MLS rooms repository API.
 */
export function createMlsRoomsRepository({ db }) {
  /**
   * Retrieves MLS group state metadata for a room ID.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<object | undefined>} MLS room state record or undefined if missing.
   */
  async function get(roomId) {
    return db.queryOne(
      `SELECT room_id, local_client_id, current_epoch, membership_status, confirmed_transcript_hash, last_error, joined_at, updated_at
       FROM mls_rooms
       WHERE room_id = ?`,
      [roomId]
    )
  }

  /**
   * Performs partial or full upsert of MLS room state metadata.
   * Preserves existing fields when unprovided using COALESCE.
   * Note: current_epoch always replaces the current value when explicitly provided.
   *
   * @param {object} params - MLS room parameters.
   * @param {string} params.roomId - Room identifier.
   * @param {string} [params.localClientId] - Client ID within MLS group.
   * @param {number} [params.currentEpoch] - Latest epoch number.
   * @param {string} [params.membershipStatus] - Membership status ('pending', 'joined', 'left', 'error').
   * @param {Uint8Array} [params.confirmedTranscriptHash] - Confirmed transcript hash BLOB.
   * @param {string} [params.lastError] - Error description string if in 'error' status.
   * @param {number} [params.joinedAt] - Millisecond timestamp when joined.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function upsert({
    roomId,
    localClientId,
    currentEpoch,
    membershipStatus,
    confirmedTranscriptHash,
    lastError,
    joinedAt
  }) {
    const now = Date.now()
    const epochParam = currentEpoch ?? null
    const statusParam = membershipStatus ?? null
    return db.execute(
      `INSERT INTO mls_rooms (room_id, local_client_id, current_epoch, membership_status, confirmed_transcript_hash, last_error, joined_at, updated_at)
       VALUES (?, ?, COALESCE(?, 0), COALESCE(?, 'pending'), ?, ?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET
         local_client_id           = COALESCE(excluded.local_client_id, mls_rooms.local_client_id),
         current_epoch             = CASE WHEN ? IS NOT NULL THEN excluded.current_epoch ELSE mls_rooms.current_epoch END,
         membership_status         = CASE WHEN ? IS NOT NULL THEN excluded.membership_status ELSE mls_rooms.membership_status END,
         confirmed_transcript_hash = COALESCE(excluded.confirmed_transcript_hash, mls_rooms.confirmed_transcript_hash),
         last_error                = COALESCE(excluded.last_error, mls_rooms.last_error),
         joined_at                 = COALESCE(excluded.joined_at, mls_rooms.joined_at),
         updated_at                = excluded.updated_at`,
      [
        roomId,
        localClientId ?? null,
        epochParam,
        statusParam,
        confirmedTranscriptHash ?? null,
        lastError ?? null,
        joinedAt ?? null,
        now,
        epochParam,
        statusParam
      ]
    )
  }

  /**
   * Narrow update transitioning an MLS room to 'joined' status.
   * Sets membership_status = 'joined', clears last_error, updates joined_at timestamp if not set,
   * and updates local_client_id, current_epoch, confirmed_transcript_hash when provided.
   *
   * @param {string} roomId - Room identifier.
   * @param {object} [params] - Optional state parameters.
   * @param {string} [params.localClientId] - Client ID within MLS group.
   * @param {number} [params.currentEpoch] - Epoch counter.
   * @param {Uint8Array} [params.confirmedTranscriptHash] - Transcript hash BLOB.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function markJoined(roomId, { localClientId = null, currentEpoch = null, confirmedTranscriptHash = null } = {}) {
    const now = Date.now()
    return db.transaction(async () => {
      const existing = await get(roomId)
      if (!existing) {
        return db.execute(
          `INSERT INTO mls_rooms (room_id, local_client_id, current_epoch, membership_status, confirmed_transcript_hash, last_error, joined_at, updated_at)
           VALUES (?, ?, ?, 'joined', ?, NULL, ?, ?)`,
          [
            roomId,
            localClientId,
            currentEpoch ?? 0,
            confirmedTranscriptHash,
            now,
            now
          ]
        )
      }

      return db.execute(
        `UPDATE mls_rooms
         SET local_client_id           = COALESCE(?, local_client_id),
             current_epoch             = COALESCE(?, current_epoch),
             confirmed_transcript_hash = COALESCE(?, confirmed_transcript_hash),
             membership_status         = 'joined',
             joined_at                 = COALESCE(joined_at, ?),
             last_error                = NULL,
             updated_at                = ?
         WHERE room_id = ?`,
        [localClientId, currentEpoch, confirmedTranscriptHash, now, now, roomId]
      )
    })
  }

  /**
   * Sets MLS room membership_status to 'left'.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function markLeft(roomId) {
    return db.execute(
      `UPDATE mls_rooms SET membership_status = 'left', updated_at = ? WHERE room_id = ?`,
      [Date.now(), roomId]
    )
  }

  /**
   * Sets MLS room membership_status to 'error' and records error message string.
   *
   * @param {string} roomId - Room identifier.
   * @param {string} message - Error description message.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function markError(roomId, message) {
    return db.execute(
      `UPDATE mls_rooms SET membership_status = 'error', last_error = ?, updated_at = ? WHERE room_id = ?`,
      [message, Date.now(), roomId]
    )
  }

  /**
   * Narrow update advancing current_epoch and optionally updating confirmed_transcript_hash.
   *
   * @param {string} roomId - Room identifier.
   * @param {object} params - Advance parameters.
   * @param {number} params.epoch - Epoch number.
   * @param {Uint8Array} [params.confirmedTranscriptHash] - Optional updated transcript hash.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function advanceEpoch(roomId, { epoch, confirmedTranscriptHash = null }) {
    return db.execute(
      `UPDATE mls_rooms
       SET current_epoch = ?,
           confirmed_transcript_hash = COALESCE(?, confirmed_transcript_hash),
           updated_at = ?
       WHERE room_id = ?`,
      [epoch, confirmedTranscriptHash, Date.now(), roomId]
    )
  }

  /**
   * Lists MLS room records with a specific membership status.
   *
   * @param {string} status - Membership status ('pending', 'joined', 'left', 'error').
   * @returns {Promise<Array<object>>} Matching MLS room records.
   */
  async function listByStatus(status) {
    return db.query(
      `SELECT room_id, local_client_id, current_epoch, membership_status, confirmed_transcript_hash, last_error, joined_at, updated_at
       FROM mls_rooms
       WHERE membership_status = ?
       ORDER BY updated_at DESC`,
      [status]
    )
  }

  /**
   * Convenience wrapper listing MLS rooms with membership_status = 'joined'.
   *
   * @returns {Promise<Array<object>>} List of joined MLS rooms.
   */
  async function listJoined() {
    return listByStatus('joined')
  }

  /**
   * Removes MLS room state record for a room ID.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function remove(roomId) {
    return db.execute(
      `DELETE FROM mls_rooms WHERE room_id = ?`,
      [roomId]
    )
  }

  /**
   * Deletes all MLS room records.
   *
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function clearAll() {
    return db.execute(`DELETE FROM mls_rooms`)
  }

  return {
    get,
    upsert,
    markJoined,
    markLeft,
    markError,
    advanceEpoch,
    listByStatus,
    listJoined,
    remove,
    clearAll
  }
}
