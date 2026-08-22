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
 *   Dexie: DexieConstructor,
 *   currentUserKeys: any,
 *   isInitialized: boolean,
 *   authToken: string | null,
 *   publicKeyCache: Map<string, any>
 * }} WorkerScope
 */

/**
 * @typedef {any} WebWorkerBlobPart
 */

/** @type {any} */
const rawSelf = self
/** @type {WorkerScope} */
const workerSelf = rawSelf

function getTransferables (obj, seen = new Set()) {
  if (!obj || typeof obj !== 'object') {
    return []
  }
  if (seen.has(obj)) {
    return []
  }
  seen.add(obj)

  const transferables = []

  if (obj instanceof ArrayBuffer) {
    transferables.push(obj)
  } else if (ArrayBuffer.isView(obj) && obj.buffer instanceof ArrayBuffer) {
    transferables.push(obj.buffer)
  } else {
    try {
      const keys = Object.keys(obj)
      for (let i = 0; i < keys.length; i++) {
        const val = obj[keys[i]]
        if (val && typeof val === 'object') {
          transferables.push(...getTransferables(val, seen))
        }
      }
    } catch (_) {
      // ignore non-serializable properties or errors
    }
  }

  return Array.from(new Set(transferables))
}

const nativePostMessage = self.postMessage
self.postMessage = function (message, transferOrOptions) {
  const transferables = getTransferables(message)
  let explicitTransfer = []
  if (Array.isArray(transferOrOptions)) {
    explicitTransfer = transferOrOptions
  } else if (transferOrOptions && typeof transferOrOptions === 'object') {
    if (Array.isArray(transferOrOptions.transfer)) {
      explicitTransfer = transferOrOptions.transfer
    }
  }
  for (const t of explicitTransfer) {
    if (t instanceof ArrayBuffer && !transferables.includes(t)) {
      transferables.push(t)
    }
  }
  if (transferables.length > 0) {
    if (transferOrOptions && typeof transferOrOptions === 'object' && !Array.isArray(transferOrOptions)) {
      nativePostMessage.call(self, message, {
        ...transferOrOptions,
        transfer: transferables
      })
    } else {
      nativePostMessage.call(self, message, { transfer: transferables })
    }
  } else {
    nativePostMessage.call(self, message, transferOrOptions)
  }
}

/* global importScripts */
importScripts('/assets/libsodium-sumo.js')
importScripts('/assets/libsodium-wrappers.js')
importScripts('/assets/worker-bridge.js')
importScripts('/assets/url.js')

const sodium = workerSelf.sodium
const workerBridge = workerSelf.workerBridge

/**
 * The Worker Script for Atoll Chat
 * Handles heavy cryptographic operations off the main thread.
 */

let baseUrl
let isProcessing = false
const messageQueue = []

let currentUserKeys = null
let isInitialized = false
let authToken = null
const publicKeyCache = new Map()
const pendingKeyReplayBuffer = new Map()

Object.defineProperty(self, 'currentUserKeys', {
  get () {
    return currentUserKeys
  },
  set (val) {
    currentUserKeys = val
  }
})

Object.defineProperty(self, 'isInitialized', {
  get () {
    return isInitialized
  },
  set (val) {
    isInitialized = val
  }
})

Object.defineProperty(self, 'authToken', {
  get () {
    return authToken
  },
  set (val) {
    authToken = val
  }
})

Object.defineProperty(self, 'publicKeyCache', {
  get () {
    return publicKeyCache
  },
  set (val) {
    if (val instanceof Map) {
      publicKeyCache.clear()
      for (const [k, v] of val.entries()) {
        publicKeyCache.set(k, v)
      }
    }
  }
})

async function init () {
  try {
    await sodium.ready
    self.postMessage({ type: 'worker:ready' })
  } catch (err) {
    console.error('Worker Init Error:', err)
  }
}

self.onmessage = (event) => {
  const { type } = event.data
  console.log('[worker] Received message:', type)

  /* parallelizable tasks */
  const parallelTasks = [
    'worker:check_ready',
    'worker:test_rpc',
    'worker:generate_salt',
    'worker:process_incoming_message',
    'worker:decrypt_file',
    'worker:decrypt_link_preview',
    'worker:process_new_room_key',
    'worker:flush_pending_messages',
    'room:member_updated',
    'room:settings_updated',
    'room:state_updated',
    'worker:delete_local_room',
    'worker:generate_master_keys',
    'worker:encrypt_master_key_with_kek',
    'worker:encrypt_master_key_with_code',
    'worker:decrypt_master_key_with_code',
    'worker:decrypt_vault',
    'worker:crypto_box_seal',
    'worker:crypto_box_seal_open',
    'worker:clear_local_history'
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
    const { id, type } = event.data
    if (id) {
      self.postMessage({
        id,
        type,
        error: err.message
      })
    }
  } finally {
    isProcessing = false
    processQueue()
  }
}

