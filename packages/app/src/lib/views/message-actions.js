/**
 * @fileoverview Pure orchestration helpers for message context menu actions.
 */

/**
 * Copies a message's text content to the clipboard.
 *
 * @param {Object} params
 * @param {Object} params.deps Dependencies object.
 * @param {Object} params.deps.repos Storage repositories aggregator.
 * @param {Object} params.deps.clipboard Clipboard API wrapper (e.g. navigator.clipboard).
 * @param {Function} params.deps.parsePayload Function parsing JSON message payload.
 * @param {Function} params.deps.summarizePayload Function producing payload summary object.
 * @param {string} params.messageId ID of the message to copy.
 * @returns {Promise<{ copied: boolean, reason?: string }>}
 */
export async function copyMessage({ deps, messageId }) {
  const message = await deps.repos.messages.get(messageId)
  if (!message) return { copied: false, reason: 'not-found' }
  const payload = deps.parsePayload(message.decrypted_payload)
  const summary = deps.summarizePayload(payload)
  const text = summary.kind === 'text' ? summary.text : ''
  if (!text) return { copied: false, reason: 'not-text' }
  await deps.clipboard.writeText(text)
  return { copied: true }
}

/**
 * Deletes a message locally for the current user.
 *
 * @param {Object} params
 * @param {Object} params.deps Dependencies object.
 * @param {Object} params.deps.repos Storage repositories aggregator.
 * @param {string} params.messageId ID of the message to delete locally.
 * @returns {Promise<{ removed: boolean }>}
 */
export async function deleteForMe({ deps, messageId }) {
  const result = await deps.repos.messages.remove(messageId)
  return { removed: result.changes > 0 }
}

/**
 * Unsends a message for all room members if eligible within the 24h window.
 *
 * @param {Object} params
 * @param {Object} params.deps Dependencies object.
 * @param {Object} params.deps.repos Storage repositories aggregator.
 * @param {string} params.messageId ID of the message to unsend.
 * @param {string} params.userId ID of the requesting user.
 * @returns {Promise<{ unsent: boolean, reason?: string }>}
 */
export async function unsend({ deps, messageId, userId }) {
  const message = await deps.repos.messages.get(messageId)
  if (!message) return { unsent: false, reason: 'not-found' }
  if (message.sender_user_id !== userId) return { unsent: false, reason: 'not-sender' }
  if (message.local_status !== 'sent') return { unsent: false, reason: 'not-sent' }
  const windowMs = 24 * 60 * 60 * 1000
  if (Date.now() - message.created_at > windowMs) {
    return { unsent: false, reason: 'window-expired' }
  }
  const result = await deps.repos.messages.markDeleted(messageId)
  return { unsent: result.changes > 0 }
}

/**
 * Determines whether unsend is available for a message.
 *
 * @param {Object|null|undefined} message Message object from storage.
 * @param {string} userId ID of the requesting user.
 * @returns {boolean} True if unsend is available.
 */
export function isUnsendAvailable(message, userId) {
  if (!message) return false
  if (message.sender_user_id !== userId) return false
  if (message.local_status !== 'sent') return false
  const windowMs = 24 * 60 * 60 * 1000
  return Date.now() - message.created_at <= windowMs
}
