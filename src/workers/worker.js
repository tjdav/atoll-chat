/// <reference lib="webworker" />

/**
 * @typedef {import('dexie').Dexie & {
 *   local_rooms: import('dexie').Table<any, any>,
 *   local_messages: import('dexie').Table<any, any>,
 *   local_assets: import('dexie').Table<any, any>,
 *   local_config: import('dexie').Table<any, any>
 * }} AtollChatDatabase
 */

/**
 * @typedef {{
 *   new (name: string): AtollChatDatabase,
 *   minKey: any,
 *   maxKey: any
 * }} DexieConstructor
 */

/**
 * @typedef {any} DedicatedWorkerGlobalScope
 */

/**
 * @typedef {DedicatedWorkerGlobalScope & {
 *   sodium: typeof import('libsodium-wrappers-sumo'),
 *   Dexie: DexieConstructor
 * }} WorkerScope
 */

/**
 * @typedef {any} WebWorkerBlobPart
 */

/** @type {any} */
const rawSelf = self
/** @type {WorkerScope} */
const workerSelf = rawSelf

/* global importScripts */
importScripts('/assets/libsodium-sumo.js')
importScripts('/assets/libsodium-wrappers.js')
importScripts('/assets/dexie.js')

const sodium = workerSelf.sodium
const Dexie = workerSelf.Dexie

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

/**
 * Worker state tracking
 */
let isInitialized = false

async function init () {
  try {
    await sodium.ready

    db = new Dexie('AtollChatDB')
    db.version(9).stores({
      local_rooms: 'id, is_group, updated_at',
      local_messages: 'local_uuid, id, room_id, created_at, [room_id+created_at], type, target_id',
      local_assets: 'id, room_id, message_id, mime_type, created_at',
      local_config: 'key'
    })

    self.postMessage({ type: 'worker:ready' })
  } catch (err) {
    console.error('Worker Init Error:', err)
  }
}

self.onmessage = (event) => {
  const { type } = event.data

  // Certain tasks can be processed immediately and in parallel
  const parallelTasks = [
    'worker:check_ready',
    'worker:test_rpc',
    'worker:generate_salt',
    'worker:derive_key_from_password',
    'worker:process_incoming_message',
    'worker:decrypt_file',
    'worker:process_new_room_key',
    'room:member_updated',
    'worker:delete_local_room'
  ]

  if (parallelTasks.includes(type)) {
    handleParallelEvent(event)
  } else {
    messageQueue.push(event)
    processQueue()
  }
}

let readyPromise