async function handleEvent (event) {
  const { id, type, payload } = event.data

  // handle worker:ready check if sent from main thread
  if (type === 'worker:check_ready') {
    self.postMessage({ type: 'worker:ready' })
    return
  }

  if (type === 'worker:init') {
    baseUrl = payload.baseUrl
    return
  }

  if (type === 'worker:set_token') {
    self.authToken = payload.token
    self.postMessage({
      id,
      type,
      result: 'ACK'
    })
    return
  }

  try {
    if (type === 'worker:init_keys') {
      self.currentUserKeys = { ...payload }
      if (payload.private_box_key) {
        self.currentUserKeys.private_box_key_raw = sodium.from_base64(payload.private_box_key, sodium.base64_variants.ORIGINAL)
      }
      if (payload.private_sign_key) {
        self.currentUserKeys.private_sign_key_raw = sodium.from_base64(payload.private_sign_key, sodium.base64_variants.ORIGINAL)
      }
      if (self.activeVmk) {
        self.currentUserKeys.vmk = self.activeVmk
      }
      self.isInitialized = true
      console.log('[worker] Keys initialized for user:', self.currentUserKeys.id)
      self.postMessage({
        id,
        type,
        result: 'ACK'
      })
      /* Broadcast ready state */
      self.postMessage({
        type: 'worker:initialized',
        payload: { userId: self.currentUserKeys.id }
      })
      return
    }

    if (type === 'worker:generate_master_keys') {
      const masterKey = sodium.randombytes_buf(32)
      const encryptionKeys = sodium.crypto_box_keypair()
      const identityKeys = sodium.crypto_sign_keypair()

      const privateKeysPlaintext = JSON.stringify({
        private_box_key: sodium.to_base64(encryptionKeys.privateKey, sodium.base64_variants.ORIGINAL),
        private_sign_key: sodium.to_base64(identityKeys.privateKey, sodium.base64_variants.ORIGINAL)
      })

      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
      const encryptedPrivateKeys = sodium.crypto_secretbox_easy(privateKeysPlaintext, nonce, masterKey)

      const result = {
        public_box_key: sodium.to_base64(encryptionKeys.publicKey, sodium.base64_variants.ORIGINAL),
        public_sign_key: sodium.to_base64(identityKeys.publicKey, sodium.base64_variants.ORIGINAL),
        master_key: sodium.to_base64(masterKey, sodium.base64_variants.ORIGINAL),
        encrypted_private_keys: {
          ciphertext: sodium.to_base64(encryptedPrivateKeys, sodium.base64_variants.ORIGINAL),
          nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
        }
      }
      self.postMessage({
        id,
        type,
        result
      })
      return
    }

    if (type === 'worker:encrypt_master_key_with_kek') {
      const { master_key, KEK } = payload
      let masterKeyBuffer = null
      let kekBuffer = null
      let nonce = null
      try {
        masterKeyBuffer = typeof master_key === 'string' ? sodium.from_base64(master_key, sodium.base64_variants.ORIGINAL) : master_key
        kekBuffer = typeof KEK === 'string' ? sodium.from_base64(KEK, sodium.base64_variants.ORIGINAL) : KEK

        nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
        const ciphertext = sodium.crypto_secretbox_easy(masterKeyBuffer, nonce, kekBuffer)

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
      } finally {
        if (masterKeyBuffer && typeof masterKeyBuffer.fill === 'function') {
          masterKeyBuffer.fill(0)
        }
        if (kekBuffer && typeof kekBuffer.fill === 'function') {
          kekBuffer.fill(0)
        }
        if (nonce && typeof nonce.fill === 'function') {
          nonce.fill(0)
        }
      }
    }

    if (type === 'worker:encrypt_master_key_with_code') {
      const { master_key, code } = payload
      let masterKeyBuffer = null
      let codeHash = null
      let nonce = null
      let authProofBytes = null
      let verifierBytes = null
      try {
        masterKeyBuffer = typeof master_key === 'string' ? sodium.from_base64(master_key, sodium.base64_variants.ORIGINAL) : master_key

        codeHash = sodium.crypto_generichash(32, code)
        authProofBytes = sodium.crypto_hash_sha256(sodium.from_string('atoll-recovery-auth:' + code))
        const authProofStr = sodium.to_base64(authProofBytes, sodium.base64_variants.ORIGINAL)
        verifierBytes = sodium.crypto_hash_sha256(sodium.from_string('atoll-recovery-verifier:' + authProofStr))

        nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
        const ciphertext = sodium.crypto_secretbox_easy(masterKeyBuffer, nonce, codeHash)

        const result = {
          verifier: sodium.to_base64(verifierBytes, sodium.base64_variants.ORIGINAL),
          ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
          nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
        }
        self.postMessage({
          id,
          type,
          result
        })
        return
      } finally {
        if (masterKeyBuffer && typeof masterKeyBuffer.fill === 'function') {
          masterKeyBuffer.fill(0)
        }
        if (codeHash && typeof codeHash.fill === 'function') {
          codeHash.fill(0)
        }
        if (nonce && typeof nonce.fill === 'function') {
          nonce.fill(0)
        }
        if (authProofBytes && typeof authProofBytes.fill === 'function') {
          authProofBytes.fill(0)
        }
        if (verifierBytes && typeof verifierBytes.fill === 'function') {
          verifierBytes.fill(0)
        }
      }
    }

    if (type === 'worker:decrypt_master_key_with_code') {
      const { code, wrap } = payload
      let codeHash = null
      let cipherBytes = null
      let nonceBytes = null
      let decrypted = null
      let authProofBytes = null
      try {
        codeHash = sodium.crypto_generichash(32, code)
        cipherBytes = sodium.from_base64(wrap.ciphertext, sodium.base64_variants.ORIGINAL)
        nonceBytes = sodium.from_base64(wrap.nonce, sodium.base64_variants.ORIGINAL)

        decrypted = sodium.crypto_secretbox_open_easy(
          cipherBytes,
          nonceBytes,
          codeHash
        )

        if (!decrypted) {
          throw new Error('Failed to decrypt master key. Invalid recovery code.')
        }

        authProofBytes = sodium.crypto_hash_sha256(sodium.from_string('atoll-recovery-auth:' + code))
        const authProof = sodium.to_base64(authProofBytes, sodium.base64_variants.ORIGINAL)

        const result = {
          master_key: sodium.to_base64(decrypted, sodium.base64_variants.ORIGINAL),
          auth_proof: authProof
        }
        self.postMessage({
          id,
          type,
          result
        })
        return
      } finally {
        if (codeHash && typeof codeHash.fill === 'function') {
          codeHash.fill(0)
        }
        if (cipherBytes && typeof cipherBytes.fill === 'function') {
          cipherBytes.fill(0)
        }
        if (nonceBytes && typeof nonceBytes.fill === 'function') {
          nonceBytes.fill(0)
        }
        if (decrypted && typeof decrypted.fill === 'function') {
          decrypted.fill(0)
        }
        if (authProofBytes && typeof authProofBytes.fill === 'function') {
          authProofBytes.fill(0)
        }
      }
    }

    if (type === 'worker:decrypt_vault') {
      const { encrypted_private_keys, master_key } = payload
      let masterKeyBuffer = null
      let cipherBytes = null
      let nonceBytes = null
      let decrypted = null
      try {
        masterKeyBuffer = typeof master_key === 'string' ? sodium.from_base64(master_key, sodium.base64_variants.ORIGINAL) : master_key

        self.activeVmk = masterKeyBuffer

        cipherBytes = sodium.from_base64(encrypted_private_keys.ciphertext, sodium.base64_variants.ORIGINAL)
        nonceBytes = sodium.from_base64(encrypted_private_keys.nonce, sodium.base64_variants.ORIGINAL)

        decrypted = sodium.crypto_secretbox_open_easy(
          cipherBytes,
          nonceBytes,
          masterKeyBuffer
        )

        if (!decrypted) {
          throw new Error('Failed to decrypt vault with master key.')
        }

        const result = JSON.parse(sodium.to_string(decrypted))
        self.postMessage({
          id,
          type,
          result
        })
        return
      } finally {
        if (cipherBytes && typeof cipherBytes.fill === 'function') {
          cipherBytes.fill(0)
        }
        if (nonceBytes && typeof nonceBytes.fill === 'function') {
          nonceBytes.fill(0)
        }
        if (decrypted && typeof decrypted.fill === 'function') {
          decrypted.fill(0)
        }
      }
    }

    if (type === 'worker:decrypt_file') {
      const { encryptedBuffer, nonce, key } = payload
      let fileBytes = null
      let nonceBytes = null
      let rawKey = null
      try {
        fileBytes = encryptedBuffer instanceof Uint8Array ? encryptedBuffer : new Uint8Array(encryptedBuffer)
        nonceBytes = typeof nonce === 'string' ? sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL) : nonce
        rawKey = typeof key === 'string' ? parseKey(key) : key

        const decryptedBuffer = sodium.crypto_secretbox_open_easy(
          fileBytes,
          nonceBytes,
          rawKey
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
      } finally {
        if (fileBytes && typeof fileBytes.fill === 'function') {
          fileBytes.fill(0)
        }
        if (nonceBytes && typeof nonceBytes.fill === 'function') {
          nonceBytes.fill(0)
        }
        if (rawKey && typeof rawKey.fill === 'function') {
          rawKey.fill(0)
        }
      }
    }

    if (type === 'worker:decrypt_link_preview') {
      const { encryptedBuffer, nonce, key } = payload
      let rawKeyBytes = null
      let ivBytes = null
      let cipherBytes = null
      let nonceBytes = null
      let decryptedBuffer = null

      try {
        if (nonce === 'AES-GCM') {
          const encBytes = new Uint8Array(encryptedBuffer)
          const base64Text = new TextDecoder().decode(encBytes).trim()
          const binaryString = self.atob(base64Text.replace(/-/g, '+').replace(/_/g, '/'))
          const len = binaryString.length
          const bytes = new Uint8Array(len)
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          ivBytes = bytes.slice(0, 12)
          cipherBytes = bytes.slice(12)

          rawKeyBytes = new TextEncoder().encode(key)
          const cryptoKey = await self.crypto.subtle.importKey(
            'raw',
            rawKeyBytes,
            { name: 'AES-GCM' },
            false,
            ['decrypt']
          )

          const decryptedArrayBuffer = await self.crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: ivBytes
            },
            cryptoKey,
            cipherBytes
          )
          decryptedBuffer = new Uint8Array(decryptedArrayBuffer)
        } else {
          cipherBytes = encryptedBuffer instanceof Uint8Array ? encryptedBuffer : new Uint8Array(encryptedBuffer)
          nonceBytes = typeof nonce === 'string' ? sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL) : nonce
          rawKeyBytes = typeof key === 'string' ? parseKey(key) : key

          decryptedBuffer = sodium.crypto_secretbox_open_easy(
            cipherBytes,
            nonceBytes,
            rawKeyBytes
          )
        }

        if (!decryptedBuffer) {
          throw new Error('Decryption failed')
        }

        self.postMessage({
          id,
          type,
          result: decryptedBuffer
        }, decryptedBuffer && decryptedBuffer.buffer ? { transfer: [decryptedBuffer.buffer] } : undefined)
        return
      } finally {
        if (rawKeyBytes && typeof rawKeyBytes.fill === 'function') {
          rawKeyBytes.fill(0)
        }
        if (ivBytes && typeof ivBytes.fill === 'function') {
          ivBytes.fill(0)
        }
        if (cipherBytes && typeof cipherBytes.fill === 'function') {
          cipherBytes.fill(0)
        }
        if (nonceBytes && typeof nonceBytes.fill === 'function') {
          nonceBytes.fill(0)
        }
      }
    }

    if (type === 'worker:wipe_keys') {
      if (self.currentUserKeys) {
        if (self.currentUserKeys.private_box_key_raw) {
          self.currentUserKeys.private_box_key_raw.fill(0)
        }
        if (self.currentUserKeys.private_sign_key_raw) {
          self.currentUserKeys.private_sign_key_raw.fill(0)
        }
        if (self.currentUserKeys.vmk) {
          self.currentUserKeys.vmk.fill(0)
        }
        self.currentUserKeys = null
      }
      if (self.activeVmk) {
        self.activeVmk.fill(0)
        self.activeVmk = null
      }
      self.isInitialized = false
      self.authToken = null
      self.publicKeyCache.clear()
      pendingKeyReplayBuffer.clear()

      if (globalThis.gc) {
        globalThis.gc()
      }

      self.postMessage({
        id,
        type,
        result: 'ACK'
      })
      return
    }

    if (type === 'worker:clear_local_history') {
      pendingKeyReplayBuffer.clear()
      self.postMessage({
        id,
        type,
        result: { success: true }
      })
      return
    }

    if (type === 'worker:get_init_state') {
      self.postMessage({
        id,
        type,
        result: {
          isInitialized: self.isInitialized,
          userId: self.currentUserKeys?.id
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

    if (type === 'worker:crypto_box_seal') {
      const { message, publicKey } = payload
      let msgBytes = null
      let pubKeyBytes = null
      try {
        msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : new Uint8Array(message)
        pubKeyBytes = typeof publicKey === 'string' ? sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL) : publicKey

        const ciphertext = sodium.crypto_box_seal(msgBytes, pubKeyBytes)
        const result = sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL)

        self.postMessage({
          id,
          type,
          result
        })
        return
      } finally {
        if (msgBytes && typeof msgBytes.fill === 'function') {
          msgBytes.fill(0)
        }
        if (pubKeyBytes && typeof pubKeyBytes.fill === 'function') {
          pubKeyBytes.fill(0)
        }
      }
    }

    if (type === 'worker:crypto_box_seal_open') {
      const { ciphertext, publicKey, privateKey } = payload
      let cipherBytes = null
      let pubKeyBytes = null
      let privKeyBytes = null
      let decrypted = null
      try {
        cipherBytes = typeof ciphertext === 'string' ? sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL) : new Uint8Array(ciphertext)
        pubKeyBytes = typeof publicKey === 'string' ? sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL) : publicKey
        privKeyBytes = typeof privateKey === 'string' ? sodium.from_base64(privateKey, sodium.base64_variants.ORIGINAL) : privateKey

        decrypted = sodium.crypto_box_seal_open(cipherBytes, pubKeyBytes, privKeyBytes)
        const result = sodium.to_string(decrypted)

        self.postMessage({
          id,
          type,
          result
        })
        return
      } finally {
        if (cipherBytes && typeof cipherBytes.fill === 'function') {
          cipherBytes.fill(0)
        }
        if (pubKeyBytes && typeof pubKeyBytes.fill === 'function') {
          pubKeyBytes.fill(0)
        }
        if (privKeyBytes && typeof privKeyBytes.fill === 'function') {
          privKeyBytes.fill(0)
        }
        if (decrypted && typeof decrypted.fill === 'function') {
          decrypted.fill(0)
        }
      }
    }

    if (type === 'worker:generate_salt') {
      const salt = sodium.randombytes_buf(16)
      self.postMessage({
        id,
        type,
        result: salt
      }, { transfer: [salt.buffer] })
      return
    }

    const parseKey = (k) => {
      if (typeof k !== 'string') {
        return k
      }
      if (/^[0-9a-fA-F]{64}$/.test(k)) {
        return sodium.from_hex(k)
      }
      return sodium.from_base64(k, sodium.base64_variants.ORIGINAL)
    }

    // low-level libsodium primitives
    if (type === 'worker:crypto_secretbox_easy') {
      const { message, nonce, key } = payload
      let msgBytes = null
      let nonceBytes = null
      let keyBytes = null
      try {
        msgBytes = typeof message === 'string' ? message : new Uint8Array(message)
        nonceBytes = typeof nonce === 'string' ? sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL) : nonce
        keyBytes = parseKey(key)

        const result = sodium.crypto_secretbox_easy(
          msgBytes,
          nonceBytes,
          keyBytes
        )
        self.postMessage({
          id,
          type,
          result
        }, result && result.buffer ? { transfer: [result.buffer] } : undefined)
        return
      } finally {
        if (msgBytes && typeof msgBytes.fill === 'function') {
          msgBytes.fill(0)
        }

        if (nonceBytes && typeof nonceBytes.fill === 'function') {
          nonceBytes.fill(0)
        }

        if (keyBytes && typeof keyBytes.fill === 'function') {
          keyBytes.fill(0)
        }
      }
    }

    if (type === 'worker:crypto_secretbox_open_easy') {
      const { ciphertext, nonce, key } = payload
      let cipherBytes = null
      let nonceBytes = null
      let keyBytes = null
      try {
        cipherBytes = typeof ciphertext === 'string' ? sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL) : new Uint8Array(ciphertext)
        nonceBytes = typeof nonce === 'string' ? sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL) : nonce
        keyBytes = parseKey(key)

        const result = sodium.crypto_secretbox_open_easy(
          cipherBytes,
          nonceBytes,
          keyBytes
        )
        self.postMessage({
          id,
          type,
          result
        }, result && result.buffer ? { transfer: [result.buffer] } : undefined)
        return
      } finally {
        if (cipherBytes && typeof cipherBytes.fill === 'function') {
          cipherBytes.fill(0)
        }
        if (nonceBytes && typeof nonceBytes.fill === 'function') {
          nonceBytes.fill(0)
        }
        if (keyBytes && typeof keyBytes.fill === 'function') {
          keyBytes.fill(0)
        }
      }
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
      }, result && result.buffer ? { transfer: [result.buffer] } : undefined)
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
      }, result && result.buffer ? { transfer: [result.buffer] } : undefined)
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
      }, result && result.buffer ? { transfer: [result.buffer] } : undefined)
      return
    }

    if (type === 'worker:randombytes_buf') {
      const { length } = payload
      const result = sodium.randombytes_buf(length)
      self.postMessage({
        id,
        type,
        result
      }, { transfer: [result.buffer] })
      return
    }

    // high-level tasks

    if (type === 'worker:upload_media') {
      let fileBuffer = null
      let fileKey = null
      let fileNonce = null
      let encryptedFile = null
      try {
        const { file } = payload
        fileBuffer = new Uint8Array(await file.arrayBuffer())
        fileKey = sodium.randombytes_buf(32)
        fileNonce = sodium.randombytes_buf(24)
        encryptedFile = sodium.crypto_secretbox_easy(fileBuffer, fileNonce, fileKey)

        const mainParts = [encryptedFile]
        const mainBlob = new Blob(mainParts, { type: 'application/octet-stream' })
        const mainFormData = new FormData()
        mainFormData.append('file', mainBlob, 'encrypted.bin')

        const headers = {}
        if (self.authToken) {
          headers.Authorization = self.authToken
        }

        const mainResponse = await fetchWithTimeout(`${baseUrl}/api/collections/media/records`, {
          method: 'POST',
          headers,
          body: mainFormData
        })
        if (!mainResponse.ok) {
          throw new Error(`Failed to upload media: ${mainResponse.status}`)
        }
        const mainRecord = await mainResponse.json()
        self.postMessage({
          id,
          type,
          result: {
            media_id: mainRecord.id,
            file_key: sodium.to_base64(fileKey, sodium.base64_variants.ORIGINAL),
            file_nonce: sodium.to_base64(fileNonce, sodium.base64_variants.ORIGINAL)
          }
        })
      } catch (err) {
        self.postMessage({
          id,
          type,
          error: err.message
        })
      } finally {
        if (fileBuffer && typeof fileBuffer.fill === 'function') {
          fileBuffer.fill(0)
        }
        if (fileKey && typeof fileKey.fill === 'function') {
          fileKey.fill(0)
        }
        if (fileNonce && typeof fileNonce.fill === 'function') {
          fileNonce.fill(0)
        }
        if (encryptedFile && typeof encryptedFile.fill === 'function') {
          encryptedFile.fill(0)
        }
      }
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

    if (type === 'worker:flush_pending_messages') {
      await flushAllPendingMessages()
      self.postMessage({
        id,
        type,
        result: { success: true }
      })
      return
    }

    if (type === 'room:member_updated') {
      await updateRoomMember(id, payload)
      return
    }

    if (type === 'room:settings_updated') {
      await updateRoomSettings(id, payload)
      return
    }

    if (type === 'room:state_updated') {
      await updateRoomState(id, payload)
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
    console.error('[worker] Unhandled error during task processing:', type, error)
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
  const normalizedResource = workerSelf.normalizeUrl(resource)
  const { timeout = 15000 } = options

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(normalizedResource, {
      ...options,
      signal: controller.signal
    })
    return response
  } finally {
    clearTimeout(id)
  }
}

