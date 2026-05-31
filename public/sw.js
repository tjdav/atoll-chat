const CACHE_NAME = 'atoll-chat-v1'
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/worker.js',
  '/favicon.ico',
  '/assets/css/styles.css',
  '/assets/libsodium-wrappers.js',
  '/assets/libsodium-sumo.js',
  '/images/icon-coralite.avif',
  '/images/static_rays.avif',
  'https://unpkg.com/dexie@4.0.10/dist/dexie.js'
]

/* global sodium, Dexie */
importScripts('/assets/libsodium-sumo.js')
importScripts('/assets/libsodium-wrappers.js')
importScripts('https://unpkg.com/dexie@4.0.10/dist/dexie.js')

// Note: Libsodium WASM is embedded as a Base64 string within the JS files
// in this build, so no separate .wasm file is needed in the cache.

// The Install Event: Caching the UI shell and cryptographic dependencies
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache and adding assets')
      return cache.addAll(ASSETS_TO_CACHE)
    })
  )
})

// The Activate Event: Cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName)
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
})

// The Fetch Interceptor: Stale-While-Revalidate strategy
self.addEventListener('fetch', (event) => {
  const { request } = event

  // Exclude API and SSE calls to PocketBase and only handle GET requests
  if (request.url.includes('/api/') || request.method !== 'GET') {
    return
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
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
})

/**
 * Handle Rich Push Notifications
 * Wakes up the worker, fetches encrypted data, decrypts using IndexedDB keys.
 */
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    try {
      // 1. Initialize Database
      const db = new Dexie('AtollChatDB')
      db.version(3).stores({
        local_rooms: 'id, is_group, updated_at',
        local_messages: 'id, room_id, created_at, [room_id+created_at], type',
        local_assets: 'id, room_id, mime_type, created_at',
        local_config: 'key'
      })

      // 2. Fetch Configuration
      const [urlConfig, tokenConfig] = await Promise.all([
        db.local_config.get('pb_url'),
        db.local_config.get('pb_token')
      ])

      if (!urlConfig || !tokenConfig) {
        throw new Error('PocketBase configuration missing in IndexedDB')
      }

      const pbUrl = urlConfig.value
      const pbToken = tokenConfig.value

      // 3. Fetch Latest Message from PocketBase
      const response = await fetch(`${pbUrl}/api/collections/messages/records?sort=-created&limit=1`, {
        headers: { 'Authorization': pbToken }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch message: ${response.statusText}`)
      }

      const data = await response.json()
      const record = data.items[0]

      if (!record) {
        throw new Error('No new messages found')
      }

      // 4. Decryption Pipeline
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

      // 5. Determine Notification Content
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

      // 6. Show Rich Notification
      return self.registration.showNotification(senderName, {
        body: notificationBody,
        icon: '/images/icon-coralite.avif',
        tag: 'atoll-chat-msg'
      })

    } catch (err) {
      console.error('Push Error:', err)
      // Fallback to generic notification
      return self.registration.showNotification('atoll chat', {
        body: 'You have a new secure message.',
        icon: '/images/icon-coralite.avif',
        tag: 'atoll-chat-msg'
      })
    }
  })())
})
