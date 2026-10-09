import {
  buildTextPayload,
  encodePayload,
  encodeCiphertextStub,
  generateLocalMessageId,
  computeNextSeq
} from '../composer/index.js'

/**
 * Orchestrates creating and storing a local application message, enqueuing it in the outbox,
 * and advancing the sender's local read state.
 *
 * @param {object} options
 * @param {object} options.deps Dependencies container
 * @param {object} options.deps.repos Storage repository aggregator from storage.repos()
 * @param {object} options.deps.storage Storage plugin client context
 * @param {object} options.deps.globalStore State plugin client context containing currentUser
 * @param {Crypto} options.deps.crypto Global Crypto instance
 * @param {string} options.roomId Target room identifier
 * @param {string} options.text Raw message input text
 * @returns {Promise<{ skipped: boolean, reason?: string, messageId?: string, message?: object }>}
 */
export async function sendMessage({ deps, roomId, text, replyTo = null }) {
  const payload = buildTextPayload(text)
  if (!payload) {
    return { skipped: true, reason: 'empty' }
  }

  const userId = deps.globalStore?.$state?.user?.id ?? deps.globalStore?.$state?.currentUser?.id ?? (deps.globalStore ? null : 'u_me')
  if (!userId) {
    return { skipped: true, reason: 'no-user' }
  }

  let clientId = await deps.storage.meta.get('client_id')
  if (!clientId) {
    clientId = generateLocalMessageId(deps.crypto)
    await deps.storage.meta.set('client_id', clientId)
  }

  const newestFirst = await deps.repos.messages.listApplicationsInRoom(roomId, { limit: 1 })
  const { epoch, seq } = computeNextSeq(newestFirst)

  const messageId = generateLocalMessageId(deps.crypto)
  const now = Date.now()
  const decryptedPayload = encodePayload(payload)
  const ciphertext = encodeCiphertextStub(payload)

  const message = {
    messageId,
    roomId,
    senderUserId: userId,
    senderClientId: clientId,
    epoch,
    seq,
    contentType: 'application',
    ciphertext,
    decryptedPayload,
    replyTo,
    editedAt: null,
    deletedAt: null,
    expiresAt: null,
    localStatus: 'pending',
    localError: null,
    createdAt: now,
    updatedAt: now
  }

  await deps.repos.messages.upsert(message)
  await deps.repos.outbox.enqueue({ messageId, roomId })
  await deps.repos.readState.upsert({
    userId,
    roomId,
    lastReadMessageId: messageId,
    lastReadAt: now
  })

  return { skipped: false, messageId, message }
}