async function handleParallelEvent (event) {
  try {
    await readyPromise
    await handleEvent(event)
  } catch (err) {
    console.error('Parallel task error:', err)
    const { id, type } = event.data
    self.postMessage({
      id,
      type,
      error: err.message
    })
  }
}

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

  // Handle worker:ready check if sent from main thread (optional)
  if (type === 'worker:check_ready') {
    self.postMessage({ type: 'worker:ready' })
    return
  }

  if (type === 'worker:init') {
    baseUrl = payload.baseUrl
    return
  }

  if (type === 'worker:set_token') {
    authToken = payload.token
    self.postMessage({
      id,
      type,
      result: 'ACK'
    })
    return
  }

  try {
    if (type === 'worker:init_keys') {
      currentUserKeys = payload
      isInitialized = true
      console.log('[worker] Keys initialized for user:', currentUserKeys.id)
      self.postMessage({
        id,
        type,
        result: 'ACK'
      })
      // Broadcast ready state
      self.postMessage({
        type: 'worker:initialized',
        payload: { userId: currentUserKeys.id }
      })
      return
    }

    if (type === 'worker:decrypt_file') {
      const { encryptedBuffer, nonce, key } = payload
      const decryptedBuffer = sodium.crypto_secretbox_open_easy(
        new Uint8Array(encryptedBuffer),
        sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL),
        sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
      )
      if (!decryptedBuffer) {
        throw new Error('Decryption failed')
      }
      self.postMessage({
        id,
        type,
        result: decryptedBuffer
      }, { transfer: [decryptedBuffer.buffer] })
      return
    }

    if (type === 'worker:wipe_keys') {
      currentUserKeys = null
      isInitialized = false
      publicKeyCache.clear()
      self.postMessage({
        id,
        type,
        result: 'ACK'
      })
      return
    }

    if (type === 'worker:get_init_state') {
      self.postMessage({
        id,
        type,
        result: {
          isInitialized,
          userId: currentUserKeys?.id
        }
      })
      return
    }

    if (type === 'worker:test_rpc') {
      self.postMessage({
        id,
        type,
        payload,
        result: 'ACK'
      })
      return
    }

    if (type === 'worker:generate_salt') {
      const salt = sodium.randombytes_buf(16)
      self.postMessage({
        id,
        type,
        result: salt
      })
      return
    }

    if (type === 'worker:derive_key_from_password') {
      const { password, salt } = payload
      const KEK = await sodium.crypto_pwhash(
        32,
        password,
        typeof salt === 'string' ? sodium.from_base64(salt, sodium.base64_variants.ORIGINAL) : salt,
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

    // Low-level Libsodium primitives
    if (type === 'worker:crypto_secretbox_easy') {
      const { message, nonce, key } = payload
      const result = sodium.crypto_secretbox_easy(
        typeof message === 'string' ? message : new Uint8Array(message),
        typeof nonce === 'string' ? sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL) : nonce,
        typeof key === 'string' ? sodium.from_base64(key, sodium.base64_variants.ORIGINAL) : key
      )
      self.postMessage({
        id,
        type,
        result
      })
      return
    }

    if (type === 'worker:crypto_secretbox_open_easy') {
      const { ciphertext, nonce, key } = payload
      const result = sodium.crypto_secretbox_open_easy(
        typeof ciphertext === 'string' ? sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL) : new Uint8Array(ciphertext),
        typeof nonce === 'string' ? sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL) : nonce,
        typeof key === 'string' ? sodium.from_base64(key, sodium.base64_variants.ORIGINAL) : key
      )
      self.postMessage({
        id,
        type,
        result
      })
      return
    }

    if (type === 'worker:crypto_box_easy') {
      const { message, nonce, publicKey, privateKey } = payload
      const result = sodium.crypto_box_easy(
        typeof message === 'string' ? message : new Uint8Array(message),
        typeof nonce === 'string' ? sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL) : nonce,
        typeof publicKey === 'string' ? sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL) : publicKey,
        typeof privateKey === 'string' ? sodium.from_base64(privateKey, sodium.base64_variants.ORIGINAL) : privateKey
      )
      self.postMessage({
        id,
        type,
        result
      })
      return
    }

    if (type === 'worker:crypto_box_open_easy') {
      const { ciphertext, nonce, publicKey, privateKey } = payload
      const result = sodium.crypto_box_open_easy(
        typeof ciphertext === 'string' ? sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL) : new Uint8Array(ciphertext),
        typeof nonce === 'string' ? sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL) : nonce,
        typeof publicKey === 'string' ? sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL) : publicKey,
        typeof privateKey === 'string' ? sodium.from_base64(privateKey, sodium.base64_variants.ORIGINAL) : privateKey
      )
      self.postMessage({
        id,
        type,
        result
      })
      return
    }

    if (type === 'worker:crypto_sign_detached') {
      const { message, privateKey } = payload
      const result = sodium.crypto_sign_detached(
        typeof message === 'string' ? new TextEncoder().encode(message) : new Uint8Array(message),
        typeof privateKey === 'string' ? sodium.from_base64(privateKey, sodium.base64_variants.ORIGINAL) : privateKey
      )
      self.postMessage({
        id,
        type,
        result
      })
      return
    }

    if (type === 'worker:randombytes_buf') {
      const { length } = payload
      const result = sodium.randombytes_buf(length)
      self.postMessage({
        id,
        type,
        result
      })
      return
    }

    // High-level tasks (replacing cryptoUtils.js)
    if (type === 'worker:generate_master_keys') {
      const encryptionKeys = sodium.crypto_box_keypair()
      const identityKeys = sodium.crypto_sign_keypair()
      const result = {
        public_box_key: sodium.to_base64(encryptionKeys.publicKey, sodium.base64_variants.ORIGINAL),
        private_box_key: sodium.to_base64(encryptionKeys.privateKey, sodium.base64_variants.ORIGINAL),
        public_sign_key: sodium.to_base64(identityKeys.publicKey, sodium.base64_variants.ORIGINAL),
        private_sign_key: sodium.to_base64(identityKeys.privateKey, sodium.base64_variants.ORIGINAL)
      }
      self.postMessage({
        id,
        type,
        result
      })
      return
    }

    if (type === 'worker:encrypt_vault') {
      const { privateKeys, KEK } = payload
      const vaultPlaintext = JSON.stringify({
        private_box_key: privateKeys.private_box_key,
        private_sign_key: privateKeys.private_sign_key
      })
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
      const ciphertext = sodium.crypto_secretbox_easy(
        vaultPlaintext,
        nonce,
        typeof KEK === 'string' ? sodium.from_base64(KEK, sodium.base64_variants.ORIGINAL) : KEK
      )
      const result = {
        ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
        nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
      }
      self.postMessage({
        id,
        type,
        result
      })
      return
    }

    if (type === 'worker:decrypt_vault') {
      const { ciphertext, nonce, KEK } = payload
      const decrypted = sodium.crypto_secretbox_open_easy(
        sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL),
        sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL),
        typeof KEK === 'string' ? sodium.from_base64(KEK, sodium.base64_variants.ORIGINAL) : KEK
      )
      if (!decrypted) {
        throw new Error('Failed to decrypt vault. Invalid Password or corrupt data.')
      }
      const result = JSON.parse(sodium.to_string(decrypted))
      self.postMessage({
        id,
        type,
        result
      })
      return
    }

    // New tasks: worker:send_message and worker:process_incoming_message
    if (type === 'worker:send_message') {
      await sendMessage(id, payload)
      return
    }

    if (type === 'worker:process_incoming_message') {
      await processIncomingMessage(id, payload)
      return
    }

    if (type === 'worker:process_new_room_key') {
      await processNewRoomKey(id, payload)
      return
    }

    if (type === 'room:member_updated') {
      await updateRoomMember(id, payload)
      return
    }

    if (type === 'worker:delete_local_room') {
      await deleteLocalRoom(id, payload)
      return
    }

    if (type === 'worker:update_user_data') {
      await updateUserData(id, payload)
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

/**
 * Helper to perform fetch with a timeout
 */
async function fetchWithTimeout (resource, options = {}) {
  const { timeout = 15000 } = options

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    })
    return response
  } finally {
    clearTimeout(id)
  }
}

