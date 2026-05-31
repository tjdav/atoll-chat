/* global sodium, importScripts, Dexie */
importScripts('/assets/libsodium-sumo.js')
importScripts('/assets/libsodium-wrappers.js')
importScripts('https://unpkg.com/dexie@4.0.10/dist/dexie.js')

/**
 * The Worker Script for Atoll Chat
 * Handles heavy cryptographic operations off the main thread.
 */

let db
let baseUrl
const publicKeyCache = new Map()
let currentUserKeys = null

let isProcessing = false
const messageQueue = []

async function init () {
  try {
    await sodium.ready

    db = new Dexie('AtollChatDB')
    db.version(3).stores({
      local_rooms: 'id, is_group, updated_at',
      local_messages: 'id, room_id, created_at, [room_id+created_at], type',
      local_assets: 'id, room_id, mime_type, created_at',
      local_config: 'key'
    })

    self.postMessage({ type: 'WORKER_READY' })
  } catch (err) {
    console.error('Worker Init Error:', err)
  }
}

self.onmessage = (event) => {
  messageQueue.push(event)
  processQueue()
}

let readyPromise

async function processQueue () {
  if (isProcessing || messageQueue.length === 0) {
    return
  }
  isProcessing = true

  const event = messageQueue.shift()
  try {
    await readyPromise
    await handleEvent(event)
  } catch (err) {
    console.error('Queue processing error:', err)
  } finally {
    isProcessing = false
    processQueue()
  }
}

async function handleEvent (event) {
  const { id, type, payload } = event.data

  // Handle WORKER_READY check if sent from main thread (optional)
  if (type === 'CHECK_READY') {
    self.postMessage({ type: 'WORKER_READY' })
    return
  }

  if (type === 'INIT') {
    baseUrl = payload.baseUrl
    return
  }

  try {
    if (type === 'INIT_KEYS') {
      currentUserKeys = payload
      self.postMessage({
        id,
        type,
        result: 'ACK'
      })
      return
    }

    if (type === 'test-rpc') {
      self.postMessage({
        id,
        type,
        payload,
        result: 'ACK'
      })
      return
    }

    if (type === 'generateSalt') {
      const salt = sodium.randombytes_buf(16)
      self.postMessage({
        id,
        type,
        result: salt
      })
      return
    }

    if (type === 'deriveKeyFromPin') {
      const { pin, salt } = payload
      const KEK = await sodium.crypto_pwhash(
        32,
        pin,
        salt,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_ARGON2ID13
      )
      self.postMessage({
        id,
        type,
        result: KEK
      })
      return
    }

    // New task: PROCESS_INCOMING_MESSAGE
    if (type === 'PROCESS_INCOMING_MESSAGE') {
      await processIncomingMessage(id, payload)
      return
    }

    if (type === 'PROCESS_NEW_ROOM_KEY') {
      await processNewRoomKey(id, payload)
      return
    }

    self.postMessage({
      id,
      type,
      error: `Unknown task type: ${type}`
    })
  } catch (error) {
    self.postMessage({
      id,
      type,
      error: error.message
    })
  }
}

async function processIncomingMessage (rpcId, payload) {
  const {
    id,
    room_id: roomId,
    epoch_id: epochId,
    sender_id: senderId,
    ciphertext,
    nonce,
    signature,
    previous_msg_uuid: previousMsgUuid,
    created
  } = payload

  // 1. Fetch Sender Key
  let senderKeys = publicKeyCache.get(senderId)
  if (!senderKeys || !senderKeys.public_sign_key) {
    if (!baseUrl) {
      throw new Error('Base URL not initialized')
    }
    const response = await fetch(`${baseUrl}/api/collections/users/records/${senderId}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch sender public key: ${response.statusText}`)
    }
    const userRecord = await response.json()
    senderKeys = {
      ...(senderKeys || {}),
      public_box_key: userRecord.public_box_key,
      public_sign_key: userRecord.public_sign_key
    }
    publicKeyCache.set(senderId, senderKeys)
  }

  const publicSignKey = senderKeys.public_sign_key

  // 2. Identity Verification (Ed25519)
  const signatureBuffer = sodium.from_base64(signature)
  const publicSignKeyBuffer = sodium.from_base64(publicSignKey)

  const validationString = `${roomId}|${epochId}|${previousMsgUuid}|${ciphertext}`
  const validationBuffer = new TextEncoder().encode(validationString)

  const isValid = sodium.crypto_sign_verify_detached(signatureBuffer, validationBuffer, publicSignKeyBuffer)
  if (!isValid) {
    throw new Error('Signature forged or invalid')
  }

  // 3. Symmetric Decryption (X25519)
  const room = await db.local_rooms.get(roomId)
  if (!room) {
    throw new Error(`Local room ${roomId} not found`)
  }

  const activeEpoch = room.key_history?.find(h => h.epoch_id === epochId)
  if (!activeEpoch) {
    throw new Error('Missing cryptographic key for this epoch.')
  }

  const ciphertextBuffer = sodium.from_base64(ciphertext)
  const nonceBuffer = sodium.from_base64(nonce)
  const epochKeyBuffer = sodium.from_base64(activeEpoch.key)

  let decryptedBuffer
  try {
    decryptedBuffer = sodium.crypto_secretbox_open_easy(ciphertextBuffer, nonceBuffer, epochKeyBuffer)
  } catch (e) {
    throw new Error('Decryption failed')
  }

  if (!decryptedBuffer) {
    throw new Error('Decryption failed (null result)')
  }

  const decryptedString = new TextDecoder().decode(decryptedBuffer)
  const decryptedPayload = JSON.parse(decryptedString)
  const { type, content, candidate, timestamp } = decryptedPayload

  // Storage and causal chain resolution.
  const decryptedMessage = {
    id,
    room_id: roomId,
    sender_id: senderId,
    type,
    content,
    candidate,
    timestamp,
    previous_msg_uuid: previousMsgUuid,
    created_at: created
  }

  await db.local_messages.put(decryptedMessage)

  // If media, also store in local_assets for the global archive
  if (type === 'media') {
    const { media_id, file_key, file_nonce, mime_type } = decryptedPayload
    await db.local_assets.put({
      id: media_id,
      media_id,
      room_id: roomId,
      mime_type,
      file_key,
      file_nonce,
      created_at: created
    })
  }

  // Notify UI and resolve RPC.
  self.postMessage({
    type: 'NEW_LOCAL_DATA',
    payload: { room_id: roomId }
  })
  self.postMessage({
    id: rpcId,
    type: 'PROCESS_INCOMING_MESSAGE',
    result: { success: true }
  })
}

