/**
 * Message edit orchestration pure helpers.
 */

/**
 * Checks if a message is available to be edited by a given user.
 *
 * @param {object|null|undefined} message - Message record from DB.
 * @param {string} userId - Current user ID.
 * @param {object} [options]
 * @param {number} [options.windowMs=900000] - Edit window in milliseconds (default 15 minutes).
 * @param {number} [options.now=Date.now()] - Timestamp to evaluate window against.
 * @returns {boolean} True if message can be edited.
 */
export function isEditAvailable(message, userId, { windowMs = 15 * 60 * 1000, now = Date.now() } = {}) {
  if (!message) return false
  if (message.sender_user_id !== userId) return false
  if (message.deleted_at) return false
  if (message.local_status !== 'sent') return false
  return now - message.created_at <= windowMs
}

/**
 * Executes a local edit on a message.
 *
 * @param {object} params
 * @param {object} params.deps - Injected dependencies (repos, buildTextPayload, encodePayload, encodeCiphertextStub).
 * @param {string} params.messageId - Message ID to edit.
 * @param {string} params.newText - New text content.
 * @param {string} params.userId - User ID attempting the edit.
 * @param {number} [params.now=Date.now()] - Timestamp for the edit.
 * @returns {Promise<{ edited: boolean, reason?: string, editSequence?: number }>}
 */
export async function editMessage({ deps, messageId, newText, userId, now = Date.now() }) {
  const message = await deps.repos.messages.get(messageId)
  if (!message) return { edited: false, reason: 'not-found' }

  if (!isEditAvailable(message, userId, { now })) {
    return { edited: false, reason: 'not-editable' }
  }

  const payload = deps.buildTextPayload(newText)
  if (!payload) return { edited: false, reason: 'empty' }

  const versions = await deps.repos.messages.listVersions(messageId)

  if (versions.length === 0) {
    await deps.repos.messages.upsertVersion({
      messageId,
      editSequence: 0,
      ciphertext: message.ciphertext,
      decryptedPayload: message.decrypted_payload,
      editedAt: message.created_at
    })
  }

  let maxSeq = 0
  if (versions.length > 0) {
    for (const v of versions) {
      if (v.edit_sequence > maxSeq) maxSeq = v.edit_sequence
    }
  }
  const nextSeq = maxSeq + 1

  const decryptedPayload = JSON.stringify(payload)
  const encodedPayload = deps.encodePayload(payload)
  const ciphertext = deps.encodeCiphertextStub(encodedPayload)

  await deps.repos.messages.upsertVersion({
    messageId,
    editSequence: nextSeq,
    ciphertext,
    decryptedPayload,
    editedAt: now
  })

  await deps.repos.messages.upsert({
    ...message,
    ciphertext,
    decrypted_payload: decryptedPayload,
    edited_at: now,
    updated_at: now
  })

  return { edited: true, editSequence: nextSeq }
}
