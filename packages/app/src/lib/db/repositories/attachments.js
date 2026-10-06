/**
 * Repository for attachments domain operations.
 *
 * @module @atoll/app/lib/db/repositories/attachments
 */

/**
 * Creates an attachments repository instance.
 *
 * @param {object} params - Repository dependencies.
 * @param {object} params.db - Database handle created via storage factory.
 * @returns {object} The attachments repository API.
 */
export function createAttachmentsRepository({ db }) {
  /**
   * Retrieves a single attachment metadata row by file ID.
   *
   * @param {string} fileId - The SHA-256 of the padded ciphertext (base64url).
   * @returns {Promise<object | undefined>} Attachment row or undefined if not found.
   */
  async function get(fileId) {
    const row = await db.queryOne(
      `SELECT file_id, room_id, purpose, content_type, plaintext_size, encrypted_size,
              thumbnail_file_id, duration_ms, uploaded_at, downloaded_at, cached_at
       FROM attachments
       WHERE file_id = ?`,
      [fileId]
    )
    return row ?? undefined
  }

  /**
   * Inserts or partially updates an attachment row.
   *
   * @param {object} params - Attachment fields.
   * @param {string} params.fileId - Primary identifier (SHA-256 ciphertext hash).
   * @param {string | null} [params.roomId=null] - Scoped room ID, if applicable.
   * @param {string} params.purpose - Purpose identifier ("message", "room-avatar", etc.).
   * @param {string | null} [params.contentType=null] - Plaintext MIME type.
   * @param {number | null} [params.plaintextSize=null] - Plaintext size in bytes.
   * @param {number | null} [params.encryptedSize=null] - Ciphertext size in bytes.
   * @param {string | null} [params.thumbnailFileId=null] - Associated thumbnail file ID.
   * @param {number | null} [params.durationMs=null] - Media duration in milliseconds.
   * @param {number | null} [params.uploadedAt=null] - Upload timestamp in ms.
   * @param {number | null} [params.downloadedAt=null] - Download timestamp in ms.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function upsert({
    fileId,
    roomId = null,
    purpose,
    contentType = null,
    plaintextSize = null,
    encryptedSize = null,
    thumbnailFileId = null,
    durationMs = null,
    uploadedAt = null,
    downloadedAt = null
  }) {
    const cachedAt = Date.now()
    return db.execute(
      `INSERT INTO attachments (
        file_id, room_id, purpose, content_type, plaintext_size, encrypted_size,
        thumbnail_file_id, duration_ms, uploaded_at, downloaded_at, cached_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET
        room_id           = COALESCE(excluded.room_id, attachments.room_id),
        purpose           = COALESCE(excluded.purpose, attachments.purpose),
        content_type      = COALESCE(excluded.content_type, attachments.content_type),
        plaintext_size    = COALESCE(excluded.plaintext_size, attachments.plaintext_size),
        encrypted_size    = COALESCE(excluded.encrypted_size, attachments.encrypted_size),
        thumbnail_file_id = COALESCE(excluded.thumbnail_file_id, attachments.thumbnail_file_id),
        duration_ms       = COALESCE(excluded.duration_ms, attachments.duration_ms),
        uploaded_at       = COALESCE(excluded.uploaded_at, attachments.uploaded_at),
        downloaded_at     = COALESCE(excluded.downloaded_at, attachments.downloaded_at),
        cached_at         = excluded.cached_at`,
      [
        fileId,
        roomId,
        purpose,
        contentType,
        plaintextSize,
        encryptedSize,
        thumbnailFileId,
        durationMs,
        uploadedAt,
        downloadedAt,
        cachedAt
      ]
    )
  }

  /**
   * Sets the uploaded timestamp and optionally updates encrypted size.
   *
   * @param {string} fileId - Attachment file identifier.
   * @param {object} [options={}] - Options.
   * @param {number} [options.encryptedSize] - Updated encrypted size in bytes.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function markUploaded(fileId, { encryptedSize = null } = {}) {
    const now = Date.now()
    return db.execute(
      `UPDATE attachments
       SET uploaded_at = ?, encrypted_size = COALESCE(?, encrypted_size), cached_at = ?
       WHERE file_id = ?`,
      [now, encryptedSize, now, fileId]
    )
  }

  /**
   * Sets the downloaded timestamp.
   *
   * @param {string} fileId - Attachment file identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function markDownloaded(fileId) {
    const now = Date.now()
    return db.execute(
      `UPDATE attachments
       SET downloaded_at = ?, cached_at = ?
       WHERE file_id = ?`,
      [now, now, fileId]
    )
  }

  /**
   * Retrieves metadata rows for a list of file IDs.
   *
   * @param {string[]} fileIds - List of file IDs.
   * @returns {Promise<object[]>} Array of found attachment rows.
   */
  async function getMany(fileIds) {
    if (!fileIds || fileIds.length === 0) {
      return []
    }
    const placeholders = fileIds.map(() => '?').join(', ')
    const sql = `SELECT file_id, room_id, purpose, content_type, plaintext_size, encrypted_size,
                        thumbnail_file_id, duration_ms, uploaded_at, downloaded_at, cached_at
                 FROM attachments
                 WHERE file_id IN (${placeholders})`
    return db.query(sql, fileIds)
  }

  /**
   * Lists attachments scoped to a room, ordered by cached_at DESC.
   *
   * @param {string} roomId - Scoped room ID.
   * @param {object} [options={}] - Pagination options.
   * @param {number} [options.limit=100] - Max items to return.
   * @param {number} [options.cursor] - Cursor timestamp (cached_at < cursor).
   * @returns {Promise<object[]>} Array of attachment rows.
   */
  async function listByRoom(roomId, { limit = 100, cursor } = {}) {
    if (cursor !== undefined && cursor !== null) {
      return db.query(
        `SELECT file_id, room_id, purpose, content_type, plaintext_size, encrypted_size,
                thumbnail_file_id, duration_ms, uploaded_at, downloaded_at, cached_at
         FROM attachments
         WHERE room_id = ? AND cached_at < ?
         ORDER BY cached_at DESC
         LIMIT ?`,
        [roomId, cursor, limit]
      )
    }
    return db.query(
      `SELECT file_id, room_id, purpose, content_type, plaintext_size, encrypted_size,
              thumbnail_file_id, duration_ms, uploaded_at, downloaded_at, cached_at
       FROM attachments
       WHERE room_id = ?
       ORDER BY cached_at DESC
       LIMIT ?`,
      [roomId, limit]
    )
  }

  /**
   * Lists attachments matching a given purpose, ordered by cached_at DESC.
   *
   * @param {string} purpose - Attachment purpose ("message", "user-avatar", etc.).
   * @param {object} [options={}] - Pagination options.
   * @param {number} [options.limit=100] - Max items to return.
   * @param {number} [options.cursor] - Cursor timestamp (cached_at < cursor).
   * @returns {Promise<object[]>} Array of attachment rows.
   */
  async function listByPurpose(purpose, { limit = 100, cursor } = {}) {
    if (cursor !== undefined && cursor !== null) {
      return db.query(
        `SELECT file_id, room_id, purpose, content_type, plaintext_size, encrypted_size,
                thumbnail_file_id, duration_ms, uploaded_at, downloaded_at, cached_at
         FROM attachments
         WHERE purpose = ? AND cached_at < ?
         ORDER BY cached_at DESC
         LIMIT ?`,
        [purpose, cursor, limit]
      )
    }
    return db.query(
      `SELECT file_id, room_id, purpose, content_type, plaintext_size, encrypted_size,
              thumbnail_file_id, duration_ms, uploaded_at, downloaded_at, cached_at
       FROM attachments
       WHERE purpose = ?
       ORDER BY cached_at DESC
       LIMIT ?`,
      [purpose, limit]
    )
  }

  /**
   * Deletes an attachment metadata row.
   *
   * @param {string} fileId - Attachment file identifier.
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function remove(fileId) {
    return db.execute('DELETE FROM attachments WHERE file_id = ?', [fileId])
  }

  /**
   * Counts total attachments in a room.
   *
   * @param {string} roomId - Scoped room ID.
   * @returns {Promise<number>} Count of attachments.
   */
  async function countByRoom(roomId) {
    const row = await db.queryOne(
      'SELECT COUNT(*) AS c FROM attachments WHERE room_id = ?',
      [roomId]
    )
    return row ? Number(row.c) : 0
  }

  /**
   * Deletes all attachment rows.
   *
   * @returns {Promise<{ changes: number }>} Execution summary.
   */
  async function clearAll() {
    return db.execute('DELETE FROM attachments')
  }

  return {
    get,
    upsert,
    markUploaded,
    markDownloaded,
    getMany,
    listByRoom,
    listByPurpose,
    remove,
    countByRoom,
    clearAll
  }
}