async function processNewRoomKey (rpcId, payload) {
  const { room_id, wrapped_by, encrypted_room_key, key_nonce, epoch_id, updated } = payload

  if (!currentUserKeys || !currentUserKeys.private_box_key) {
    throw new Error('User keys not initialized in worker')
  }

  // 1. Fetch Inviter's Public Key
  let inviterKeys = publicKeyCache.get(wrapped_by)
  if (!inviterKeys || !inviterKeys.public_box_key) {
    if (!baseUrl) {
      throw new Error('Base URL not initialized')
    }
    const response = await fetch(`${baseUrl}/api/collections/users/records/${wrapped_by}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch inviter public key: ${response.statusText}`)
    }
    const userRecord = await response.json()
    inviterKeys = {
      ...(inviterKeys || {}),
      public_box_key: userRecord.public_box_key,
      public_sign_key: userRecord.public_sign_key
    }
    publicKeyCache.set(wrapped_by, inviterKeys)
  }

  const inviterPublicKey = inviterKeys.public_box_key

  // 2. Decrypt (Unwrap)
  const encryptedRoomKeyBuffer = sodium.from_base64(encrypted_room_key)
  const nonceBuffer = sodium.from_base64(key_nonce)
  const inviterPublicKeyBuffer = sodium.from_base64(inviterPublicKey)
  const userPrivateKeyBuffer = sodium.from_base64(currentUserKeys.private_box_key)

  let unwrappedKeyBuffer
  try {
    unwrappedKeyBuffer = sodium.crypto_box_open_easy(
      encryptedRoomKeyBuffer,
      nonceBuffer,
      inviterPublicKeyBuffer,
      userPrivateKeyBuffer
    )
  } catch (e) {
    throw new Error('Failed to unwrap room key: Decryption error')
  }

  if (!unwrappedKeyBuffer) {
    throw new Error('Failed to unwrap room key: Null result')
  }

  // 3. Epoch Management & Local Storage
  let room = await db.local_rooms.get(room_id)
  if (!room) {
    // For brand new invites, we might not know if it's a group yet from the key alone,
    // but typically metadata follows. Defaulting to true as most chats are technically groups or 1-on-1s.
    room = {
      id: room_id,
      is_group: true,
      key_history: [],
      updated_at: updated
    }
  } else {
    room.updated_at = updated
  }

  if (!room.key_history) {
    room.key_history = []
  }

  // Use authoritative epoch_id from payload
  const existingEpochIndex = room.key_history.findIndex(h => h.epoch_id === epoch_id)
  if (existingEpochIndex !== -1) {
    room.key_history[existingEpochIndex].key = sodium.to_base64(unwrappedKeyBuffer)
  } else {
    room.key_history.push({
      epoch_id,
      key: sodium.to_base64(unwrappedKeyBuffer)
    })
  }

  await db.local_rooms.put(room)

  // 4. UI Notification
  self.postMessage({
    type: 'NEW_LOCAL_ROOM',
    payload: { room_id }
  })
  self.postMessage({
    id: rpcId,
    type: 'PROCESS_NEW_ROOM_KEY',
    result: { success: true }
  })
}

readyPromise = init()
