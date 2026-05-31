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
