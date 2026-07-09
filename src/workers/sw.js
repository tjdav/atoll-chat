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
 * @typedef {any} ServiceWorkerGlobalScope
 * @typedef {any} Clients
 * @typedef {any} ServiceWorkerRegistration
 */

/**
 * @typedef {ServiceWorkerGlobalScope & {
 *   metadata: { name: string, version: string },
 *   Dexie: DexieConstructor,
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
importScripts('/assets/dexie.js')

const metadata = swSelf.metadata
const Dexie = swSelf.Dexie
const sodium = swSelf.sodium

const CACHE_NAME = metadata.name + '-' + metadata.version

// Note: Libsodium WASM is embedded as a Base64 string within the JS files
// in this build, so no separate .wasm file is needed in the cache.
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

// The Install Event: Caching the UI shell and cryptographic dependencies
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

// The Activate Event: Cleanup old caches
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

      // Return cached response immediately if available, otherwise wait for fetch.
      // If both fail, let the error propagate.
      return cachedResponse || fetchPromise
    })
  )
}

// The Fetch Interceptor: Stale-While-Revalidate strategy
addEventListener('fetch', onFetch)

/**
 * @param {any} event The push event.
 */
const onPush = (event) => {
  event.waitUntil((async () => {
    try {
      // Initialize database
      const db = new Dexie('AtollChatDB')
      db.version(9).stores({
        local_rooms: 'id, is_group, updated_at',
        local_messages: 'local_uuid, id, room_id, created_at, [room_id+created_at], type, target_id',
        local_assets: 'id, room_id, message_id, mime_type, created_at',
        local_config: 'key'
      })

      // Fetch configuration
      const [urlConfig, tokenConfig] = await Promise.all([
        db.local_config.get('pb_url'),
        db.local_config.get('pb_token')
      ])

      if (!urlConfig || !tokenConfig) {
        throw new Error('PocketBase configuration missing in IndexedDB')
      }

      const pbUrl = urlConfig.value
      const pbToken = tokenConfig.value

      // Fetch Latest Message from PocketBase
      const response = await fetch(`${pbUrl}/api/collections/messages/records?sort=-created&limit=1`, {
        headers: { Authorization: pbToken }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch message: ${response.statusText}`)
      }

      const data = await response.json()
      const record = data.items[0]

      if (!record) {
        throw new Error('No new messages found')
      }

      // Decryption pipeline
      await sodium.ready

      const room = await db.local_rooms.get(record.room_id)
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

      // Determine notification dontent
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
