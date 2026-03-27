import { createPlugin } from 'coralite'

export default createPlugin({
  name: 'user-preferences-plugin',
  client: {
    setup (context) {
      const DB_NAME = 'atoll-user-preferences'
      let isInitialized = false

      const initDB = () => {
        if (isInitialized) return Promise.resolve()

        return new Promise((resolve, reject) => {
          const checkReq = window.indexedDB.open(DB_NAME)
          checkReq.onerror = (e) => reject(checkReq.error)
          checkReq.onsuccess = (e) => {
            const db = e.target.result
            const hasPreferences = db.objectStoreNames.contains('preferences')
            const hasLikes = db.objectStoreNames.contains('likes')

            if (hasPreferences && hasLikes) {
              isInitialized = true
              db.close()
              resolve()
            } else {
              const nextVersion = db.version + 1
              db.close()

              const upgradeReq = window.indexedDB.open(DB_NAME, nextVersion)
              upgradeReq.onupgradeneeded = (e) => {
                const upgradeDb = e.target.result
                if (!upgradeDb.objectStoreNames.contains('preferences')) {
                  upgradeDb.createObjectStore('preferences')
                }
                if (!upgradeDb.objectStoreNames.contains('likes')) {
                  upgradeDb.createObjectStore('likes', { keyPath: 'id' })
                }
              }
              upgradeReq.onsuccess = (e) => {
                isInitialized = true
                e.target.result.close()
                resolve()
              }
              upgradeReq.onerror = (e) => reject(upgradeReq.error)
            }
          }
        })
      }

      return {
        initDB,
        DB_NAME
      }
    },
    helpers: {
      getPreference: (globalContext) => (localContext) => async (key) => {
        await localContext.values.initDB()
        return new Promise((resolve, reject) => {
          const openReq = window.indexedDB.open(localContext.values.DB_NAME)
          openReq.onsuccess = (e) => {
            const db = e.target.result
            const tx = db.transaction('preferences', 'readonly')
            const store = tx.objectStore('preferences')
            let result = null

            tx.oncomplete = () => {
              db.close()
              resolve(result)
            }

            tx.onerror = () => {
              db.close()
              reject(tx.error)
            }

            const getReq = store.get(key)
            getReq.onsuccess = () => {
              result = getReq.result
            }
          }
          openReq.onerror = (e) => reject(openReq.error)
        })
      },

      setPreference: (globalContext) => (localContext) => async (key, value) => {
        await localContext.values.initDB()
        return new Promise((resolve, reject) => {
          const openReq = window.indexedDB.open(localContext.values.DB_NAME)
          openReq.onsuccess = (e) => {
            const db = e.target.result
            const tx = db.transaction('preferences', 'readwrite')
            const store = tx.objectStore('preferences')

            tx.oncomplete = () => {
              db.close()
              resolve()
            }

            tx.onerror = () => {
              db.close()
              reject(tx.error)
            }

            if (value === null || value === undefined) {
              store.delete(key)
            } else {
              store.put(value, key)
            }
          }
          openReq.onerror = (e) => reject(openReq.error)
        })
      },

      getLikes: (globalContext) => (localContext) => async () => {
        await localContext.values.initDB()
        return new Promise((resolve, reject) => {
          const openReq = window.indexedDB.open(localContext.values.DB_NAME)
          openReq.onsuccess = (e) => {
            const db = e.target.result
            const tx = db.transaction('likes', 'readonly')
            const store = tx.objectStore('likes')
            let result = []

            tx.oncomplete = () => {
              db.close()
              resolve(result)
            }

            tx.onerror = () => {
              db.close()
              reject(tx.error)
            }

            const request = store.getAll()
            request.onsuccess = () => {
              result = request.result.map(item => item.id)
            }
          }
          openReq.onerror = (e) => reject(openReq.error)
        })
      },

      getLike: (globalContext) => (localContext) => async (id) => {
        await localContext.values.initDB()
        return new Promise((resolve, reject) => {
          const openReq = window.indexedDB.open(localContext.values.DB_NAME)
          openReq.onsuccess = (e) => {
            const db = e.target.result
            const tx = db.transaction('likes', 'readonly')
            const store = tx.objectStore('likes')
            let result = false

            tx.oncomplete = () => {
              db.close()
              resolve(result)
            }

            tx.onerror = () => {
              db.close()
              reject(tx.error)
            }

            const request = store.get(id)
            request.onsuccess = () => {
              result = request.result !== undefined
            }
          }
          openReq.onerror = (e) => reject(openReq.error)
        })
      },

      toggleLike: (globalContext) => (localContext) => async (id) => {
        await localContext.values.initDB()
        return new Promise((resolve, reject) => {
          const openReq = window.indexedDB.open(localContext.values.DB_NAME)
          openReq.onsuccess = (e) => {
            const db = e.target.result
            const tx = db.transaction('likes', 'readwrite')
            const store = tx.objectStore('likes')
            let isLiked = false

            tx.oncomplete = () => {
              db.close()
              resolve(isLiked)
            }

            tx.onerror = () => {
              db.close()
              reject(tx.error)
            }

            const getReq = store.get(id)
            getReq.onsuccess = () => {
              if (getReq.result !== undefined) {
                store.delete(id)
                isLiked = false
              } else {
                store.put({ id })
                isLiked = true
              }
            }
          }
          openReq.onerror = (e) => reject(openReq.error)
        })
      }
    }
  }
})