async function sendMessage (rpcId, payload) {
  console.info('[worker] Alice sendMessage payload:', payload)
  let roomKey = null
  let privateSignKeyBuffer = null
  let artKey = null
  let artNonce = null
  let thumbKey = null
  let thumbNonce = null
  let fileKey = null
  let fileNonce = null
  let artBuffer = null
  let thumbBuffer = null
  let fileBuffer = null

  try {
    const {
      room_id,
      localUuid,
      type,
      content,
      call_id,
      caller_id,
      reason,
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
      thumbnail: existingThumbnail,
      transfer_mode,
      status,
      p2pUuid
    } = payload

    console.info('[worker] Alice sendMessage variables destructured:', {
      type,
      hasFile: !!file,
      existingMediaId,
      transfer_mode,
      status
    })

    if (!self.currentUserKeys || !self.currentUserKeys.private_sign_key) {
      throw new Error('User identity keys not found in worker')
    }

    const room = await workerBridge.request('getRoom', [room_id])
    if (!room || !room.key_history || room.key_history.length === 0) {
      throw new Error('Encryption keys not found for this room')
    }

    const latestKeyObj = room.key_history.reduce((prev, current) => {
      const prevEpoch = parseInt(prev.epoch_id, 10)
      const currEpoch = parseInt(current.epoch_id, 10)
      return (prevEpoch > currEpoch) ? prev : current
    })
    const latestEpochId = latestKeyObj.epoch_id
    roomKey = sodium.from_base64(latestKeyObj.key, sodium.base64_variants.ORIGINAL)

    // Handle Media Encryption & Upload
    let mediaId = existingMediaId || null
    let fileKeyBase64 = existingFileKey || null
    let fileNonceBase64 = existingFileNonce || null
    let albumArtInfo = existingAlbumArt || null
    let thumbnailInfo = existingThumbnail || null
    let encryptedAttachments = null

    const headers = {}
    if (self.authToken) {
      headers.Authorization = self.authToken
    }

    if (type === 'media' && Array.isArray(payload.attachments) && payload.attachments.length > 0) {
      encryptedAttachments = []
      for (const att of payload.attachments) {
        let attMediaId = att.media_id || null
        let attFileKeyBase64 = att.file_key || null
        let attFileNonceBase64 = att.file_nonce || null
        let attAlbumArtInfo = att.album_art || null
        let attThumbnailInfo = att.thumbnail || null

        // Encrypt and upload album art if present
        if (att.album_art_blob && !attAlbumArtInfo) {
          const aBuf = new Uint8Array(await att.album_art_blob.arrayBuffer())
          const aKey = sodium.randombytes_buf(32)
          const aNonce = sodium.randombytes_buf(24)
          const encArt = sodium.crypto_secretbox_easy(aBuf, aNonce, aKey)

          const artBlob = new Blob([encArt], { type: 'application/octet-stream' })
          const artFormData = new FormData()
          artFormData.append('file', artBlob, 'album-art.bin')

          const artResponse = await fetchWithTimeout(`${baseUrl}/api/collections/media/records`, {
            method: 'POST',
            headers,
            body: artFormData
          })
          if (artResponse.ok) {
            const artRecord = await artResponse.json()
            attAlbumArtInfo = {
              media_id: artRecord.id,
              file_key: sodium.to_base64(aKey, sodium.base64_variants.ORIGINAL),
              file_nonce: sodium.to_base64(aNonce, sodium.base64_variants.ORIGINAL)
            }
          }
        }

        // Encrypt and upload thumbnail if present
        if (att.thumbnail_blob && !attThumbnailInfo) {
          const tBuf = new Uint8Array(await att.thumbnail_blob.arrayBuffer())
          const tKey = sodium.randombytes_buf(32)
          const tNonce = sodium.randombytes_buf(24)
          const encThumb = sodium.crypto_secretbox_easy(tBuf, tNonce, tKey)

          const thumbBlob = new Blob([encThumb], { type: 'application/octet-stream' })
          const thumbFormData = new FormData()
          thumbFormData.append('file', thumbBlob, 'thumbnail.bin')

          const thumbResponse = await fetchWithTimeout(`${baseUrl}/api/collections/media/records`, {
            method: 'POST',
            headers,
            body: thumbFormData
          })
          if (thumbResponse.ok) {
            const thumbRecord = await thumbResponse.json()
            attThumbnailInfo = {
              media_id: thumbRecord.id,
              file_key: sodium.to_base64(tKey, sodium.base64_variants.ORIGINAL),
              file_nonce: sodium.to_base64(tNonce, sodium.base64_variants.ORIGINAL),
              mime_type: 'image/webp'
            }
          }
        }

        // Encrypt and upload main file
        if (att.file && !attMediaId) {
          const fBuf = new Uint8Array(await att.file.arrayBuffer())
          const fKey = sodium.randombytes_buf(32)
          const fNonce = sodium.randombytes_buf(24)
          const encFile = sodium.crypto_secretbox_easy(fBuf, fNonce, fKey)

          attFileKeyBase64 = sodium.to_base64(fKey, sodium.base64_variants.ORIGINAL)
          attFileNonceBase64 = sodium.to_base64(fNonce, sodium.base64_variants.ORIGINAL)

          if (att.transfer_mode === 'p2p') {
            const encBlob = new Blob([encFile], { type: 'application/octet-stream' })
            const attUuid = att.id || crypto.randomUUID()
            await workerBridge.request('saveFile', [attUuid, encBlob])
            attMediaId = attUuid
          } else {
            const mainBlob = new Blob([encFile], { type: 'application/octet-stream' })
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
            attMediaId = mainRecord.id
          }
        }

        encryptedAttachments.push({
          id: att.id || attMediaId,
          media_id: attMediaId,
          file_key: attFileKeyBase64,
          file_nonce: attFileNonceBase64,
          filename: att.filename,
          mime_type: att.mime_type,
          waveform_data: att.waveform_data,
          music_metadata: att.music_metadata,
          album_art: attAlbumArtInfo,
          thumbnail: attThumbnailInfo,
          duration: att.duration,
          isVideo: att.isVideo,
          isAudio: att.isAudio,
          isImage: att.isImage,
          transfer_mode: att.transfer_mode
        })
      }
    } else if (type === 'media' && file && !mediaId) {
      // Encrypt and upload album art if present
      if (album_art_blob) {
        artBuffer = new Uint8Array(await album_art_blob.arrayBuffer())
        artKey = sodium.randombytes_buf(32)
        artNonce = sodium.randombytes_buf(24)
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
        thumbBuffer = new Uint8Array(await thumbnail_blob.arrayBuffer())
        thumbKey = sodium.randombytes_buf(32)
        thumbNonce = sodium.randombytes_buf(24)
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
      fileBuffer = new Uint8Array(await file.arrayBuffer())
      fileKey = sodium.randombytes_buf(32)
      fileNonce = sodium.randombytes_buf(24)
      const encryptedFile = sodium.crypto_secretbox_easy(fileBuffer, fileNonce, fileKey)

      fileKeyBase64 = sodium.to_base64(fileKey, sodium.base64_variants.ORIGINAL)
      fileNonceBase64 = sodium.to_base64(fileNonce, sodium.base64_variants.ORIGINAL)

      if (transfer_mode === 'p2p') {
        const encryptedBlob = new Blob([encryptedFile], { type: 'application/octet-stream' })
        await workerBridge.request('saveFile', [localUuid, encryptedBlob])
        mediaId = localUuid
      } else {
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
      }
    }

    // Construct Plaintext
    const plaintextObj = {
      local_uuid: localUuid,
      type,
      content,
      call_id,
      caller_id,
      reason,
      candidate,
      candidates,
      media_types,
      target_id,
      p2pUuid,
      timestamp: timestamp || Date.now()
    }

    if (type === 'link') {
      plaintextObj.links = links
    }

    if (type === 'media') {
      if (encryptedAttachments) {
        plaintextObj.attachments = encryptedAttachments
      } else {
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
        plaintextObj.transfer_mode = transfer_mode
      }
      plaintextObj.status = status || 'sent'

      console.info('[worker] plaintextObj inside media block:', {
        media_id: plaintextObj.media_id,
        file_key: plaintextObj.file_key,
        transfer_mode: plaintextObj.transfer_mode,
        status: plaintextObj.status
      })
      console.info('[worker] local variables inside media block:', {
        mediaId,
        fileKeyBase64,
        transfer_mode,
        status
      })
    }

    const plaintextStr = JSON.stringify(plaintextObj)

    // Encrypt Message
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
    const ciphertextBuffer = sodium.crypto_secretbox_easy(plaintextStr, nonce, roomKey)
    const ciphertextBase64 = sodium.to_base64(ciphertextBuffer, sodium.base64_variants.ORIGINAL)
    const nonceBase64 = sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)

    // fetch causal link
    const lastMsg = await workerBridge.request('getAbsoluteLatestMessage', [room_id])
    const previousMsgId = lastMsg ? (lastMsg.id || lastMsg.local_uuid) : 'START'

    // Sign Message
    const validationString = `${room_id}|${latestEpochId}|${previousMsgId}|${ciphertextBase64}|${nonceBase64}`
    const validationBuffer = new TextEncoder().encode(validationString)
    privateSignKeyBuffer = sodium.from_base64(self.currentUserKeys.private_sign_key, sodium.base64_variants.ORIGINAL)
    const signatureBuffer = sodium.crypto_sign_detached(validationBuffer, privateSignKeyBuffer)

    // Server upload
    const uploadPayload = {
      room_id: room_id,
      sender_id: self.currentUserKeys.id,
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

    const isEphemeral = ['ice_candidate', 'call_offer', 'call_answer', 'call_end', 'p2p_transfer_request', 'p2p_accept', 'p2p_rejected', 'p2p_request_offer', 'p2p_offer', 'p2p_answer', 'p2p_ice_candidate'].includes(type) || payload.ephemeral

    if (isEphemeral) {
      self.postMessage({
        type: 'db:new_local_data',
        payload: {
          room_id,
          message: {
            local_uuid: localUuid,
            id: pbRecord.id,
            room_id,
            sender_id: self.currentUserKeys.id,
            type,
            content,
            call_id,
            caller_id,
            reason,
            candidate,
            candidates,
            media_types,
            target_id,
            p2pUuid,
            timestamp: timestamp || Date.now(),
            ephemeral: true,
            created_at: pbRecord.created
          }
        }
      })
    } else {
      const updateData = {
        id: pbRecord.id,
        status: status || 'sent',
        transfer_mode,
        created_at: pbRecord.created
      }

      if (type === 'media') {
        if (encryptedAttachments) {
          updateData.attachments = encryptedAttachments
          for (const att of encryptedAttachments) {
            if (att.media_id) {
              await workerBridge.request('saveAsset', [{
                id: att.media_id,
                media_id: att.media_id,
                room_id,
                message_id: localUuid,
                filename: att.filename,
                mime_type: att.mime_type,
                file_key: att.file_key,
                file_nonce: att.file_nonce,
                created_at: pbRecord.created,
                music_metadata: att.music_metadata,
                album_art: att.album_art,
                thumbnail: att.thumbnail,
                duration: att.duration
              }])
            }
          }
        } else {
          updateData.media_id = mediaId || localUuid
          updateData.file_key = fileKeyBase64
          updateData.file_nonce = fileNonceBase64
          updateData.filename = filename
          updateData.mime_type = mime_type
          updateData.album_art = albumArtInfo
          updateData.thumbnail = thumbnailInfo
          updateData.duration = duration

          await workerBridge.request('saveAsset', [{
            id: mediaId || localUuid,
            media_id: mediaId || localUuid,
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
          }])
        }
      }

      let existing = null
      if (type !== 'ice_candidate') {
        existing = await workerBridge.request('getMessage', [localUuid])
        if (existing) {
          await workerBridge.request('updateMessage', [localUuid, updateData, room_id])
        } else {
          existing = {
            local_uuid: localUuid,
            room_id: room_id,
            sender_id: self.currentUserKeys.id,
            type,
            content,
            target_id,
            ...updateData
          }
          await workerBridge.request('saveMessage', [existing])
        }
      }
    }

    self.postMessage({
      id: rpcId,
      type: 'worker:send_message',
      result: {
        success: true,
        id: pbRecord.id
      }
    })
  } finally {
    if (roomKey && typeof roomKey.fill === 'function') {
      roomKey.fill(0)
    }
    if (privateSignKeyBuffer && typeof privateSignKeyBuffer.fill === 'function') {
      privateSignKeyBuffer.fill(0)
    }
    if (artKey && typeof artKey.fill === 'function') {
      artKey.fill(0)
    }
    if (artNonce && typeof artNonce.fill === 'function') {
      artNonce.fill(0)
    }
    if (thumbKey && typeof thumbKey.fill === 'function') {
      thumbKey.fill(0)
    }
    if (thumbNonce && typeof thumbNonce.fill === 'function') {
      thumbNonce.fill(0)
    }
    if (fileKey && typeof fileKey.fill === 'function') {
      fileKey.fill(0)
    }
    if (fileNonce && typeof fileNonce.fill === 'function') {
      fileNonce.fill(0)
    }
    if (artBuffer && typeof artBuffer.fill === 'function') {
      artBuffer.fill(0)
    }
    if (thumbBuffer && typeof thumbBuffer.fill === 'function') {
      thumbBuffer.fill(0)
    }
    if (fileBuffer && typeof fileBuffer.fill === 'function') {
      fileBuffer.fill(0)
    }
  }
}

async function processIncomingMessageInternal (record) {
  let signatureBuffer = null
  let publicSignKeyBuffer = null
  let validationBuffer = null
  let ciphertextBuffer = null
  let nonceBuffer = null
  let epochKeyBuffer = null
  let decryptedBuffer = null

  try {
    if (!record || typeof record !== 'object') {
      return {
        success: false,
        code: 'ERR_INVALID_RECORD',
        error: 'Invalid message record'
      }
    }

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

    if (!payload || typeof payload !== 'object') {
      return {
        success: false,
        code: 'ERR_INVALID_RECORD',
        error: 'Invalid message payload'
      }
    }

    // Anti-duplication: check if local_uuid already exists
    if (localUuid) {
      const exists = await workerBridge.request('getMessage', [localUuid])
      if (exists) {
        if (exists.status === 'pending') {
          await workerBridge.request('updateMessage', [localUuid, {
            id,
            status: 'sent'
          }, roomId])
        }

        return {
          success: true,
          duplicated: true
        }
      }
    }

    const { ciphertext, nonce } = payload

    if (typeof signature !== 'string' || !signature.trim()) {
      return {
        success: false,
        code: 'ERR_SIGNATURE_INVALID',
        error: 'Missing or invalid signature string'
      }
    }

    // Fetch Sender Key
    let senderKeys = self.publicKeyCache.get(senderId)
    if (!senderKeys || !senderKeys.public_sign_key) {
      if (!baseUrl) {
        throw new Error('Base URL not initialized')
      }
      const headers = {}
      if (self.authToken) {
        headers.Authorization = self.authToken
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
      self.publicKeyCache.set(senderId, senderKeys)
    }

    const publicSignKey = senderKeys.public_sign_key
    if (typeof publicSignKey !== 'string' || !publicSignKey.trim()) {
      return {
        success: false,
        code: 'ERR_SIGNATURE_INVALID',
        error: 'Sender public sign key is missing or invalid'
      }
    }

    try {
      signatureBuffer = sodium.from_base64(signature, sodium.base64_variants.ORIGINAL)
    } catch {
      return {
        success: false,
        code: 'ERR_SIGNATURE_INVALID',
        error: 'Failed to decode base64 signature'
      }
    }

    try {
      publicSignKeyBuffer = sodium.from_base64(publicSignKey, sodium.base64_variants.ORIGINAL)
    } catch {
      return {
        success: false,
        code: 'ERR_SIGNATURE_INVALID',
        error: 'Failed to decode base64 public sign key'
      }
    }

    if (!signatureBuffer || signatureBuffer.length !== sodium.crypto_sign_BYTES) {
      return {
        success: false,
        code: 'ERR_SIGNATURE_INVALID',
        error: 'Signature length invalid'
      }
    }

    if (!publicSignKeyBuffer || publicSignKeyBuffer.length !== sodium.crypto_sign_PUBLICKEYBYTES) {
      return {
        success: false,
        code: 'ERR_SIGNATURE_INVALID',
        error: 'Public key length invalid'
      }
    }

    const validationString = `${roomId}|${epochId}|${previousMsgUuid}|${ciphertext}|${nonce}`
    validationBuffer = new TextEncoder().encode(validationString)

    let isValid = false
    try {
      isValid = sodium.crypto_sign_verify_detached(signatureBuffer, validationBuffer, publicSignKeyBuffer)
    } catch {
      isValid = false
    }

    if (!isValid) {
      return {
        success: false,
        code: 'ERR_SIGNATURE_INVALID',
        error: 'Signature forged or invalid'
      }
    }

    // Room & Key Lookup
    const room = await workerBridge.request('getRoom', [roomId])
    if (!room) {
      return {
        success: false,
        code: 'ERR_KEY_PENDING',
        error: `Local room ${roomId} not found`
      }
    }

    const activeEpoch = room.key_history?.find(h => h.epoch_id === epochId)
    if (!activeEpoch || typeof activeEpoch.key !== 'string' || !activeEpoch.key.trim()) {
      return {
        success: false,
        code: 'ERR_KEY_PENDING',
        error: 'Missing cryptographic key for this epoch.'
      }
    }

    if (typeof ciphertext !== 'string' || typeof nonce !== 'string') {
      return {
        success: false,
        code: 'ERR_DECRYPTION_FAILED',
        error: 'Ciphertext or nonce is not a string'
      }
    }

    try {
      ciphertextBuffer = sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL)
    } catch {
      return {
        success: false,
        code: 'ERR_DECRYPTION_FAILED',
        error: 'Failed to decode base64 ciphertext'
      }
    }

    try {
      nonceBuffer = sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL)
    } catch {
      return {
        success: false,
        code: 'ERR_DECRYPTION_FAILED',
        error: 'Failed to decode base64 nonce'
      }
    }

    try {
      epochKeyBuffer = sodium.from_base64(activeEpoch.key, sodium.base64_variants.ORIGINAL)
    } catch {
      return {
        success: false,
        code: 'ERR_DECRYPTION_FAILED',
        error: 'Failed to decode base64 epoch key'
      }
    }

    if (!nonceBuffer || nonceBuffer.length !== sodium.crypto_secretbox_NONCEBYTES) {
      return {
        success: false,
        code: 'ERR_DECRYPTION_FAILED',
        error: 'Nonce length invalid'
      }
    }

    if (!epochKeyBuffer || epochKeyBuffer.length !== sodium.crypto_secretbox_KEYBYTES) {
      return {
        success: false,
        code: 'ERR_DECRYPTION_FAILED',
        error: 'Epoch key length invalid'
      }
    }

    try {
      decryptedBuffer = sodium.crypto_secretbox_open_easy(ciphertextBuffer, nonceBuffer, epochKeyBuffer)
    } catch {
      return {
        success: false,
        code: 'ERR_DECRYPTION_FAILED',
        error: 'Decryption failed'
      }
    }

    if (!decryptedBuffer) {
      return {
        success: false,
        code: 'ERR_DECRYPTION_FAILED',
        error: 'Decryption failed (null result)'
      }
    }

    let decryptedString = ''
    let decryptedPayload = null
    try {
      decryptedString = new TextDecoder().decode(decryptedBuffer)
      decryptedPayload = JSON.parse(decryptedString)
    } catch {
      return {
        success: false,
        code: 'ERR_DECRYPTION_FAILED',
        error: 'Failed to decode or parse JSON payload'
      }
    }

    const { type, content, call_id, caller_id, reason, candidate, candidates, media_types, target_id, timestamp, p2pUuid } = decryptedPayload

    const decryptedMessage = {
      id,
      local_uuid: decryptedPayload.local_uuid || id,
      room_id: roomId,
      sender_id: senderId,
      type,
      content,
      call_id,
      caller_id,
      reason,
      candidate,
      candidates,
      media_types,
      target_id,
      timestamp,
      status: decryptedPayload.status || 'sent',
      transfer_mode: decryptedPayload.transfer_mode,
      p2pUuid,
      previous_msg_uuid: previousMsgUuid,
      created_at: created,
      ephemeral: decryptedPayload.ephemeral
    }

    const isIncomingEphemeral = [
      'p2p_transfer_request',
      'p2p_accept',
      'p2p_rejected',
      'p2p_request_offer',
      'p2p_offer',
      'p2p_answer',
      'p2p_ice_candidate',
      'ice_candidate',
      'call_offer',
      'call_answer',
      'call_end'
    ].includes(type) || decryptedPayload.ephemeral

    if (isIncomingEphemeral) {
      return {
        success: true,
        data: decryptedMessage,
        isEphemeral: true
      }
    }

    if (type === 'media') {
      if (Array.isArray(decryptedPayload.attachments) && decryptedPayload.attachments.length > 0) {
        decryptedMessage.attachments = decryptedPayload.attachments
        for (const att of decryptedPayload.attachments) {
          if (att.media_id && att.transfer_mode !== 'p2p') {
            await workerBridge.request('saveAsset', [{
              id: att.media_id,
              media_id: att.media_id,
              room_id: roomId,
              message_id: decryptedMessage.local_uuid,
              filename: att.filename,
              mime_type: att.mime_type,
              file_key: att.file_key,
              file_nonce: att.file_nonce,
              created_at: created,
              music_metadata: att.music_metadata,
              album_art: att.album_art,
              thumbnail: att.thumbnail,
              duration: att.duration
            }])
          }
        }
      } else {
        const { media_id, file_key, file_nonce, filename, mime_type, waveform_data, music_metadata, album_art, thumbnail, duration, transfer_mode } = decryptedPayload
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
        decryptedMessage.transfer_mode = transfer_mode

        if (transfer_mode !== 'p2p') {
          await workerBridge.request('saveAsset', [{
            id: media_id,
            media_id,
            room_id: roomId,
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
          }])
        }
      }
    }

    if (type === 'link') {
      decryptedMessage.links = decryptedPayload.links
    }

    if (type !== 'ice_candidate') {
      await workerBridge.request('saveMessage', [decryptedMessage])
    }

    return {
      success: true,
      data: decryptedMessage,
      isEphemeral: false
    }
  } finally {
    if (signatureBuffer && typeof signatureBuffer.fill === 'function') {
      signatureBuffer.fill(0)
    }
    if (publicSignKeyBuffer && typeof publicSignKeyBuffer.fill === 'function') {
      publicSignKeyBuffer.fill(0)
    }
    if (validationBuffer && typeof validationBuffer.fill === 'function') {
      validationBuffer.fill(0)
    }
    if (ciphertextBuffer && typeof ciphertextBuffer.fill === 'function') {
      ciphertextBuffer.fill(0)
    }
    if (nonceBuffer && typeof nonceBuffer.fill === 'function') {
      nonceBuffer.fill(0)
    }
    if (epochKeyBuffer && typeof epochKeyBuffer.fill === 'function') {
      epochKeyBuffer.fill(0)
    }
    if (decryptedBuffer && typeof decryptedBuffer.fill === 'function') {
      decryptedBuffer.fill(0)
    }
  }
}

