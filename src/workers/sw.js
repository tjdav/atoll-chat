/// <reference lib="webworker" />

/**
 * @typedef {any} ServiceWorkerGlobalScope
 * @typedef {any} Clients
 * @typedef {any} ServiceWorkerRegistration
 */

/**
 * @typedef {ServiceWorkerGlobalScope & {
 *   metadata: { name: string, version: string },
 *   sodium: typeof import('libsodium-wrappers-sumo'),
 *   skipWaiting: () => void,
 *   clients: Clients,
 *   registration: ServiceWorkerRegistration
 * }} ServiceWorkerScope
 */

/** @type {any} */
const rawSelf = self
/** @type {ServiceWorkerScope} */
const swSelf = rawSelf

const skipWaiting = swSelf.skipWaiting
const clients = swSelf.clients
const registration = swSelf.registration

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/worker.js',
  '/favicon.ico',
  '/assets/css/styles.css',
  '/assets/libsodium-wrappers.js',
  '/assets/libsodium-sumo.js',
  '/assets/dexie.js'
]

importScripts('/assets/metadata.js')
importScripts('/assets/libsodium-sumo.js')
importScripts('/assets/libsodium-wrappers.js')

const metadata = swSelf.metadata
const sodium = swSelf.sodium

const CACHE_NAME = metadata.name + '-' + metadata.version

// libsodium wasm is embedded as a base64 string
const hostname = location.hostname
const isDev = hostname === 'localhost' ||
              hostname === '127.0.0.1' ||
              hostname.startsWith('192.168.') ||
              hostname.startsWith('10.') ||
              hostname.startsWith('172.')

/**
 * @param {any} event The installation event.
 */
const onInstall = (event) => {
  skipWaiting()

  if (isDev) {
    return
  }

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache and adding assets')
      return cache.addAll(ASSETS_TO_CACHE)
    })
  )
}

// install event
addEventListener('install', onInstall)

/**
 * @param {any} event The activation event.
 */
const onActivate = (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting cache:', cacheName)
            return caches.delete(cacheName)
          }
        })
      ).then(() => {
        return clients.claim()
      })
    })
  )
}

// activate event
addEventListener('activate', onActivate)

/**
 * @param {any} event The fetch event.
 */
const onFetch = (event) => {
  const { request } = event

  // Exclude API and SSE calls to PocketBase and only handle GET requests
  if (isDev || request.url.includes('/api/') || request.method !== 'GET') {
    return
  }

  event.respondWith(
    caches.match(request, { cacheName: CACHE_NAME }).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        // Update the cache with the new response if it's a valid response
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache)
          })
        }
        return networkResponse
      })

      // return cached response or fetch from network
      return cachedResponse || fetchPromise
    })
  )
}

// fetch interceptor
addEventListener('fetch', onFetch)

/**
 * Opens connection to IndexedDB.
 * @returns {Promise<any>} Opened DB instance.
 */
