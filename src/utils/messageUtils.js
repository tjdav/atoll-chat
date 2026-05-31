
/**
 * Utility to send an End-to-End Encrypted (E2EE) message.
 * This function handles Room Key retrieval, causal link (previous_msg_uuid) management,
 * payload construction, Libsodium encryption, and Ed25519 signing.
 */
export async function sendEncryptedMessage (roomId, plaintextObj, { pb, $localDb, $state }) {
  const { default: sodium } = await import('libsodium-wrappers-sumo')
  await sodium.ready

  if (!roomId) {
    throw new Error('No room selected')
  }

  const db = $localDb

  // Fetch room key
  const room = await db.local_rooms.get(roomId)
  if (!room || !room.key_history || room.key_history.length === 0) {
    throw new Error('Encryption keys not found for this room')
  }

  const latestKeyObj = room.key_history.reduce((prev, current) => {
    const prevEpoch = parseInt(prev.epoch_id, 10)
    const currEpoch = parseInt(current.epoch_id, 10)
    return (prevEpoch > currEpoch) ? prev : current
  })
  const latestEpochId = latestKeyObj.epoch_id
  const roomKey = sodium.from_base64(latestKeyObj.key, sodium.base64_variants.ORIGINAL)

  // Fetch causal link (previous_msg_uuid)
  const { default: Dexie } = await import('dexie')
  const lastMsg = await db.local_messages
    .where('[room_id+created_at]')
    .between([roomId, Dexie.minKey], [roomId, Dexie.maxKey])
    .last()

  const previousMsgId = lastMsg ? lastMsg.id : ''

  // Construct Plaintext
  const plaintextStr = JSON.stringify(plaintextObj)

  // Encryption (X25519)
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertextBuffer = sodium.crypto_secretbox_easy(plaintextStr, nonce, roomKey)
  const ciphertextBase64 = sodium.to_base64(ciphertextBuffer, sodium.base64_variants.ORIGINAL)

  // Signature (Ed25519)
  if (!$state.currentUser || !$state.currentUser.private_sign_key) {
    throw new Error('User identity keys not found')
  }

  const validationString = `${roomId}|${latestEpochId}|${previousMsgId}|${ciphertextBase64}`
  const validationBuffer = new TextEncoder().encode(validationString)

  const privateSignKeyBuffer = sodium.from_base64($state.currentUser.private_sign_key, sodium.base64_variants.ORIGINAL)
  const signatureBuffer = sodium.crypto_sign_detached(validationBuffer, privateSignKeyBuffer)

  // Server upload
  const payload = {
    room_id: roomId,
    sender_id: $state.currentUser.id,
    epoch_id: latestEpochId,
    ciphertext: ciphertextBase64,
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    signature: sodium.to_base64(signatureBuffer, sodium.base64_variants.ORIGINAL),
    previous_msg_uuid: previousMsgId
  }

  const pbInstance = typeof pb === 'function' ? await pb() : pb
  return await pbInstance.collection('messages').create(payload)
}