async function sendMessage (rpcId, payload) {
  const {
    room_id,
    localUuid,
    type,
    content,
    file,
    filename,
    mime_type,
    waveform_data,
    music_metadata,
    album_art_blob,
    thumbnail_blob,
    duration,
    candidate,
    candidates,
    media_types,
    target_id,
    timestamp,
    links,
    media_id: existingMediaId,
    file_key: existingFileKey,
    file_nonce: existingFileNonce,
    album_art: existingAlbumArt,
    thumbnail: existingThumbnail
  } = payload

  if (!currentUserKeys || !currentUserKeys.private_sign_key) {
    throw new Error('User identity keys not found in worker')
  }

  const room = await db.local_rooms.get(room_id)
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

  // Handle Media Encryption & Upload
  let mediaId = existingMediaId || null
  let fileKeyBase64 = existingFileKey || null
  let fileNonceBase64 = existingFileNonce || null
  let albumArtInfo = existingAlbumArt || null
  let thumbnailInfo = existingThumbnail || null

  const headers = {}
  if (authToken) {
    headers.Authorization = authToken
  }

  if (type === 'media' && file && !mediaId) {
    // Encrypt and upload album art if present
    if (album_art_blob) {
      const artBuffer = new Uint8Array(await album_art_blob.arrayBuffer())
      const artKey = sodium.randombytes_buf(32)
      const artNonce = sodium.randombytes_buf(24)
      const encryptedArt = sodium.crypto_secretbox_easy(artBuffer, artNonce, artKey)

      /** @type {WebWorkerBlobPart[]} */
      const artParts = [encryptedArt]
      const artBlob = new Blob(artParts, { type: 'application/octet-stream' })
      const artFormData = new FormData()
      artFormData.append('file', artBlob, 'album-art.bin')

      const artResponse = await fetchWithTimeout(`${baseUrl}/api/collections/media/records`, {
        method: 'POST',
        headers,
        body: artFormData
      })
      if (artResponse.ok) {
        const artRecord = await artResponse.json()
        albumArtInfo = {
          media_id: artRecord.id,
          file_key: sodium.to_base64(artKey, sodium.base64_variants.ORIGINAL),
          file_nonce: sodium.to_base64(artNonce, sodium.base64_variants.ORIGINAL)
        }
      }
    }

    // Encrypt and upload thumbnail if present
    if (thumbnail_blob) {
      const thumbBuffer = new Uint8Array(await thumbnail_blob.arrayBuffer())
      const thumbKey = sodium.randombytes_buf(32)
      const thumbNonce = sodium.randombytes_buf(24)
      const encryptedThumb = sodium.crypto_secretbox_easy(thumbBuffer, thumbNonce, thumbKey)

      /** @type {WebWorkerBlobPart[]} */
      const thumbParts = [encryptedThumb]
      const thumbBlob = new Blob(thumbParts, { type: 'application/octet-stream' })
      const thumbFormData = new FormData()
      thumbFormData.append('file', thumbBlob, 'thumbnail.bin')

      const thumbResponse = await fetchWithTimeout(`${baseUrl}/api/collections/media/records`, {
        method: 'POST',
        headers,
        body: thumbFormData
      })
      if (thumbResponse.ok) {
        const thumbRecord = await thumbResponse.json()
        thumbnailInfo = {
          media_id: thumbRecord.id,
          file_key: sodium.to_base64(thumbKey, sodium.base64_variants.ORIGINAL),
          file_nonce: sodium.to_base64(thumbNonce, sodium.base64_variants.ORIGINAL),
          mime_type: 'image/webp'
        }
      }
    }

    // Encrypt and upload main file
    const fileBuffer = new Uint8Array(await file.arrayBuffer())
    const fileKey = sodium.randombytes_buf(32)
    const fileNonce = sodium.randombytes_buf(24)
    const encryptedFile = sodium.crypto_secretbox_easy(fileBuffer, fileNonce, fileKey)

    /** @type {WebWorkerBlobPart[]} */
    const mainParts = [encryptedFile]
    const mainBlob = new Blob(mainParts, { type: 'application/octet-stream' })
    const mainFormData = new FormData()
    mainFormData.append('file', mainBlob, 'encrypted.bin')

    const mainResponse = await fetchWithTimeout(`${baseUrl}/api/collections/media/records`, {
      method: 'POST',
      headers,
      body: mainFormData
    })
    if (!mainResponse.ok) {
      throw new Error(`Failed to upload media: ${mainResponse.status}`)
    }
    const mainRecord = await mainResponse.json()
    mediaId = mainRecord.id
    fileKeyBase64 = sodium.to_base64(fileKey, sodium.base64_variants.ORIGINAL)
    fileNonceBase64 = sodium.to_base64(fileNonce, sodium.base64_variants.ORIGINAL)
  }

  // Construct Plaintext
  const plaintextObj = {
    local_uuid: localUuid,
    type,
    content,
    candidate,
    candidates,
    media_types,
    target_id,
    timestamp: timestamp || Date.now()
  }

  if (type === 'link') {
    plaintextObj.links = links
  }

  if (type === 'media') {
    plaintextObj.media_id = mediaId
    plaintextObj.file_key = fileKeyBase64
    plaintextObj.file_nonce = fileNonceBase64
    plaintextObj.filename = filename
    plaintextObj.mime_type = mime_type
    plaintextObj.waveform_data = waveform_data
    plaintextObj.music_metadata = music_metadata
    plaintextObj.album_art = albumArtInfo
    plaintextObj.thumbnail = thumbnailInfo
    plaintextObj.duration = duration
  }

  const plaintextStr = JSON.stringify(plaintextObj)

  // Encrypt Message
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertextBuffer = sodium.crypto_secretbox_easy(plaintextStr, nonce, roomKey)
  const ciphertextBase64 = sodium.to_base64(ciphertextBuffer, sodium.base64_variants.ORIGINAL)
  const nonceBase64 = sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)

  // Fetch causal link (previous_msg_uuid)
  const lastMsg = await db.local_messages
    .where('[room_id+created_at]')
    .between([room_id, Dexie.minKey], [room_id, Dexie.maxKey])
    .last()
  const previousMsgId = lastMsg ? (lastMsg.id || lastMsg.local_uuid) : 'START'

  // Sign Message
  const validationString = `${room_id}|${latestEpochId}|${previousMsgId}|${ciphertextBase64}|${nonceBase64}`
  const validationBuffer = new TextEncoder().encode(validationString)
  const privateSignKeyBuffer = sodium.from_base64(currentUserKeys.private_sign_key, sodium.base64_variants.ORIGINAL)
  const signatureBuffer = sodium.crypto_sign_detached(validationBuffer, privateSignKeyBuffer)

  // Server upload
  const uploadPayload = {
    room_id: room_id,
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

  const messageResponse = await fetchWithTimeout(`${baseUrl}/api/collections/messages/records`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(uploadPayload)
  })

  if (!messageResponse.ok) {
    const errorData = await messageResponse.json()
    throw new Error(`Failed to send message: ${messageResponse.status} ${JSON.stringify(errorData)}`)
  }

  const pbRecord = await messageResponse.json()

  // 7. Update IndexedDB & Notify UI
  const updateData = {
    id: pbRecord.id,
    status: 'sent',
    created_at: pbRecord.created
  }

  if (type === 'media') {
    updateData.media_id = mediaId
    updateData.file_key = fileKeyBase64
    updateData.file_nonce = fileNonceBase64
    updateData.filename = filename
    updateData.mime_type = mime_type
    updateData.album_art = albumArtInfo
    updateData.thumbnail = thumbnailInfo
    updateData.duration = duration

    await db.local_assets.put({
      id: mediaId,
      media_id: mediaId,
      room_id,
      message_id: localUuid,
      filename,
      mime_type,
      file_key: fileKeyBase64,
      file_nonce: fileNonceBase64,
      created_at: pbRecord.created,
      music_metadata,
      album_art: albumArtInfo,
      thumbnail: thumbnailInfo,
      duration
    })
  }

  if (type !== 'ice_candidate') {
    const existing = await db.local_messages.get(localUuid)
    if (existing) {
      await db.local_messages.update(localUuid, updateData)
    } else {
      // For reactions or other types that might not have been optimistically written yet
      await db.local_messages.put({
        local_uuid: localUuid,
        room_id: room_id,
        sender_id: currentUserKeys.id,
        type,
        content,
        target_id,
        ...updateData
      })
    }
  }

  const fullMessage = (type === 'ice_candidate' || !await db.local_messages.get(localUuid))
    ? {
      ...plaintextObj,
      ...updateData,
      room_id,
      sender_id: currentUserKeys.id
    }
    : await db.local_messages.get(localUuid)

  self.postMessage({
    type: 'db:new_local_data',
    payload: {
      room_id,
      message: fullMessage
    }
  })

  self.postMessage({
    id: rpcId,
    type: 'worker:send_message',
    result: {
      success: true,
      id: pbRecord.id
    }
  })
}