async function processIncomingMessage (rpcId, record) {
  const result = await processIncomingMessageInternal(record)

  if (result.success) {
    if (result.isEphemeral && result.data) {
      self.postMessage({
        type: 'db:new_local_data',
        payload: {
          room_id: record.room_id,
          message: result.data
        }
      })
    }

    self.postMessage({
      id: rpcId,
      type: 'worker:process_incoming_message',
      result: {
        success: true,
        duplicated: result.duplicated
      }
    })
    return
  }

  if (result.code === 'ERR_KEY_PENDING') {
    const roomId = record.room_id
    const msgId = record.id || record.local_uuid
    let queue = pendingKeyReplayBuffer.get(roomId) || []

    const now = Date.now()
    queue = queue.filter(item => (now - item.receivedAt) <= 60000)

    while (queue.length >= 50) {
      queue.shift()
    }

    queue.push({
      id: msgId,
      record,
      receivedAt: now
    })

    pendingKeyReplayBuffer.set(roomId, queue)

    console.info(`[worker] Message ${msgId} queued awaiting room key for room ${roomId}`)

    self.postMessage({
      id: rpcId,
      type: 'worker:process_incoming_message',
      result: {
        success: true,
        status: 'queued_for_key',
        roomId,
        messageId: msgId
      }
    })
    return
  }

  console.warn(`[worker] Skipping message processing for message ${record?.id} in room ${record?.room_id}: ${result.error}`)
  self.postMessage({
    id: rpcId,
    type: 'worker:process_incoming_message',
    result: {
      success: false,
      code: result.code,
      error: result.error
    }
  })
}

