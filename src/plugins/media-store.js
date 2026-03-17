import { createPlugin } from 'coralite'

export default createPlugin({
  name: 'media-store-plugin',
  client: {
    setup () {
      const DB_NAME = 'coralite-media-vault'
      const STORE_NAME = 'media'
      const DB_VERSION = 1

      let dbPromise = null

      const getDB = () => {
        if (!dbPromise) {
          dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)

            request.onupgradeneeded = (event) => {
              const db = event.target.result
              if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'event_id' })
                store.createIndex('mimeType', 'mimeType', { unique: false })
                store.createIndex('timestamp', 'timestamp', { unique: false })
              }
            }

            request.onsuccess = (event) => {
              resolve(event.target.result)
            }

            request.onerror = (event) => {
              reject(event.target.error)
            }
          })
        }
        return dbPromise
      }

      return {
        getDB,
        STORE_NAME
      }
    },
    helpers: {
      saveMedia: (context) => {
        const { getDB, STORE_NAME } = context.values

        return async (event_id, blob, metadata) => {
          const db = await getDB()

          return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite')
            const store = transaction.objectStore(STORE_NAME)

            const record = {
              event_id,
              blob,
              ...metadata,
              timestamp: metadata.timestamp || Date.now()
            }

            const request = store.put(record)

            request.onsuccess = () => resolve(record)
            request.onerror = (event) => reject(event.target.error)
          })
        }
      },

      queryMedia: (context) => {
        const { getDB, STORE_NAME } = context.values

        return async (mimeTypePrefix) => {
          const db = await getDB()

          return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly')
            const store = transaction.objectStore(STORE_NAME)
            const index = store.index('mimeType')

            const boundRange = IDBKeyRange.bound(mimeTypePrefix, mimeTypePrefix + '\uffff')
            const request = index.getAll(boundRange)

            request.onsuccess = (event) => {
              const matchedRecords = event.target.result || []
              // Sort by timestamp descending (newest first)
              matchedRecords.sort((a, b) => b.timestamp - a.timestamp)
              resolve(matchedRecords)
            }

            request.onerror = (event) => reject(event.target.error)
          })
        }
      },

      getAudioFiles: (context) => async () => {
        return await context.helpers.queryMedia('audio/')
      },

      getImageFiles: (context) => async () => {
        return await context.helpers.queryMedia('image/')
      },

      getVideoFiles: (context) => async () => {
        return await context.helpers.queryMedia('video/')
      }
    }
  }
})
