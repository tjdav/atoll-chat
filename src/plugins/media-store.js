import { createPlugin } from 'coralite'
export default createPlugin({
  name: 'media-store-plugin',
  client: {
    setup () {
      const DB_NAME = 'atoll-media-vault'
      const STORE_NAME = 'media'
      const DB_VERSION = 2
      let dbPromise = null
      const getDB = () => {
        if (!dbPromise) {
          dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)
            request.onupgradeneeded = event => {
              const db = event.target.result
              let store
              if (!db.objectStoreNames.contains(STORE_NAME)) {
                store = db.createObjectStore(STORE_NAME, {
                  keyPath: 'id'
                })
                store.createIndex('mimeType', 'mimeType', {
                  unique: false
                })
                store.createIndex('timestamp', 'timestamp', {
                  unique: false
                })
              } else {
                store = request.transaction.objectStore(STORE_NAME)
              }

              // Add the userId index if it doesn't exist

              if (!store.indexNames.contains('userId')) {
                store.createIndex('userId', 'userId', {
                  unique: false
                })
              }
            }
            request.onsuccess = event => {
              resolve(event.target.result)
            }
            request.onerror = event => {
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
      saveMedia: globalContext => localContext => {
        const {
          getDB,
          STORE_NAME
        } = localContext.values
        return async (id, blob, metadata) => {
          const db = await getDB()

          // Grab the currently logged-in user from the Matrix plugin

          const userId = await localContext.helpers.getCurrentUserId()
          return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite')
            const store = transaction.objectStore(STORE_NAME)
            const record = {
              id,
              blob,
              ...metadata,
              userId,
              timestamp: metadata.timestamp || Date.now()
            }
            const request = store.put(record)
            request.onsuccess = () => resolve(record)
            request.onerror = event => reject(event.target.error)
          })
        }
      },
      queryMedia: globalContext => localContext => {
        const {
          getDB,
          STORE_NAME
        } = localContext.values
        return async mimeTypePrefix => {
          const db = await getDB()

          // Get the currently logged-in user

          const userId = await localContext.helpers.getCurrentUserId()
          return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.index('userId').getAll(userId)
            request.onsuccess = event => {
              const userRecords = event.target.result

              // Filter records down to the requested mimeType (e.g., 'audio/', 'image/')

              const matchedRecords = userRecords.filter(record => record.mimeType && record.mimeType.startsWith(mimeTypePrefix))

              // Sort by timestamp descending (newest first)

              matchedRecords.sort((a, b) => b.timestamp - a.timestamp)
              resolve(matchedRecords)
            }
            request.onerror = event => reject(event.target.error)
          })
        }
      },
      getAudioFiles: globalContext => localContext => async () => {
        return await localContext.helpers.queryMedia('audio/')
      },
      getImageFiles: globalContext => localContext => async () => {
        return await localContext.helpers.queryMedia('image/')
      },
      getVideoFiles: globalContext => localContext => async () => {
        return await localContext.helpers.queryMedia('video/')
      }
    }
  }
})