async function flushPendingMessagesForRoom (roomId) {
  const queue = pendingKeyReplayBuffer.get(roomId)
  if (!queue || queue.length === 0) {
    return
  }

  const now = Date.now()
  const validItems = queue.filter(item => (now - item.receivedAt) <= 60000)
  const remaining = []

  for (const item of validItems) {
    const result = await processIncomingMessageInternal(item.record)
    if (result && result.success) {
      if (result.data) {
        self.postMessage({
          type: 'db:new_local_data',
          payload: {
            room_id: roomId,
            message: result.data
          }
        })
        self.postMessage({
          type: 'sync:message_replayed',
          payload: {
            room_id: roomId,
            message: result.data
          }
        })
      }
    } else if (result && result.code === 'ERR_KEY_PENDING') {
      remaining.push(item)
    } else {
      console.warn(`[worker] Dropped unresolvable replay item ${item.id} in room ${roomId}:`, result?.error)
    }
  }

  if (remaining.length > 0) {
    pendingKeyReplayBuffer.set(roomId, remaining)
  } else {
    pendingKeyReplayBuffer.delete(roomId)
  }
}

async function flushAllPendingMessages () {
  const roomIds = Array.from(pendingKeyReplayBuffer.keys())
  for (const roomId of roomIds) {
    await flushPendingMessagesForRoom(roomId)
  }
}

