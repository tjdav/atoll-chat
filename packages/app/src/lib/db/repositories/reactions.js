/**
 * Repository for reactions domain operations.
 *
 * @module @atoll/app/lib/db/repositories/reactions
 */

/**
 * Creates a reactions repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The reactions repository API.
 */
export function createReactionsRepository({ db }) {
  /**
   * Lists all active reactions for a single message.
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<object[]>} Array of active reaction rows.
   */
  async function listForMessage(messageId) {
    return db.query(
      `SELECT message_id, sender_user_id, sender_client_id, reaction, created_at
       FROM reactions
       WHERE message_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [messageId]
    )
  }

  /**
   * Lists all active reactions for every message in a room.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<object[]>} Array of active reaction rows with message_id.
   */
  async function listForRoom(roomId) {
    return db.query(
      `SELECT r.message_id, r.sender_user_id, r.sender_client_id, r.reaction, r.created_at
       FROM reactions r
       INNER JOIN messages m ON m.message_id = r.message_id
       WHERE m.room_id = ? AND r.deleted_at IS NULL
       ORDER BY r.created_at ASC`,
      [roomId]
    )
  }

  /**
   * Retrieves a specific reaction row by its four-tuple primary key.
   *
   * @param {string} messageId - Message identifier.
   * @param {string} senderUserId - User ID who reacted.
   * @param {string} senderClientId - Client/device ID that issued the reaction.
   * @param {string} reaction - Emoji or sticker file ID string.
   * @returns {Promise<object | undefined>} Reaction row or undefined if not found.
   */
  async function get(messageId, senderUserId, senderClientId, reaction) {
    const row = await db.queryOne(
      `SELECT message_id, sender_user_id, sender_client_id, reaction, created_at, deleted_at
       FROM reactions
       WHERE message_id = ? AND sender_user_id = ? AND sender_client_id = ? AND reaction = ?`,
      [messageId, senderUserId, senderClientId, reaction]
    )
    return row ?? undefined
  }

  /**
   * Inserts a new reaction or reactivates a soft-deleted reaction.
   *
   * @param {object} params - Reaction fields.
   * @param {string} params.messageId - Message identifier.
   * @param {string} params.senderUserId - User ID who reacted.
   * @param {string} params.senderClientId - Client/device ID that issued the reaction.
   * @param {string} params.reaction - Emoji character or sticker file ID.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function add({ messageId, senderUserId, senderClientId, reaction }) {
    const createdAt = Date.now()
    return db.execute(
      `INSERT INTO reactions (message_id, sender_user_id, sender_client_id, reaction, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(message_id, sender_user_id, sender_client_id, reaction) DO UPDATE SET
         deleted_at = NULL,
         created_at = excluded.created_at`,
      [messageId, senderUserId, senderClientId, reaction, createdAt]
    )
  }

  /**
   * Soft-deletes a reaction by setting deleted_at to current timestamp.
   *
   * @param {object} params - Reaction identifiers.
   * @param {string} params.messageId - Message identifier.
   * @param {string} params.senderUserId - User ID who reacted.
   * @param {string} params.senderClientId - Client/device ID.
   * @param {string} params.reaction - Emoji or sticker string.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function remove({ messageId, senderUserId, senderClientId, reaction }) {
    const now = Date.now()
    return db.execute(
      `UPDATE reactions
       SET deleted_at = ?
       WHERE message_id = ? AND sender_user_id = ? AND sender_client_id = ? AND reaction = ?`,
      [now, messageId, senderUserId, senderClientId, reaction]
    )
  }

  /**
   * Deletes all reaction rows for a message (hard delete on message removal).
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function removeByMessage(messageId) {
    return db.execute('DELETE FROM reactions WHERE message_id = ?', [messageId])
  }

  /**
   * Counts active reactions on a message.
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<number>} Active reactions count.
   */
  async function countForMessage(messageId) {
    const row = await db.queryOne(
      'SELECT COUNT(*) AS c FROM reactions WHERE message_id = ? AND deleted_at IS NULL',
      [messageId]
    )
    return row ? Number(row.c) : 0
  }

  /**
   * Aggregates active reactions per message into user counts.
   *
   * Multi-device reactions from the same user are deduplicated via COUNT(DISTINCT sender_user_id).
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<Array<{ reaction: string, users: number }>>} Aggregated counts.
   */
  async function aggregateForMessage(messageId) {
    const rows = await db.query(
      `SELECT reaction, COUNT(DISTINCT sender_user_id) AS users
       FROM reactions
       WHERE message_id = ? AND deleted_at IS NULL
       GROUP BY reaction
       ORDER BY users DESC, reaction ASC`,
      [messageId]
    )
    return rows.map((r) => ({
      reaction: r.reaction,
      users: Number(r.users)
    }))
  }

  /**
   * Checks whether a specific user has an active reaction on a message across any of their devices.
   *
   * @param {string} messageId - Message identifier.
   * @param {string} userId - User identifier.
   * @param {string} reaction - Emoji or sticker string.
   * @returns {Promise<boolean>} True if active reaction exists, false otherwise.
   */
  async function hasReacted(messageId, userId, reaction) {
    const row = await db.queryOne(
      `SELECT 1 AS present
       FROM reactions
       WHERE message_id = ? AND sender_user_id = ? AND reaction = ? AND deleted_at IS NULL
       LIMIT 1`,
      [messageId, userId, reaction]
    )
    return Boolean(row?.present)
  }

  /**
   * Hard-deletes all reaction rows.
   *
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function clearAll() {
    return db.execute('DELETE FROM reactions')
  }

  return {
    listForMessage,
    listForRoom,
    get,
    add,
    remove,
    removeByMessage,
    countForMessage,
    aggregateForMessage,
    hasReacted,
    clearAll
  }
}
