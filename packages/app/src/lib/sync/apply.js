/**
 * Row-application helpers for user-scoped sync.
 * Pure functions with no direct network calls or local storage of their own.
 *
 * @module @atoll/app/lib/sync/apply
 */

/**
 * Applies read state rows from sync response.
 *
 * @param {object} params - Input parameters.
 * @param {object} params.repos - Repository aggregator.
 * @param {string} params.userId - Local user identifier.
 * @param {Array<object>} params.rows - Raw read_state rows from server.
 * @returns {Promise<{ applied: number }>} Result summary count.
 */
export async function applyReadState({ repos, userId, rows }) {
  let applied = 0
  for (const row of rows) {
    if (row.deleted_at) continue
    await repos.readState.upsert({
      userId,
      roomId: row.room_id,
      lastReadMessageId: row.last_read_message_id
    })
    applied += 1
  }
  return { applied }
}

/**
 * Applies device state rows from sync response.
 *
 * @param {object} params - Input parameters.
 * @param {object} params.repos - Repository aggregator.
 * @param {string} params.userId - Local user identifier.
 * @param {Array<object>} params.rows - Raw device_state rows from server.
 * @returns {Promise<{ applied: number, skipped: number }>} Result summary counts.
 */
export async function applyDeviceState({ repos, userId, rows }) {
  const mapped = rows.map((row) => ({
    deviceId: row.device_id,
    encryptedDeviceName: row.encrypted_device_name,
    userSeq: row.user_seq,
    deletedAt: row.deleted_at
      ? (typeof row.deleted_at === 'number' ? row.deleted_at : (Date.parse(row.deleted_at) || Date.now()))
      : null
  }))

  if (mapped.length === 0) {
    return { applied: 0, skipped: 0 }
  }

  return repos.deviceNames.applyBatch(userId, mapped)
}

/**
 * Applies starred items rows from sync response.
 *
 * @param {object} params - Input parameters.
 * @param {object} params.repos - Repository aggregator.
 * @param {string} params.userId - Local user identifier.
 * @param {Array<object>} params.rows - Raw starred_items rows from server.
 * @returns {Promise<{ applied: number, skipped: number }>} Result summary counts.
 */
export async function applyStarredItems({ repos, userId, rows }) {
  const mapped = rows.map((row) => ({
    itemId: row.item_id,
    itemType: row.item_type,
    roomId: row.room_id,
    userSeq: row.user_seq,
    starredAt: typeof row.starred_at === 'number' ? row.starred_at : Date.parse(row.starred_at),
    deletedAt: row.deleted_at
      ? (typeof row.deleted_at === 'number' ? row.deleted_at : (Date.parse(row.deleted_at) || Date.now()))
      : null
  }))

  if (mapped.length === 0) {
    return { applied: 0, skipped: 0 }
  }

  return repos.starredItems.applyBatch(userId, mapped)
}