async function updateRoomMember (rpcId, record) {
  const { room_id, user_id, last_read_message_id, is_muted } = record

  await workerBridge.request('updateRoomMemberState', [
    room_id,
    user_id,
    {
      last_read_message_id,
      is_muted
    }
  ])

  self.postMessage({
    id: rpcId,
    type: 'room:member_updated_RPC',
    result: { success: true }
  })
}

async function updateRoomSettings (rpcId, record) {
  const { room_id, user_id, is_muted } = record

  await workerBridge.request('updateRoomMemberState', [
    room_id,
    user_id,
    {
      is_muted: is_muted === true
    }
  ])

  // Also decrypt and update settings (read_receipts, nicknames) locally on the room object!
  const room = await workerBridge.request('getRoom', [room_id])
  if (room && record.settings && record.settings.ciphertext) {
    const roomKeyB64 = room?.key_history?.find(h => h.epoch_id === 1)?.key
    if (roomKeyB64) {
      try {
        const ciphertextBytes = sodium.from_base64(record.settings.ciphertext, sodium.base64_variants.ORIGINAL)
        const nonceBytes = sodium.from_base64(record.settings.nonce, sodium.base64_variants.ORIGINAL)
        const roomKeyBytes = sodium.from_base64(roomKeyB64, sodium.base64_variants.ORIGINAL)
        const decryptedBytes = sodium.crypto_secretbox_open_easy(ciphertextBytes, nonceBytes, roomKeyBytes)
        if (decryptedBytes) {
          const decodedStr = new TextDecoder().decode(decryptedBytes)
          const settingsObj = JSON.parse(decodedStr)
          room.nicknames = settingsObj.nicknames || {}
          room.read_receipts = settingsObj.read_receipts !== false
          if (settingsObj.theme !== undefined) {
            room.theme = settingsObj.theme || 'classic'
          }
          if (settingsObj.custom_theme !== undefined) {
            room.custom_theme = settingsObj.custom_theme || null
          }
          await workerBridge.request('saveRoom', [room])

          self.postMessage({
            type: 'room:theme_updated',
            payload: {
              room_id,
              theme: room.theme,
              custom_theme: room.custom_theme
            }
          })
          self.postMessage({
            type: 'room:member_updated',
            payload: { room_id }
          })
        }
      } catch (e) {
        console.error('[worker] Failed to decrypt settings in live update:', e)
      }
    }
  }

  self.postMessage({
    id: rpcId,
    type: 'room:settings_updated_RPC',
    result: { success: true }
  })
}

