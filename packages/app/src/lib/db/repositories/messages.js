/**
 * Repository for messages and message_versions domain operations.
 *
 * @module @atoll/app/lib/db/repositories/messages
 */

/**
 * Creates a messages repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The messages repository API.
 */
export function createMessagesRepository({ db }) {
  /**
   * Retrieves a single message by ID.
   *
   * @param {string} messageId - Server or local message identifier.
   * @returns {Promise<object | undefined>} Message row or undefined if not found.
   */
  async function get(messageId) {
    const row = await db.queryOne(
      `SELECT message_id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type,
              ciphertext, decrypted_payload, reply_to, edited_at, deleted_at, expires_at,
              local_status, local_error, created_at, updated_at
       FROM messages
       WHERE message_id = ?`,
      [messageId]
    )
    return row ?? undefined
  }

  /**
   * Inserts or updates a base message row using partial upsert semantics.
   *
   * @param {object} params - Message fields.
   * @param {string} params.messageId - Message identifier.
   * @param {string} [params.roomId] - Room identifier.
   * @param {string} [params.senderUserId] - Sender user identifier.
   * @param {string} [params.senderClientId] - Sender client device identifier.
   * @param {number} [params.epoch] - MLS epoch number.
   * @param {number} [params.seq] - MLS sequence number within epoch.
   * @param {string} [params.contentType] - Content type ('application' | 'commit' | 'proposal').
   * @param {Uint8Array | ArrayBuffer | string} [params.ciphertext] - Encrypted message ciphertext.
   * @param {string | null} [params.decryptedPayload] - Decrypted plaintext JSON string.
   * @param {string | null} [params.replyTo] - ID of replied-to message.
   * @param {number | null} [params.editedAt] - Timestamp of latest edit in ms.
   * @param {number | null} [params.deletedAt] - Timestamp of deletion/tombstone in ms.
   * @param {number | null} [params.expiresAt] - Timestamp for disappearing message expiration in ms.
   * @param {string} [params.localStatus='sent'] - Local sending status ('pending' | 'sending' | 'sent' | 'failed').
   * @param {string | null} [params.localError] - Error message if sending failed.
   * @param {number} [params.createdAt] - Creation timestamp in ms.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function upsert({
    messageId,
    roomId = null,
    senderUserId = null,
    senderClientId = null,
    epoch = null,
    seq = null,
    contentType = null,
    ciphertext = null,
    decryptedPayload = null,
    replyTo = null,
    editedAt = null,
    deletedAt = null,
    expiresAt = null,
    localStatus = null,
    localError = null,
    createdAt = null
  }) {
    const existing = await get(messageId)
    const now = Date.now()

    const finalRoomId = roomId ?? existing?.room_id ?? null
    const finalSenderUserId = senderUserId ?? existing?.sender_user_id ?? null
    const finalSenderClientId = senderClientId ?? existing?.sender_client_id ?? null
    const finalEpoch = epoch ?? existing?.epoch ?? null
    const finalSeq = seq ?? existing?.seq ?? null
    const finalContentType = contentType ?? existing?.content_type ?? null
    const finalCiphertext = ciphertext ?? existing?.ciphertext ?? null
    const finalDecryptedPayload = decryptedPayload ?? existing?.decrypted_payload ?? null
    const finalReplyTo = replyTo ?? existing?.reply_to ?? null
    const finalEditedAt = editedAt ?? existing?.edited_at ?? null
    const finalDeletedAt = deletedAt ?? existing?.deleted_at ?? null
    const finalExpiresAt = expiresAt ?? existing?.expires_at ?? null
    const finalLocalStatus = localStatus ?? existing?.local_status ?? 'sent'
    const finalLocalError = localError !== undefined ? localError : (existing?.local_error ?? null)
    const finalCreatedAt = createdAt ?? existing?.created_at ?? now

    return db.execute(
      `INSERT INTO messages (
        message_id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type,
        ciphertext, decrypted_payload, reply_to, edited_at, deleted_at, expires_at,
        local_status, local_error, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        room_id           = COALESCE(excluded.room_id, messages.room_id),
        sender_user_id    = COALESCE(excluded.sender_user_id, messages.sender_user_id),
        sender_client_id  = COALESCE(excluded.sender_client_id, messages.sender_client_id),
        epoch             = COALESCE(excluded.epoch, messages.epoch),
        seq               = COALESCE(excluded.seq, messages.seq),
        content_type      = COALESCE(excluded.content_type, messages.content_type),
        ciphertext        = COALESCE(excluded.ciphertext, messages.ciphertext),
        decrypted_payload = COALESCE(excluded.decrypted_payload, messages.decrypted_payload),
        reply_to          = COALESCE(excluded.reply_to, messages.reply_to),
        edited_at         = COALESCE(excluded.edited_at, messages.edited_at),
        deleted_at        = COALESCE(excluded.deleted_at, messages.deleted_at),
        expires_at        = COALESCE(excluded.expires_at, messages.expires_at),
        local_status      = COALESCE(excluded.local_status, messages.local_status),
        local_error       = COALESCE(excluded.local_error, messages.local_error),
        created_at        = COALESCE(excluded.created_at, messages.created_at),
        updated_at        = excluded.updated_at`,
      [
        messageId,
        finalRoomId,
        finalSenderUserId,
        finalSenderClientId,
        finalEpoch,
        finalSeq,
        finalContentType,
        finalCiphertext,
        finalDecryptedPayload,
        finalReplyTo,
        finalEditedAt,
        finalDeletedAt,
        finalExpiresAt,
        finalLocalStatus,
        finalLocalError,
        finalCreatedAt,
        now
      ]
    )
  }

  /**
   * Fast-path update for local sending state fields.
   *
   * @param {string} messageId - Message identifier.
   * @param {string} status - New local status ('pending' | 'sending' | 'sent' | 'failed').
   * @param {object} [options] - Additional options.
   * @param {string | null} [options.error=null] - Error message if status is failed.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function updateLocalStatus(messageId, status, { error = null } = {}) {
    const now = Date.now()
    return db.execute(
      `UPDATE messages SET local_status = ?, local_error = ?, updated_at = ? WHERE message_id = ?`,
      [status, error, now, messageId]
    )
  }

  /**
   * Soft-deletes a message by recording a deletion timestamp.
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function markDeleted(messageId) {
    const now = Date.now()
    return db.execute(
      `UPDATE messages SET deleted_at = ?, updated_at = ? WHERE message_id = ?`,
      [now, now, messageId]
    )
  }

  /**
   * Permanently removes a message and all associated versions in a transaction.
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function remove(messageId) {
    return db.transaction(async () => {
      await db.execute('DELETE FROM message_versions WHERE message_id = ?', [messageId])
      return db.execute('DELETE FROM messages WHERE message_id = ?', [messageId])
    })
  }

  /**
   * Permanently removes all expired messages and their versions in a transaction.
   *
   * @returns {Promise<{ changes: number }>} Execution result summary with total deleted message count.
   */
  async function removeExpired() {
    const now = Date.now()
    return db.transaction(async () => {
      const rows = await db.query(
        'SELECT message_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?',
        [now]
      )
      let removed = 0
      for (const row of rows) {
        await db.execute('DELETE FROM message_versions WHERE message_id = ?', [row.message_id])
        const r = await db.execute('DELETE FROM messages WHERE message_id = ?', [row.message_id])
        removed += r.changes
      }
      return { changes: removed }
    })
  }

  /**
   * Permanently removes all messages and versions for a given room in a transaction.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function removeAllInRoom(roomId) {
    return db.transaction(async () => {
      await db.execute(
        'DELETE FROM message_versions WHERE message_id IN (SELECT message_id FROM messages WHERE room_id = ?)',
        [roomId]
      )
      return db.execute('DELETE FROM messages WHERE room_id = ?', [roomId])
    })
  }

  /**
   * Lists messages in a room ordered by epoch DESC, seq DESC.
   *
   * @param {string} roomId - Room identifier.
   * @param {object} [options] - Pagination options.
   * @param {number} [options.limit=50] - Page size limit.
   * @param {{ epoch: number, seq: number }} [options.cursor] - Cursor for pagination.
   * @returns {Promise<Array<object>>} Array of message rows.
   */
  async function listInRoom(roomId, { limit = 50, cursor } = {}) {
    if (cursor && typeof cursor === 'object') {
      return db.query(
        `SELECT message_id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type,
                ciphertext, decrypted_payload, reply_to, edited_at, deleted_at, expires_at,
                local_status, local_error, created_at, updated_at
         FROM messages
         WHERE room_id = ?
           AND (epoch < ? OR (epoch = ? AND seq < ?))
         ORDER BY epoch DESC, seq DESC
         LIMIT ?`,
        [roomId, cursor.epoch, cursor.epoch, cursor.seq, limit]
      )
    }

    return db.query(
      `SELECT message_id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type,
              ciphertext, decrypted_payload, reply_to, edited_at, deleted_at, expires_at,
              local_status, local_error, created_at, updated_at
       FROM messages
       WHERE room_id = ?
       ORDER BY epoch DESC, seq DESC
       LIMIT ?`,
      [roomId, limit]
    )
  }

  /**
   * Lists application messages in a room (excluding protocol commit/proposal messages)
   * ordered by epoch DESC, seq DESC.
   *
   * @param {string} roomId - Room identifier.
   * @param {object} [options] - Pagination options.
   * @param {number} [options.limit=50] - Page size limit.
   * @param {{ epoch: number, seq: number }} [options.cursor] - Cursor for pagination.
   * @returns {Promise<Array<object>>} Array of message rows.
   */
  async function listApplicationsInRoom(roomId, { limit = 50, cursor } = {}) {
    if (cursor && typeof cursor === 'object') {
      return db.query(
        `SELECT message_id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type,
                ciphertext, decrypted_payload, reply_to, edited_at, deleted_at, expires_at,
                local_status, local_error, created_at, updated_at
         FROM messages
         WHERE room_id = ?
           AND content_type = 'application'
           AND (epoch < ? OR (epoch = ? AND seq < ?))
         ORDER BY epoch DESC, seq DESC
         LIMIT ?`,
        [roomId, cursor.epoch, cursor.epoch, cursor.seq, limit]
      )
    }

    return db.query(
      `SELECT message_id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type,
              ciphertext, decrypted_payload, reply_to, edited_at, deleted_at, expires_at,
              local_status, local_error, created_at, updated_at
       FROM messages
       WHERE room_id = ?
         AND content_type = 'application'
       ORDER BY epoch DESC, seq DESC
       LIMIT ?`,
      [roomId, limit]
    )
  }

  /**
   * Counts total messages in a room.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<number>} Message count.
   */
  async function countInRoom(roomId) {
    const row = await db.queryOne('SELECT COUNT(*) AS c FROM messages WHERE room_id = ?', [roomId])
    return row ? Number(row.c) : 0
  }

  /**
   * Counts application messages in a room.
   *
   * @param {string} roomId - Room identifier.
   * @returns {Promise<number>} Application message count.
   */
  async function countApplicationsInRoom(roomId) {
    const row = await db.queryOne(
      "SELECT COUNT(*) AS c FROM messages WHERE room_id = ? AND content_type = 'application'",
      [roomId]
    )
    return row ? Number(row.c) : 0
  }

  /**
   * Inserts or overwrites a message version row.
   *
   * @param {object} params - Version details.
   * @param {string} params.messageId - Base message identifier.
   * @param {number} params.editSequence - Edit sequence number (0 for original, 1+ for edits).
   * @param {Uint8Array | ArrayBuffer | string} params.ciphertext - Encrypted ciphertext for version.
   * @param {string | null} [params.decryptedPayload=null] - Decrypted plaintext JSON string.
   * @param {number} params.editedAt - Timestamp when version was produced in ms.
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function upsertVersion({
    messageId,
    editSequence,
    ciphertext,
    decryptedPayload = null,
    editedAt
  }) {
    return db.execute(
      `INSERT OR REPLACE INTO message_versions
         (message_id, edit_sequence, ciphertext, decrypted_payload, edited_at)
       VALUES (?, ?, ?, ?, ?)`,
      [messageId, editSequence, ciphertext, decryptedPayload, editedAt]
    )
  }

  /**
   * Lists all version history rows for a message ordered by edit_sequence ASC.
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<Array<object>>} Array of version rows.
   */
  async function listVersions(messageId) {
    return db.query(
      `SELECT message_id, edit_sequence, ciphertext, decrypted_payload, edited_at
       FROM message_versions
       WHERE message_id = ?
       ORDER BY edit_sequence ASC`,
      [messageId]
    )
  }

  /**
   * Retrieves a specific version row for a message.
   *
   * @param {string} messageId - Message identifier.
   * @param {number} editSequence - Edit sequence number.
   * @returns {Promise<object | undefined>} Version row or undefined if not found.
   */
  async function getVersion(messageId, editSequence) {
    const row = await db.queryOne(
      `SELECT message_id, edit_sequence, ciphertext, decrypted_payload, edited_at
       FROM message_versions
       WHERE message_id = ? AND edit_sequence = ?`,
      [messageId, editSequence]
    )
    return row ?? undefined
  }

  /**
   * Counts version history rows for a message.
   *
   * @param {string} messageId - Message identifier.
   * @returns {Promise<number>} Version count.
   */
  async function countVersions(messageId) {
    const row = await db.queryOne(
      'SELECT COUNT(*) AS c FROM message_versions WHERE message_id = ?',
      [messageId]
    )
    return row ? Number(row.c) : 0
  }

  /**
   * Deletes all rows from both messages and message_versions in a transaction.
   *
   * @returns {Promise<{ changes: number }>} Execution result summary.
   */
  async function clearAll() {
    return db.transaction(async () => {
      await db.execute('DELETE FROM message_versions', [])
      return db.execute('DELETE FROM messages', [])
    })
  }

  return {
    get,
    upsert,
    updateLocalStatus,
    markDeleted,
    remove,
    removeExpired,
    removeAllInRoom,
    listInRoom,
    listApplicationsInRoom,
    countInRoom,
    countApplicationsInRoom,
    upsertVersion,
    listVersions,
    getVersion,
    countVersions,
    clearAll
  }
}