async function processIncomingMessage (rpcId, record) {
  const {
    id,
    room_id,
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
        const fullMessage = await db.local_messages.get(localUuid)
        self.postMessage({
          type: 'db:new_local_data',
          payload: {
            room_id,
            message: fullMessage
          }
        })
      }

      self.postMessage({
        id: rpcId,
        type: 'worker:process_incoming_message',
        result: {
          success: true,
          duplicated: true
        }
      })
      return
    }
  }

  const { ciphertext, nonce } = payload

  // Fetch Sender Key
  let senderKeys = publicKeyCache.get(senderId)
  if (!senderKeys || !senderKeys.public_sign_key) {
    if (!baseUrl) {
      throw new Error('Base URL not initialized')
    }
    const headers = {}
    if (authToken) {
      headers.Authorization = authToken
    }
    const response = await fetchWithTimeout(`${baseUrl}/api/collections/users/records/${senderId}`, { headers })
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

  // Identity Verification (Ed25519)
  const signatureBuffer = sodium.from_base64(signature, sodium.base64_variants.ORIGINAL)
  const publicSignKeyBuffer = sodium.from_base64(publicSignKey, sodium.base64_variants.ORIGINAL)

  const validationString = `${room_id}|${epochId}|${previousMsgUuid}|${ciphertext}|${nonce}`
  const validationBuffer = new TextEncoder().encode(validationString)

  const isValid = sodium.crypto_sign_verify_detached(signatureBuffer, validationBuffer, publicSignKeyBuffer)
  if (!isValid) {
    throw new Error('Signature forged or invalid')
  }

  // Symmetric Decryption (X25519)
  const room = await db.local_rooms.get(room_id)
  if (!room) {
    throw new Error(`Local room ${room_id} not found`)
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
  } catch {
    throw new Error('Decryption failed')
  }

  if (!decryptedBuffer) {
    throw new Error('Decryption failed (null result)')
  }

  const decryptedString = new TextDecoder().decode(decryptedBuffer)
  const decryptedPayload = JSON.parse(decryptedString)
  const { type, content, candidate, candidates, media_types, target_id, timestamp } = decryptedPayload

  // Storage and causal chain resolution.
  const decryptedMessage = {
    id,
    local_uuid: decryptedPayload.local_uuid || id,
    room_id: room_id,
    sender_id: senderId,
    type,
    content,
    candidate,
    candidates,
    media_types,
    target_id,
    timestamp,
    status: 'sent',
    previous_msg_uuid: previousMsgUuid,
    created_at: created
  }

  // If media, extend the message with media metadata for easier rendering in the timeline
  if (type === 'media') {
    const { media_id, file_key, file_nonce, filename, mime_type, waveform_data, music_metadata, album_art, thumbnail, duration } = decryptedPayload
    decryptedMessage.media_id = media_id
    decryptedMessage.file_key = file_key
    decryptedMessage.file_nonce = file_nonce
    decryptedMessage.filename = filename
    decryptedMessage.mime_type = mime_type
    decryptedMessage.waveform_data = waveform_data
    decryptedMessage.music_metadata = music_metadata
    decryptedMessage.album_art = album_art
    decryptedMessage.thumbnail = thumbnail
    decryptedMessage.duration = duration

    // Also store in local_assets for the global archive
    await db.local_assets.put({
      id: media_id,
      media_id,
      room_id: room_id,
      message_id: decryptedMessage.local_uuid,
      filename,
      mime_type,
      file_key,
      file_nonce,
      created_at: created,
      music_metadata,
      album_art,
      thumbnail,
      duration
    })
  }

  if (type === 'link') {
    decryptedMessage.links = decryptedPayload.links
  }

  if (type !== 'ice_candidate') {
    await db.local_messages.put(decryptedMessage)
  }

  // Notify UI and resolve RPC.
  self.postMessage({
    type: 'db:new_local_data',
    payload: {
      room_id: room_id,
      message: decryptedMessage
    }
  })
  self.postMessage({
    id: rpcId,
    type: 'worker:process_incoming_message',
    result: { success: true }
  })
}