async function updateRoomState (rpcId, record) {
  const { room_id, user_id, last_read_message_id, is_typing } = record

  await workerBridge.request('updateRoomMemberState', [
    room_id,
    user_id,
    {
      last_read_message_id,
      is_typing: is_typing === true
    }
  ])

  self.postMessage({
    id: rpcId,
    type: 'room:state_updated_RPC',
    result: { success: true }
  })
}

async function deleteLocalRoom (rpcId, payload) {
  const { room_id } = payload
  await workerBridge.request('deleteRoomData', [room_id])

  self.postMessage({
    id: rpcId,
    type: 'worker:delete_local_room',
    result: { success: true }
  })
}

/**
 * Updates the user's profile metadata in the local database cache and public key cache,
 * then notifies the main thread about all rooms containing this participant to trigger reactive UI updates.
 *
 * @param {string} rpcId - The unique remote procedure call identifier.
 * @param {Object} record - The updated user record.
 * @param {string} record.id - The unique user ID of the user.
 * @param {string} record.name - The updated display name of the user.
 * @param {string} record.username - The updated username.
 * @param {string} [record.avatar] - The user's updated avatar filename/resource.
 * @returns {Promise<void>} Resolves when the cache has been updated and main thread notifications have been posted.
 * @throws {Error} Throws if the database or cache update fails.
 */
async function updateUserData (rpcId, record) {
  const userId = record.id
  const { name, username, avatar } = record

  // Update publicKeyCache
  const existingKeys = self.publicKeyCache.get(userId)
  if (existingKeys) {
    self.publicKeyCache.set(userId, {
      ...existingKeys,
      name,
      username,
      avatar
    })
  }

  const updatedRoomIds = await workerBridge.request('updateRoomsWithParticipant', [
    userId,
    {
      name,
      username,
      avatar
    }
  ])

  if (Array.isArray(updatedRoomIds)) {
    for (const roomId of updatedRoomIds) {
      self.postMessage({
        type: 'room:member_updated',
        payload: { room_id: roomId }
      })
    }
  }

  self.postMessage({
    id: rpcId,
    type: 'worker:update_user_data',
    result: { success: true }
  })
}

async function fetchRoomSettingsAndStates (room_id, unwrappedKeyBuffer) {
  let is_muted = false
  let nicknames = {}
  let read_receipts = true
  let theme = 'classic'
  let custom_theme = null
  const memberStates = {} // maps user_id -> { last_read_message_id, is_typing }

  const currentUserId = self.currentUserKeys?.id
  const headers = {}
  if (self.authToken) {
    headers.Authorization = self.authToken
  }

  // 1. Fetch current user's room_settings
  if (currentUserId) {
    try {
      const filterStr = `room_id='${room_id}' && user_id='${currentUserId}'`
      const settingsUrl = `${baseUrl}/api/collections/room_settings/records?filter=${encodeURIComponent(filterStr)}`
      const res = await fetchWithTimeout(settingsUrl, { headers })
      if (res.ok) {
        const data = await res.json()
        if (data.items && data.items.length > 0) {
          const item = data.items[0]
          is_muted = item.is_muted === true
          if (item.settings && item.settings.ciphertext && unwrappedKeyBuffer) {
            try {
              const ciphertextBytes = sodium.from_base64(item.settings.ciphertext, sodium.base64_variants.ORIGINAL)
              const nonceBytes = sodium.from_base64(item.settings.nonce, sodium.base64_variants.ORIGINAL)
              const decryptedBytes = sodium.crypto_secretbox_open_easy(ciphertextBytes, nonceBytes, unwrappedKeyBuffer)
              if (decryptedBytes) {
                const decodedStr = new TextDecoder().decode(decryptedBytes)
                const settingsObj = JSON.parse(decodedStr)
                nicknames = settingsObj.nicknames || {}
                read_receipts = settingsObj.read_receipts !== false
                theme = settingsObj.theme || 'classic'
                custom_theme = settingsObj.custom_theme || null
              }
            } catch (e) {
              console.error('[worker] Failed to decrypt settings:', e)
            }
          }
        }
      }
    } catch (err) {
      console.warn('[worker] Failed to fetch settings:', err)
    }
  }

  // 2. Fetch room_member_states for all users in room
  try {
    const filterStr = `room_id='${room_id}'`
    const statesUrl = `${baseUrl}/api/collections/room_member_states/records?filter=${encodeURIComponent(filterStr)}`
    const res = await fetchWithTimeout(statesUrl, { headers })
    if (res.ok) {
      const data = await res.json()
      if (data.items) {
        data.items.forEach(item => {
          memberStates[item.user_id] = {
            last_read_message_id: item.last_read_message_id || null,
            is_typing: item.is_typing === true
          }
        })
      }
    }
  } catch (err) {
    console.warn('[worker] Failed to fetch member states:', err)
  }

  return {
    is_muted,
    nicknames,
    read_receipts,
    theme,
    custom_theme,
    memberStates
  }
}

function shouldSkipRoomKeyProcessing (existingRoom, payload, currentUserId) {
  const effectiveEpochId = payload?.epoch_id || 1
  const isSameUser = existingRoom?.synced_user_id === currentUserId
  const hasEpochKey = existingRoom?.key_history?.some(h => h.epoch_id === effectiveEpochId && !!h.key)
  const isUpToDate = existingRoom?.updated_at && payload?.updated && existingRoom.updated_at >= payload.updated
  return Boolean(isSameUser && hasEpochKey && isUpToDate)
}

