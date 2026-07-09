import { definePlugin } from 'coralite'

/**
 * Local Database Plugin for Atoll Chat.
 * Uses Dexie.js for IndexedDB management as a zero-knowledge local cache.
 */
export default function localDbPlugin () {
  return definePlugin({
    name: 'localDb',
    client: {
      context: async (pluginContext) => {
        /**
         * @typedef {typeof import('dexie').Dexie} DexieConstructor
         */
        /** @type {DexieConstructor} */
        const Dexie = (await import('dexie')).Dexie

        // Create the Dexie database instance once in this scope.
        const dbInstance = new Dexie('AtollChatDB')

        // Define the database schema.
        dbInstance.version(9).stores({
          local_rooms: 'id, is_group, updated_at',
          local_messages: 'local_uuid, id, room_id, created_at, [room_id+created_at], type, target_id',
          local_assets: 'id, room_id, message_id, mime_type, created_at',
          local_config: 'key'
        })

        // Attempt to request persistent storage for local IndexedDB cache
        if (navigator.storage && navigator.storage.persist) {
          try {
            const isPersisted = await navigator.storage.persist()
            if (!isPersisted) {
              console.warn('Persistent storage was not granted by the browser.')
            }
          } catch (storageError) {
            console.error('Error requesting persistent storage:', storageError)
          }
        }

        await dbInstance.open()

        /** @todo remove when coralite has testing env */
        // Expose to window for E2E testing
        /**
         * @typedef {Object} CustomWindow
         * @property {import('dexie').Dexie} [$localDb]
         */
        /** @type {CustomWindow & typeof globalThis} */
        const win = window
        win.$localDb = dbInstance

        // Inject into pluginContext for Phase 1 access by downstream plugins
        pluginContext.$localDb = () => dbInstance

        return () => {
          return {
            $localDb: dbInstance
          }
        }
      }
    }
  })
}
