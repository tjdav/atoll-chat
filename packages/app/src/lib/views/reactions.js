/**
 * Default emoji reaction choices for the horizontal picker row.
 * @type {readonly string[]}
 */
export const DEFAULT_EMOJI = Object.freeze(['👍', '❤️', '😂', '😮', '😢', '🎉'])

/**
 * Checks whether a message can receive reactions.
 *
 * @param {object|null|undefined} message - Message row object from repository
 * @returns {boolean} True if message exists and is not tombstoned
 */
export function isReactionAllowed(message) {
  if (!message) return false
  return !message.deleted_at
}

/**
 * Toggles a user's reaction on a message.
 *
 * @param {object} params
 * @param {object} params.repos - Repository aggregator object containing `reactions`
 * @param {string} params.messageId - Target message ID
 * @param {string} params.userId - Reacting user ID
 * @param {string} params.clientId - Reacting client device ID
 * @param {string} params.reaction - Emoji character string
 * @returns {Promise<{ reacted: boolean }>} Object indicating whether reaction was added (true) or removed (false)
 */
export async function toggleReaction({ repos, messageId, userId, clientId, reaction }) {
  const hasReacted = await repos.reactions.hasReacted(messageId, userId, reaction)

  if (hasReacted) {
    const rows = (await repos.reactions.listForMessage(messageId)) || []
    const ownRow = rows.find((r) => r.sender_user_id === userId && r.reaction === reaction && !r.deleted_at)
    if (ownRow) {
      await repos.reactions.remove({
        messageId,
        senderUserId: userId,
        senderClientId: ownRow.sender_client_id,
        reaction
      })
    }
    return { reacted: false }
  }

  await repos.reactions.add({
    messageId,
    senderUserId: userId,
    senderClientId: clientId,
    reaction,
    createdAt: Date.now()
  })

  return { reacted: true }
}
