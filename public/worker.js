/* global sodium, importScripts, Dexie */
importScripts('/assets/libsodium-sumo.js')
importScripts('/assets/libsodium-wrappers.js')
importScripts('/assets/dexie.js')

/**
 * The Worker Script for Atoll Chat
 * Handles heavy cryptographic operations off the main thread.
 */

let db
let baseUrl
let authToken
const publicKeyCache = new Map()
let currentUserKeys = null

let isProcessing = false
const messageQueue = []

async function init () {
  try {
    await sodium.ready

    db = new Dexie('AtollChatDB')
    db.version(6).stores({
      local_rooms: 'id, is_group, updated_at',
      local_messages: 'local_uuid, id, room_id, created_at, [room_id+created_at], type, content',
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

  if (type === 'SET_TOKEN') {
    authToken = payload.token
    self.postMessage({
      id,
      type,
      result: 'ACK'
    })
    return
  }

  try {
    if (type === 'INIT_KEYS') {
      currentUserKeys = payload
      console.log('[worker] Keys initialized for user:', currentUserKeys.id)
      self.postMessage({
        id,
        type,
        result: 'ACK'
      })
      return
    }

    if (type === 'WIPE_KEYS') {
      currentUserKeys = null
      publicKeyCache.clear()
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

    // New tasks: SEND_MESSAGE and PROCESS_INCOMING_MESSAGE
    if (type === 'SEND_MESSAGE') {
      await sendMessage(id, payload)
      return
    }

    if (type === 'PROCESS_INCOMING_MESSAGE') {
      await processIncomingMessage(id, payload)
      return
    }

    if (type === 'PROCESS_NEW_ROOM_KEY') {
      await processNewRoomKey(id, payload)
      return
    }

    if (type === 'UPDATE_ROOM_MEMBER') {
      await updateRoomMember(id, payload)
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

async function sendMessage (rpcId, payload) {
  const { roomId, plaintextObj, localUuid } = payload

  if (!currentUserKeys || !currentUserKeys.private_sign_key) {
    throw new Error('User identity keys not found in worker')
  }

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
  const lastMsg = await db.local_messages
    .where('[room_id+created_at]')
    .between([roomId, Dexie.minKey], [roomId, Dexie.maxKey])
    .last()

  const previousMsgId = lastMsg ? (lastMsg.id || lastMsg.local_uuid) : 'START'

  // Construct Plaintext (inject local_uuid into plaintext so others can use it for deduplication too)
  plaintextObj.local_uuid = localUuid
  const plaintextStr = JSON.stringify(plaintextObj)

  // Encryption (X25519)
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertextBuffer = sodium.crypto_secretbox_easy(plaintextStr, nonce, roomKey)
  const ciphertextBase64 = sodium.to_base64(ciphertextBuffer, sodium.base64_variants.ORIGINAL)
  const nonceBase64 = sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)

  const validationString = `${roomId}|${latestEpochId}|${previousMsgId}|${ciphertextBase64}|${nonceBase64}`
  const validationBuffer = new TextEncoder().encode(validationString)

  const privateSignKeyBuffer = sodium.from_base64(currentUserKeys.private_sign_key, sodium.base64_variants.ORIGINAL)
  const signatureBuffer = sodium.crypto_sign_detached(validationBuffer, privateSignKeyBuffer)

  // Server upload
  const uploadPayload = {
    room_id: roomId,
    sender_id: currentUserKeys.id,
    epoch_id: latestEpochId,
    payload: {
      ciphertext: ciphertextBase64,
      nonce: nonceBase64
    },
    signature: sodium.to_base64(signatureBuffer, sodium.base64_variants.ORIGINAL),
    previous_msg_uuid: previousMsgId,
    local_uuid: localUuid
  }

  const headers = {
    'Content-Type': 'application/json'
  }
  if (authToken) {
    headers.Authorization = authToken
  }

  const response = await fetch(`${baseUrl}/api/collections/messages/records`, {
    method: 'POST',
    headers,
    body: JSON.stringify(uploadPayload)
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(`Failed to send message: ${response.status} ${JSON.stringify(errorData)}`)
  }

  const pbRecord = await response.json()

  // Update IndexedDB
  await db.local_messages.update(localUuid, {
    id: pbRecord.id,
    status: 'sent'
  })

  // Notify UI
  self.postMessage({
    type: 'NEW_LOCAL_DATA',
    payload: { room_id: roomId }
  })

  self.postMessage({
    id: rpcId,
    type: 'SEND_MESSAGE',
    result: {
      success: true,
      id: pbRecord.id
    }
  })
}

async function processIncomingMessage (rpcId, record) {
  const {
    id,
    room_id: roomId,
    epoch_id: epochId,
    sender_id: senderId,
    payload,
    signature,
    previous_msg_uuid: previousMsgUuid,
    local_uuid: localUuid,
    created
  } = record

  // Anti-duplication: check if local_uuid already exists
  if (localUuid) {
    const exists = await db.local_messages.get(localUuid)
    if (exists) {
      // If it exists and status is pending, update it to sent/delivered
      if (exists.status === 'pending') {
        await db.local_messages.update(localUuid, {
          id: id,
          status: 'sent'
        })
        self.postMessage({
          type: 'NEW_LOCAL_DATA',
          payload: { room_id: roomId }
        })
      }

      self.postMessage({
        id: rpcId,
        type: 'PROCESS_INCOMING_MESSAGE',
        result: {
          success: true,
          duplicated: true
        }
      })
      return
    }
  }

  const { ciphertext, nonce } = payload

  // 1. Fetch Sender Key
  let senderKeys = publicKeyCache.get(senderId)
  if (!senderKeys || !senderKeys.public_sign_key) {
    if (!baseUrl) {
      throw new Error('Base URL not initialized')
    }
    const headers = {}
    if (authToken) {
      headers.Authorization = authToken
    }
    const response = await fetch(`${baseUrl}/api/collections/users/records/${senderId}`, { headers })
    if (!response.ok) {
      throw new Error(`Failed to fetch sender public key (${senderId}): ${response.status} ${response.statusText}`)
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
  if (!publicSignKey) {
    throw new Error('Sender public sign key is missing')
  }

  // 2. Identity Verification (Ed25519)
  const signatureBuffer = sodium.from_base64(signature, sodium.base64_variants.ORIGINAL)
  const publicSignKeyBuffer = sodium.from_base64(publicSignKey, sodium.base64_variants.ORIGINAL)

  const validationString = `${roomId}|${epochId}|${previousMsgUuid}|${ciphertext}|${nonce}`
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

  const ciphertextBuffer = sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL)
  const nonceBuffer = sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL)
  const epochKeyBuffer = sodium.from_base64(activeEpoch.key, sodium.base64_variants.ORIGINAL)

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
    local_uuid: decryptedPayload.local_uuid || id,
    room_id: roomId,
    sender_id: senderId,
    type,
    content,
    candidate,
    timestamp,
    status: 'sent',
    previous_msg_uuid: previousMsgUuid,
    created_at: created
  }

  // If media, extend the message with media metadata for easier rendering in the timeline
  if (type === 'media') {
    const { media_id, file_key, file_nonce, mime_type, waveform_data, music_metadata, album_art } = decryptedPayload
    decryptedMessage.media_id = media_id
    decryptedMessage.file_key = file_key
    decryptedMessage.file_nonce = file_nonce
    decryptedMessage.mime_type = mime_type
    decryptedMessage.waveform_data = waveform_data
    decryptedMessage.music_metadata = music_metadata
    decryptedMessage.album_art = album_art

    // Also store in local_assets for the global archive
    await db.local_assets.put({
      id: media_id,
      media_id,
      room_id: roomId,
      mime_type,
      file_key,
      file_nonce,
      created_at: created,
      music_metadata,
      album_art
    })
  }

  await db.local_messages.put(decryptedMessage)

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

async function updateRoomMember (rpcId, record) {
  const { room_id, user_id, last_read_message_id } = record

  const room = await db.local_rooms.get(room_id)
  if (room && room.participants) {
    const pIndex = room.participants.findIndex(p => p.id === user_id)
    if (pIndex !== -1) {
      room.participants[pIndex].last_read_message_id = last_read_message_id
      await db.local_rooms.put(room)

      self.postMessage({
        type: 'NEW_LOCAL_DATA',
        payload: { room_id }
      })
    }
  }

  self.postMessage({
    id: rpcId,
    type: 'UPDATE_ROOM_MEMBER',
    result: { success: true }
  })
}

async function processNewRoomKey (rpcId, payload) {
  const {
    room_id,
    wrapped_by,
    encrypted_room_key,
    key_nonce,
    epoch_id,
    role,
    updated
  } = payload

  const effectiveEpochId = epoch_id || 1

  if (!currentUserKeys || !currentUserKeys.private_box_key) {
    throw new Error('User keys not initialized in worker')
  }

  // Fetch Inviter's Public Key
  let inviterKeys = publicKeyCache.get(wrapped_by)
  if (!inviterKeys || !inviterKeys.public_box_key) {
    if (!baseUrl) {
      throw new Error('Base URL not initialized')
    }
    const headers = {}
    if (authToken) {
      headers.Authorization = authToken
    }
    const response = await fetch(`${baseUrl}/api/collections/users/records/${wrapped_by}`, { headers })
    if (!response.ok) {
      throw new Error(`Failed to fetch inviter public key (${wrapped_by}): ${response.status} ${response.statusText}`)
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
  if (!inviterPublicKey) {
    throw new Error('Inviter public box key is missing')
  }

  // Decrypt (Unwrap)
  const encryptedRoomKeyBuffer = sodium.from_base64(encrypted_room_key, sodium.base64_variants.ORIGINAL)
  const nonceBuffer = sodium.from_base64(key_nonce, sodium.base64_variants.ORIGINAL)
  const inviterPublicKeyBuffer = sodium.from_base64(inviterPublicKey, sodium.base64_variants.ORIGINAL)
  const userPrivateKeyBuffer = sodium.from_base64(currentUserKeys.private_box_key, sodium.base64_variants.ORIGINAL)

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

  // Fetch Room metadata and members from server
  let roomMetadata = null
  let isGroup = true
  let participants = []
  const headers = {}
  if (authToken) {
    headers.Authorization = authToken
  }

  // 1. Fetch Room record
  const roomResponse = await fetch(`${baseUrl}/api/collections/rooms/records/${room_id}`, { headers })
  if (roomResponse.ok) {
    const roomRecord = await roomResponse.json()
    isGroup = roomRecord.is_group

    if (roomRecord.encrypted_metadata && roomRecord.encrypted_metadata.ciphertext) {
      const metadataCiphertext = sodium.from_base64(roomRecord.encrypted_metadata.ciphertext, sodium.base64_variants.ORIGINAL)
      const metadataNonce = sodium.from_base64(roomRecord.encrypted_metadata.nonce, sodium.base64_variants.ORIGINAL)
      try {
        const decryptedMetadataBuffer = sodium.crypto_secretbox_open_easy(metadataCiphertext, metadataNonce, unwrappedKeyBuffer)
        if (decryptedMetadataBuffer) {
          roomMetadata = JSON.parse(new TextDecoder().decode(decryptedMetadataBuffer))
        }
      } catch (err) {
        console.error('Failed to decrypt room metadata:', err)
      }
    }
  }

  // 2. Fetch Room members with user details
  const membersUrl = `${baseUrl}/api/collections/room_members/records?filter=(room_id='${room_id}')&expand=user_id`
  const membersResponse = await fetch(membersUrl, { headers })
  if (membersResponse.ok) {
    const membersData = await membersResponse.json()
    participants = membersData.items.map(m => {
      const u = m.expand?.user_id
      return u
        ? {
          id: u.id,
          username: u.username,
          avatar: u.avatar,
          collectionId: u.collectionId,
          collectionName: u.collectionName,
          last_read_message_id: m.last_read_message_id
        }
        : null
    }).filter(p => p !== null)
  }

  // Epoch Management & Local Storage
  let room = await db.local_rooms.get(room_id)
  if (!room) {
    room = {
      id: room_id,
      is_group: isGroup,
      name: roomMetadata?.name || '',
      avatar: roomMetadata?.avatar || '',
      participants,
      user_role: role,
      key_history: [],
      updated_at: updated
    }
  } else {
    room.updated_at = updated
    room.user_role = role || room.user_role
    if (roomMetadata?.name) {
      room.name = roomMetadata.name
    }
    if (roomMetadata?.avatar) {
      room.avatar = roomMetadata.avatar
    }
    room.participants = participants
  }

  if (!room.key_history) {
    room.key_history = []
  }

  // Use authoritative epoch_id from payload
  const existingEpochIndex = room.key_history.findIndex(h => h.epoch_id === effectiveEpochId)
  if (existingEpochIndex !== -1) {
    room.key_history[existingEpochIndex].key = sodium.to_base64(unwrappedKeyBuffer, sodium.base64_variants.ORIGINAL)
  } else {
    room.key_history.push({
      epoch_id: effectiveEpochId,
      key: sodium.to_base64(unwrappedKeyBuffer, sodium.base64_variants.ORIGINAL)
    })
  }

  await db.local_rooms.put(room)

  // UI Notification
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
