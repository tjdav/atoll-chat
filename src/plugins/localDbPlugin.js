import { definePlugin } from 'coralite'

/**
 * Local Database Plugin for Atoll Chat.
 * Uses Dexie.js for IndexedDB management as a zero-knowledge local cache.
 */
export default definePlugin({
  name: 'local-db',
  client: {
    context: {
      /**
       * $localDb context provider.
       * Dynamically imports Dexie, initializes the database, and requests persistence.
       * This "first currying function" runs once during application bootstrap.
       *
       * @param {Object} globalContext - The global application context.
       * @returns {Promise<Function>} A promise that resolves to the instance injector.
       */
      $localDb: async (globalContext) => {
        // Dynamically import Dexie inside the initialization hook as requested.
        const { default: Dexie } = await import('dexie')

        // Create the Dexie database instance once in this scope.
        const db = new Dexie('AtollChatDB')

        // Define the database schema.
        // Primary key is the first field, following fields are indexes for searching and sorting.
        db.version(1).stores({
          local_rooms: 'id, is_group',
          local_messages: 'id, room_id, [room_id+created_at], type',
          local_assets: 'id, room_id, mime_type, created_at'
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

        // Return the instance injector function (the "second currying function").
        // Components can access the database instance natively via this.$localDb.
        return (instanceContext) => db
      }
    }
  }
})
