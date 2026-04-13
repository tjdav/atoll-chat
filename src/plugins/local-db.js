import { createPlugin } from 'coralite'

export default createPlugin({
  name: 'local-db-plugin',
  client: {
    imports: [
      {
        specifier: 'idb',
        namedExports: ['openDB']
      }
    ],
    setup (context) {
      const { openDB } = context.imports

      const DB_NAME = 'atoll-local-vault'
      const DB_VERSION = 1

      let dbPromise = null

      const initDB = () => {
        if (!dbPromise) {
          dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade (db) {
              if (!db.objectStoreNames.contains('identity_keys')) {
                db.createObjectStore('identity_keys', {
                  keyPath: 'userId',
                  autoIncrement: false
                })
              }
              if (!db.objectStoreNames.contains('room_keys')) {
                const roomKeysStore = db.createObjectStore('room_keys', {
                  keyPath: 'roomId',
                  autoIncrement: false
                })
                roomKeysStore.createIndex('senderKey', 'senderKey', {
                  unique: false,
                  multiEntry: true
                })
              }
              if (!db.objectStoreNames.contains('message_cache')) {
                const messageCacheStore = db.createObjectStore('message_cache', {
                  keyPath: 'eventId',
                  autoIncrement: false
                })
                messageCacheStore.createIndex('room_time', ['roomId', 'timestamp'], { unique: false })
              }
              if (!db.objectStoreNames.contains('sync_state')) {
                db.createObjectStore('sync_state', {
                  keyPath: 'key',
                  autoIncrement: false
                })
              }
            }
          })
        }
        return dbPromise
      }

      const getDB = () => {
        if (!dbPromise) {
          return initDB()
        }
        return dbPromise
      }

      return {
        initDB,
        getDB
      }
    },
    helpers: {
      getLocalDB: (globalContext) => {
        return () => globalContext.values.getDB()
      }
    }
  }
})
