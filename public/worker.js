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

let isProcessing = false
const messageQueue = []

async function init () {
  try {
    await sodium.ready

    db = new Dexie('AtollChatDB')
    db.version(1).stores({
      local_rooms: 'id, is_group',
      local_messages: 'id, room_id, [room_id+created_at], type',
      local_assets: 'id, room_id, mime_type, created_at'
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
  if (isProcessing || messageQueue.length === 0) return
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
    if (type === 'test-rpc') {
      self.postMessage({ id, type, payload, result: 'ACK' })
      return
    }

    if (type === 'generateSalt') {
      const salt = sodium.randombytes_buf(16)
      self.postMessage({ id, type, result: salt })
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
      self.postMessage({ id, type, result: KEK })
      return
    }

    // New task: PROCESS_INCOMING_MESSAGE
    if (type === 'PROCESS_INCOMING_MESSAGE') {
      await processIncomingMessage(id, payload)
      return
    }

    self.postMessage({ id, type, error: `Unknown task type: ${type}` })
  } catch (error) {
    self.postMessage({ id, type, error: error.message })
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
  let publicSignKey = publicKeyCache.get(senderId)
  if (!publicSignKey) {
    if (!baseUrl) throw new Error('Base URL not initialized')
    const response = await fetch(`${baseUrl}/api/collections/users/records/${senderId}`)
    if (!response.ok) throw new Error(`Failed to fetch sender public key: ${response.statusText}`)
    const userRecord = await response.json()
    publicSignKey = userRecord.public_sign_key
    publicKeyCache.set(senderId, publicSignKey)
  }

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
  if (!room) throw new Error(`Local room ${roomId} not found`)

  const activeEpoch = room.key_history?.find(h => h.epoch_id === epochId)
  if (!activeEpoch) throw new Error('Missing cryptographic key for this epoch.')

  const ciphertextBuffer = sodium.from_base64(ciphertext)
  const nonceBuffer = sodium.from_base64(nonce)
  const epochKeyBuffer = sodium.from_base64(activeEpoch.key)

  let decryptedBuffer
  try {
    decryptedBuffer = sodium.crypto_secretbox_open_easy(ciphertextBuffer, nonceBuffer, epochKeyBuffer)
  } catch (e) {
    throw new Error('Decryption failed')
  }

  if (!decryptedBuffer) throw new Error('Decryption failed (null result)')

  const decryptedString = new TextDecoder().decode(decryptedBuffer)
  const decryptedPayload = JSON.parse(decryptedString)
  const { type, content, timestamp } = decryptedPayload

  // 4. Storage & Causal Chain Resolution
  const decryptedMessage = {
    id,
    room_id: roomId,
    sender_id: senderId,
    type,
    content,
    timestamp,
    previous_msg_uuid: previousMsgUuid,
    created_at: created
  }

  await db.local_messages.put(decryptedMessage)

  // 5. Notify UI & Resolve RPC
  self.postMessage({ type: 'NEW_LOCAL_DATA', payload: { room_id: roomId } })
  self.postMessage({ id: rpcId, type: 'PROCESS_INCOMING_MESSAGE', result: { success: true } })
}

readyPromise = init()
