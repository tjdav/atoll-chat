import { definePlugin } from 'coralite'

/**
 * Local Database Plugin for Atoll Chat.
 * Uses Dexie.js for IndexedDB management as a zero-knowledge local cache.
 */
export default function localDbPlugin () {
  return definePlugin({
    name: 'local-db',
    client: {
      name: 'localDb',
      context: (pluginContext) => {
        let dbPromise = null

        const getDb = async () => {
          if (!dbPromise) {
            dbPromise = (async () => {
              // Dynamically import Dexie inside the initialization hook as requested.
              const { default: Dexie } = await import('dexie')

              // Create the Dexie database instance once in this scope.
              const dbInstance = new Dexie('AtollChatDB')

              // Define the database schema.
              // Primary key is the first field, following fields are indexes for searching and sorting.
              dbInstance.version(3).stores({
                local_rooms: 'id, is_group, updated_at',
                local_messages: 'id, room_id, created_at, [room_id+created_at], type',
                local_assets: 'id, room_id, mime_type, created_at',
                local_config: 'key'
              })

              // Request persistent storage from the browser to prevent data loss.
              if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
                try {
                  const isPersisted = await navigator.storage.persist()
                  if (!isPersisted) {
                    console.warn('Persistent storage was not granted by the browser.')
                  }
                } catch (storageError) {
                  console.error('Error requesting persistent storage:', storageError)
                }
              }
              return dbInstance
            })()
          }
          return dbPromise
        }

        // Inject into pluginContext for Phase 1 access by downstream plugins
        pluginContext.$localDb = getDb

        return async (instanceContext) => {
          return {
            $localDb: await getDb()
          }
        }
      }
    }
  })
}