async function processNewRoomKey (rpcId, payload) {
  let encryptedRoomKeyBuffer = null
  let nonceBuffer = null
  let inviterPublicKeyBuffer = null
  let userPrivateKeyBuffer = null
  let unwrappedKeyBuffer = null
  let metadataCiphertext = null
  let metadataNonce = null
  let decryptedMetadataBuffer = null

  try {
    const {
      room_id,
      wrapped_by,
      encrypted_room_key,
      key_nonce,
      epoch_id,
      role,
      updated
    } = payload

    if (!encrypted_room_key || !wrapped_by) {
      console.warn(`[worker] Skipping room key processing for room ${room_id} because encrypted_room_key or wrapped_by is empty.`)
      self.postMessage({
        id: rpcId,
        type: 'worker:process_new_room_key',
        result: { success: true }
      })
      return
    }

    const effectiveEpochId = epoch_id || 1

    const existingRoom = await workerBridge.request('getRoom', [room_id])
    if (shouldSkipRoomKeyProcessing(existingRoom, payload, self.currentUserKeys?.id)) {
      await flushPendingMessagesForRoom(room_id)
      self.postMessage({
        id: rpcId,
        type: 'worker:process_new_room_key',
        result: {
          success: true,
          skipped: true
        }
      })
      return
    }

    if (!self.currentUserKeys || !self.currentUserKeys.private_box_key) {
      throw new Error('User keys not initialized in worker')
    }

    // Fetch Inviter's Public Key
    let inviterKeys = self.publicKeyCache.get(wrapped_by)
    if (!inviterKeys || !inviterKeys.public_box_key) {
      if (!baseUrl) {
        throw new Error('Base URL not initialized')
      }
      const headers = {}
      if (self.authToken) {
        headers.Authorization = self.authToken
      }
      try {
        const response = await fetchWithTimeout(`${baseUrl}/api/collections/users/records/${wrapped_by}`, { headers })
        if (!response.ok) {
          console.warn(`[worker] Failed to fetch inviter public key (${wrapped_by}): ${response.status} ${response.statusText}`)
          self.postMessage({
            id: rpcId,
            type: 'worker:process_new_room_key',
            result: {
              success: false,
              error: 'Inviter public key not found'
            }
          })
          return
        }
        const userRecord = await response.json()
        inviterKeys = {
          ...(inviterKeys || {}),
          public_box_key: userRecord.public_box_key,
          public_sign_key: userRecord.public_sign_key
        }
        self.publicKeyCache.set(wrapped_by, inviterKeys)
      } catch (err) {
        console.warn(`[worker] Error fetching inviter public key (${wrapped_by}):`, err)
        self.postMessage({
          id: rpcId,
          type: 'worker:process_new_room_key',
          result: {
            success: false,
            error: err.message
          }
        })
        return
      }
    }

    const inviterPublicKey = inviterKeys.public_box_key
    if (!inviterPublicKey) {
      console.warn(`[worker] Inviter (${wrapped_by}) public box key is missing`)
      self.postMessage({
        id: rpcId,
        type: 'worker:process_new_room_key',
        result: {
          success: false,
          error: 'Inviter public box key missing'
        }
      })
      return
    }

    // Decrypt (Unwrap)
    try {
      encryptedRoomKeyBuffer = sodium.from_base64(encrypted_room_key, sodium.base64_variants.ORIGINAL)
      nonceBuffer = sodium.from_base64(key_nonce, sodium.base64_variants.ORIGINAL)
      inviterPublicKeyBuffer = sodium.from_base64(inviterPublicKey, sodium.base64_variants.ORIGINAL)
      userPrivateKeyBuffer = sodium.from_base64(self.currentUserKeys.private_box_key, sodium.base64_variants.ORIGINAL)

      unwrappedKeyBuffer = sodium.crypto_box_open_easy(
        encryptedRoomKeyBuffer,
        nonceBuffer,
        inviterPublicKeyBuffer,
        userPrivateKeyBuffer
      )
    } catch (err) {
      console.warn(`[worker] Failed to unwrap room key for room ${room_id}: Decryption error`, err)
      self.postMessage({
        id: rpcId,
        type: 'worker:process_new_room_key',
        result: {
          success: false,
          error: 'Failed to unwrap room key: Decryption error'
        }
      })
      return
    }

    if (!unwrappedKeyBuffer || unwrappedKeyBuffer.length === 0) {
      console.warn(`[worker] Failed to unwrap room key for room ${room_id}: Null result`)
      self.postMessage({
        id: rpcId,
        type: 'worker:process_new_room_key',
        result: {
          success: false,
          error: 'Failed to unwrap room key: Null result'
        }
      })
      return
    }

    // Fetch Room metadata and members from server
    let roomMetadata = null
    let isGroup = true
    let participants = []
    const headers = {}
    if (self.authToken) {
      headers.Authorization = self.authToken
    }

    // fetch room record
    let roomRecord = null
    const roomResponse = await fetchWithTimeout(`${baseUrl}/api/collections/rooms/records/${room_id}`, { headers })
    if (roomResponse.ok) {
      roomRecord = await roomResponse.json()
      isGroup = roomRecord.is_group

      if (roomRecord.encrypted_metadata && roomRecord.encrypted_metadata.ciphertext) {
        metadataCiphertext = sodium.from_base64(roomRecord.encrypted_metadata.ciphertext, sodium.base64_variants.ORIGINAL)
        metadataNonce = sodium.from_base64(roomRecord.encrypted_metadata.nonce, sodium.base64_variants.ORIGINAL)
        try {
          decryptedMetadataBuffer = sodium.crypto_secretbox_open_easy(metadataCiphertext, metadataNonce, unwrappedKeyBuffer)
          if (decryptedMetadataBuffer) {
            roomMetadata = JSON.parse(new TextDecoder().decode(decryptedMetadataBuffer))
          }
        } catch (err) {
          console.error('Failed to decrypt room metadata:', err)
        }
      }
    }

    // Fetch settings and states
    const settingsAndStates = await fetchRoomSettingsAndStates(room_id, unwrappedKeyBuffer)
    const currentUserId = self.currentUserKeys?.id

    // Fetch Room members with user details
    const membersUrl = `${baseUrl}/api/collections/room_members/records?filter=(room_id='${room_id}')&expand=user_id`
    const membersResponse = await fetchWithTimeout(membersUrl, { headers })
    if (membersResponse.ok) {
      const membersData = await membersResponse.json()
      participants = membersData.items.map(m => {
        const user = m.expand?.user_id
        if (!user) {
          return null
        }

        const stateInfo = settingsAndStates.memberStates[user.id] || {}
        return {
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          collectionId: user.collectionId,
          collectionName: user.collectionName,
          last_read_message_id: stateInfo.last_read_message_id || null,
          is_typing: stateInfo.is_typing === true,
          is_muted: user.id === currentUserId ? settingsAndStates.is_muted : false
        }
      }).filter(p => p !== null)
    }

    // epoch management and local storage
    let room = existingRoom || await workerBridge.request('getRoom', [room_id])
    if (!room) {
      room = {
        id: room_id,
        is_group: isGroup,
        weight: typeof roomRecord?.weight === 'number' ? roomRecord.weight : 0,
        name: roomMetadata?.name || '',
        avatar: roomMetadata?.avatar || '',
        theme: settingsAndStates.theme || 'classic',
        custom_theme: settingsAndStates.custom_theme || null,
        participants: participants || [],
        user_role: role,
        key_history: [],
        updated_at: updated,
        read_receipts: settingsAndStates.read_receipts,
        nicknames: settingsAndStates.nicknames
      }
    } else {
      room.updated_at = updated || room.updated_at
      room.user_role = role || room.user_role
      if (typeof roomRecord?.weight === 'number') {
        room.weight = roomRecord.weight
      }
      room.read_receipts = settingsAndStates.read_receipts
      room.nicknames = settingsAndStates.nicknames
      room.theme = settingsAndStates.theme || 'classic'
      room.custom_theme = settingsAndStates.custom_theme || null
      if (roomMetadata?.name) {
        room.name = roomMetadata.name
      }
      if (roomMetadata?.avatar) {
        room.avatar = roomMetadata.avatar
      }
      if (participants && participants.length > 0) {
        const existingParticipants = room.participants || []
        const mergedMap = new Map()
        for (const p of existingParticipants) {
          if (p && p.id) {
            mergedMap.set(p.id, p)
          }
        }
        for (const p of participants) {
          if (p && p.id) {
            const existing = mergedMap.get(p.id)
            mergedMap.set(p.id, {
              ...existing,
              ...p
            })
          }
        }
        room.participants = Array.from(mergedMap.values())
      }
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

    room.synced_user_id = self.currentUserKeys?.id
    await workerBridge.request('saveRoom', [room])

    await flushPendingMessagesForRoom(room_id)

    self.postMessage({
      id: rpcId,
      type: 'worker:process_new_room_key',
      result: { success: true }
    })
  } finally {
    if (encryptedRoomKeyBuffer && typeof encryptedRoomKeyBuffer.fill === 'function') {
      encryptedRoomKeyBuffer.fill(0)
    }
    if (nonceBuffer && typeof nonceBuffer.fill === 'function') {
      nonceBuffer.fill(0)
    }
    if (inviterPublicKeyBuffer && typeof inviterPublicKeyBuffer.fill === 'function') {
      inviterPublicKeyBuffer.fill(0)
    }
    if (userPrivateKeyBuffer && typeof userPrivateKeyBuffer.fill === 'function') {
      userPrivateKeyBuffer.fill(0)
    }
    if (unwrappedKeyBuffer && typeof unwrappedKeyBuffer.fill === 'function') {
      unwrappedKeyBuffer.fill(0)
    }
    if (metadataCiphertext && typeof metadataCiphertext.fill === 'function') {
      metadataCiphertext.fill(0)
    }
    if (metadataNonce && typeof metadataNonce.fill === 'function') {
      metadataNonce.fill(0)
    }
    if (decryptedMetadataBuffer && typeof decryptedMetadataBuffer.fill === 'function') {
      decryptedMetadataBuffer.fill(0)
    }
  }
}

readyPromise = init()