async function updateRoomMember (rpcId, record) {
  const { room_id, user_id, last_read_message_id, is_muted } = record

  const room = await db.local_rooms.get(room_id)
  if (room && room.participants) {
    const pIndex = room.participants.findIndex(p => p.id === user_id)
    if (pIndex !== -1) {
      if (last_read_message_id !== undefined) {
        room.participants[pIndex].last_read_message_id = last_read_message_id
      }
      if (is_muted !== undefined) {
        room.participants[pIndex].is_muted = is_muted
      }
      await db.local_rooms.put(room)

      self.postMessage({
        type: 'db:new_local_data',
        payload: { room_id }
      })

      self.postMessage({
        type: 'room:member_updated',
        payload: { room_id }
      })
    }
  }

  self.postMessage({
    id: rpcId,
    type: 'room:member_updated_RPC',
    result: { success: true }
  })
}

async function deleteLocalRoom (rpcId, payload) {
  const { room_id } = payload
  await db.local_messages.where('room_id').equals(room_id).delete()
  await db.local_assets.where('room_id').equals(room_id).delete()
  await db.local_rooms.delete(room_id)

  self.postMessage({
    type: 'db:room_deleted',
    payload: { room_id: room_id }
  })

  self.postMessage({
    id: rpcId,
    type: 'worker:delete_local_room',
    result: { success: true }
  })
}