function openDB () {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AtollChatDB')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

/**
 * Gets key from store.
 * @param {any} db Open DB.
 * @param {string} storeName Object store name.
 * @param {any} key The key.
 * @returns {Promise<any>} The record value.
 */
function getFromStore (db, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.get(key)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

/**
 * Puts value into store.
 * @param {any} db Open DB.
 * @param {string} storeName Object store name.
 * @param {any} value Value to store.
 * @returns {Promise<any>} Response.
 */
function putIntoStore (db, storeName, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.put(value)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

/**
 * @param {any} event The push event.
 */
const onPush = (event) => {
  event.waitUntil((async () => {
    try {
      // Open native IndexedDB connection
      const db = await openDB()

      // Fetch configuration
      const [urlConfig, tokenConfig] = await Promise.all([
        getFromStore(db, 'local_config', 'pb_url'),
        getFromStore(db, 'local_config', 'pb_token')
      ])

      if (!urlConfig || !tokenConfig) {
        throw new Error('PocketBase configuration missing in IndexedDB')
      }

      const pbUrl = urlConfig.value
      const pbToken = tokenConfig.value

      let pushData = null
      if (event.data) {
        try {
          pushData = event.data.json()
        } catch {
          /* If parsing raw JSON fails, leave as null */
        }
      }

      let record = null

      if (pushData && pushData.message_id) {
        try {
          const response = await fetch(`${pbUrl}/api/collections/messages/records/${pushData.message_id}`, {
            headers: { Authorization: pbToken }
          })
          if (response.ok) {
            record = await response.json()
          } else {
            console.warn(`[SW] Failed to fetch message ${pushData.message_id} specifically, trying fallback.`)
          }
        } catch (fetchErr) {
          console.warn('[SW] Exception while fetching specific message_id, trying fallback.', fetchErr)
        }
      }

      if (!record) {
        // Fallback to fetching latest message
        const response = await fetch(`${pbUrl}/api/collections/messages/records?sort=-created&limit=1`, {
          headers: { Authorization: pbToken }
        })

        if (!response.ok) {
          throw new Error(`Failed to fetch latest message: ${response.statusText}`)
        }

        const data = await response.json()
        record = data.items[0]
      }

      if (!record) {
        throw new Error('No new messages found')
      }

      // Check for active window/clients
      const windowClients = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      })

      let isAppFocused = false
      for (const client of windowClients) {
        if (client.focused) {
          isAppFocused = true
          break
        }
      }

      const activeClient = windowClients.find(c => c.visibilityState === 'visible') || windowClients[0]

      if (isAppFocused) {
        console.log('[SW] App is focused. Suppressing OS push notification.')
        if (activeClient) {
          activeClient.postMessage({
            type: 'PUSH_RECEIVED',
            payload: record
          })
        }
        return
      }

      if (activeClient) {
        console.log('[SW] Active window found. Forwarding push record to main thread.')
        activeClient.postMessage({
          type: 'PUSH_RECEIVED',
          payload: record
        })

        /* We can early exit here and show a basic/default notification,
           or just proceed to show notification while main thread does decryption.
           Let's show the standard message alert */
        return registration.showNotification('atoll chat', {
          body: 'You have a new secure message.',
          icon: '/images/icon-coralite.avif',
          tag: 'atoll-chat-msg'
        })
      }

      // Closed main thread: Decryption pipeline
      await sodium.ready

      const room = await getFromStore(db, 'local_rooms', record.room_id)
      if (!room) {
        throw new Error(`Room ${record.room_id} not found in local DB`)
      }

      const activeEpoch = room.key_history?.find(h => h.epoch_id === record.epoch_id)
      if (!activeEpoch) {
        throw new Error(`Key for epoch ${record.epoch_id} not found`)
      }

      const ciphertextBuffer = sodium.from_base64(record.ciphertext)
      const nonceBuffer = sodium.from_base64(record.nonce)
      const epochKeyBuffer = sodium.from_base64(activeEpoch.key)

      const decryptedBuffer = sodium.crypto_secretbox_open_easy(ciphertextBuffer, nonceBuffer, epochKeyBuffer)
      if (!decryptedBuffer) {
        throw new Error('Decryption failed (null result)')
      }

      const plaintextObj = JSON.parse(new TextDecoder().decode(decryptedBuffer))

      // Persist decrypted message
      const decryptedMessage = {
        id: record.id,
        local_uuid: plaintextObj.local_uuid || record.id,
        room_id: record.room_id,
        sender_id: record.sender_id,
        type: plaintextObj.type,
        content: plaintextObj.content,
        candidate: plaintextObj.candidate,
        candidates: plaintextObj.candidates,
        media_types: plaintextObj.media_types,
        target_id: plaintextObj.target_id,
        timestamp: plaintextObj.timestamp,
        status: 'sent',
        previous_msg_uuid: record.previous_msg_uuid,
        created_at: record.created
      }

      if (plaintextObj.type === 'media') {
        const { media_id, file_key, file_nonce, filename, mime_type, waveform_data, music_metadata, album_art, thumbnail, duration } = plaintextObj
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

        await putIntoStore(db, 'local_assets', {
          id: media_id,
          media_id,
          room_id: record.room_id,
          message_id: decryptedMessage.local_uuid,
          filename,
          mime_type,
          file_key,
          file_nonce,
          created_at: record.created,
          music_metadata,
          album_art,
          thumbnail,
          duration
        })
      }

      if (plaintextObj.type === 'link') {
        decryptedMessage.links = plaintextObj.links
      }

      if (plaintextObj.type !== 'ice_candidate') {
        await putIntoStore(db, 'local_messages', decryptedMessage)
      }

      // Determine notification content
      let senderName = 'New Message'
      let notificationBody = ''

      if (plaintextObj.type === 'text') {
        notificationBody = plaintextObj.content
      } else if (plaintextObj.type === 'media') {
        notificationBody = '[Attachment]'
      } else if (plaintextObj.type === 'call_offer') {
        notificationBody = 'Incoming Call!'
      } else {
        notificationBody = 'You have a new secure message.'
      }

      // Show rich notification
      return registration.showNotification(senderName, {
        body: notificationBody,
        icon: '/images/icon-coralite.avif',
        tag: 'atoll-chat-msg'
      })

    } catch (err) {
      console.error('Push Error:', err)
      // Fallback to generic notification
      return registration.showNotification('atoll chat', {
        body: 'You have a new secure message.',
        icon: '/images/icon-coralite.avif',
        tag: 'atoll-chat-msg'
      })
    }
  })())
}

addEventListener('push', onPush)
