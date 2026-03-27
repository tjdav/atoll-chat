import { createPlugin } from 'coralite'
export default createPlugin({
  name: 'user-preferences-plugin',
  client: {
    setup (context) {
      const DB_NAME = 'atoll-user-preferences'
      let isInitialized = false
      const initDB = () => {
        if (isInitialized) {
          return Promise.resolve()
        }
        return new Promise((resolve, reject) => {
          const checkReq = window.indexedDB.open(DB_NAME)
          checkReq.onerror = event => reject(checkReq.error)
          checkReq.onsuccess = event => {
            const db = event.target.result
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
              upgradeReq.onupgradeneeded = event => {
                const upgradeDb = event.target.result
                if (!upgradeDb.objectStoreNames.contains('preferences')) {
                  upgradeDb.createObjectStore('preferences')
                }
                if (!upgradeDb.objectStoreNames.contains('likes')) {
                  upgradeDb.createObjectStore('likes', {
                    keyPath: 'id'
                  })
                }
              }
              upgradeReq.onsuccess = event => {
                isInitialized = true
                event.target.result.close()
                resolve()
              }
              upgradeReq.onerror = event => reject(upgradeReq.error)
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
      getPreference: globalContext => localContext => async key => {
        await localContext.values.initDB()
        return new Promise((resolve, reject) => {
          const openReq = window.indexedDB.open(localContext.values.DB_NAME)
          openReq.onsuccess = event => {
            const db = event.target.result
            const transaction = db.transaction('preferences', 'readonly')
            const store = transaction.objectStore('preferences')
            let result = null
            transaction.oncomplete = () => {
              db.close()
              resolve(result)
            }
            transaction.onerror = () => {
              db.close()
              reject(transaction.error)
            }
            const getReq = store.get(key)
            getReq.onsuccess = () => {
              result = getReq.result
            }
          }
          openReq.onerror = event => reject(openReq.error)
        })
      },
      setPreference: globalContext => localContext => async (key, value) => {
        await localContext.values.initDB()
        return new Promise((resolve, reject) => {
          const openReq = window.indexedDB.open(localContext.values.DB_NAME)
          openReq.onsuccess = event => {
            const db = event.target.result
            const transaction = db.transaction('preferences', 'readwrite')
            const store = transaction.objectStore('preferences')
            transaction.oncomplete = () => {
              db.close()
              resolve()
            }
            transaction.onerror = () => {
              db.close()
              reject(transaction.error)
            }
            if (value === null || value === undefined) {
              store.delete(key)
            } else {
              store.put(value, key)
            }
          }
          openReq.onerror = event => reject(openReq.error)
        })
      },
      getLikes: globalContext => localContext => async () => {
        await localContext.values.initDB()
        return new Promise((resolve, reject) => {
          const openReq = window.indexedDB.open(localContext.values.DB_NAME)
          openReq.onsuccess = event => {
            const db = event.target.result
            const transaction = db.transaction('likes', 'readonly')
            const store = transaction.objectStore('likes')
            let result = []
            transaction.oncomplete = () => {
              db.close()
              resolve(result)
            }
            transaction.onerror = () => {
              db.close()
              reject(transaction.error)
            }
            const request = store.getAll()
            request.onsuccess = () => {
              result = request.result.map(item => item.id)
            }
          }
          openReq.onerror = event => reject(openReq.error)
        })
      },
      getLike: globalContext => localContext => async id => {
        await localContext.values.initDB()
        return new Promise((resolve, reject) => {
          const openReq = window.indexedDB.open(localContext.values.DB_NAME)
          openReq.onsuccess = event => {
            const db = event.target.result
            const transaction = db.transaction('likes', 'readonly')
            const store = transaction.objectStore('likes')
            let result = false
            transaction.oncomplete = () => {
              db.close()
              resolve(result)
            }
            transaction.onerror = () => {
              db.close()
              reject(transaction.error)
            }
            const request = store.get(id)
            request.onsuccess = () => {
              result = request.result !== undefined
            }
          }
          openReq.onerror = event => reject(openReq.error)
        })
      },
      toggleLike: globalContext => localContext => async id => {
        await localContext.values.initDB()
        return new Promise((resolve, reject) => {
          const openReq = window.indexedDB.open(localContext.values.DB_NAME)
          openReq.onsuccess = event => {
            const db = event.target.result
            const transaction = db.transaction('likes', 'readwrite')
            const store = transaction.objectStore('likes')
            let isLiked = false
            transaction.oncomplete = () => {
              db.close()
              resolve(isLiked)
            }
            transaction.onerror = () => {
              db.close()
              reject(transaction.error)
            }
            const getReq = store.get(id)
            getReq.onsuccess = () => {
              if (getReq.result !== undefined) {
                store.delete(id)
                isLiked = false
              } else {
                store.put({
                  id
                })
                isLiked = true
              }
            }
          }
          openReq.onerror = event => reject(openReq.error)
        })
      }
    }
  }
})