async function updateUserData (rpcId, record) {
  const userId = record.id
  const { name, username, avatar } = record

  // Update publicKeyCache
  const existingKeys = publicKeyCache.get(userId)
  if (existingKeys) {
    publicKeyCache.set(userId, {
      ...existingKeys,
      name,
      username,
      avatar
    })
  }

  // Update all rooms where this user is a participant
  const rooms = await db.local_rooms.toArray()
  for (const room of rooms) {
    if (room.participants) {
      const pIndex = room.participants.findIndex(p => p.id === userId)
      if (pIndex !== -1) {
        room.participants[pIndex].name = name
        room.participants[pIndex].username = username
        room.participants[pIndex].avatar = avatar
        await db.local_rooms.put(room)

        self.postMessage({
          type: 'db:new_local_data',
          payload: { room_id: room.id }
        })

        self.postMessage({
          type: 'room:member_updated',
          payload: { room_id: room.id }
        })
      }
    }
  }

  self.postMessage({
    id: rpcId,
    type: 'worker:update_user_data',
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
    const response = await fetchWithTimeout(`${baseUrl}/api/collections/users/records/${wrapped_by}`, { headers })
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
  } catch {
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
  const roomResponse = await fetchWithTimeout(`${baseUrl}/api/collections/rooms/records/${room_id}`, { headers })
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

  // Fetch Room members with user details
  const membersUrl = `${baseUrl}/api/collections/room_members/records?filter=(room_id='${room_id}')&expand=user_id`
  const membersResponse = await fetchWithTimeout(membersUrl, { headers })
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
          last_read_message_id: m.last_read_message_id,
          is_muted: m.is_muted
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
    type: 'db:new_local_room',
    payload: { room_id }
  })
  self.postMessage({
    id: rpcId,
    type: 'worker:process_new_room_key',
    result: { success: true }
  })
}

readyPromise = init()
