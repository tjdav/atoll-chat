import { Dexie } from 'dexie'

/**
 * Web Storage Adapter for Atoll Chat.
 * Standardizes Dexie/IndexedDB operations under a unified interface.
 */

/**
 *
 */
export function createWebStorageAdapter () {
  let dbInstance = null

  return {
    /**
     * Initializes the Dexie database and opens the connection.
     */
    initialize: async (customDbName) => {
      let activeId = null
      if (typeof localStorage !== 'undefined') {
        try {
          activeId = localStorage.getItem('atoll_active_instance_id')
        } catch {
        }
      }
      const name = customDbName || (activeId ? 'atoll_data_' + activeId : null)
      if (!name) {
        console.log('[WebStorageAdapter] Deferring database initialization until instance ID or custom DB name is set.')
        return null
      }
      console.log('[WebStorageAdapter] initialize starting for:', name)
      if (dbInstance) {
        if (dbInstance.name === name) {
          console.log('[WebStorageAdapter] Already initialized to:', name)
          return dbInstance
        }
        console.log('[WebStorageAdapter] Closing existing db:', dbInstance.name)
        await dbInstance.close()
        console.log('[WebStorageAdapter] Existing db closed')
      }

      try {
        dbInstance = new Dexie(name)
        console.log('[WebStorageAdapter] Dexie instance created for:', name)

        console.log('[WebStorageAdapter] Step A: before stores')
        try {
          dbInstance.version(11).stores({
            local_rooms: 'id, is_group, updated_at',
            local_messages: 'local_uuid, id, room_id, created_at, type, target_id, [room_id+created_at]',
            local_assets: 'id, room_id, message_id, mime_type, created_at',
            local_config: 'key',
            local_files: 'name'
          })
        } catch (schemaErr) {
          console.warn('[WebStorageAdapter] Version schema warning:', schemaErr)
        }

        console.log('[WebStorageAdapter] Step B: before open')
        await dbInstance.open()
        console.log('[WebStorageAdapter] Step C: after open')
      } catch (err) {
        console.error('[WebStorageAdapter] Error opening db:', err)
        // If IndexedDB fails to open in restricted browser contexts (e.g. headless Firefox), construct dummy fallback tables
        if (dbInstance) {
          dbInstance._hasOpenError = true
        }
      }

      // Expose to window for E2E testing compatibility
      if (typeof window !== 'undefined') {
        window.$localDb = dbInstance
      }

      return dbInstance
    },

    /**
     * Low-level record save.
     */
    saveRecord: async (storeName, data) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.table(storeName).put(data)
    },

    /**
     * Low-level record bulk save.
     */
    saveRecordsBulk: async (storeName, records) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.table(storeName).bulkPut(records)
    },

    /**
     * Low-level record delete.
     */
    deleteRecord: async (storeName, key) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.table(storeName).delete(key)
    },

    /**
     * Stores encrypted media blobs natively in IndexedDB.
     */
    saveFile: async (fileName, blob) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.table('local_files').put({
        name: fileName,
        blob
      })
    },

    /**
     * Retrieves the blob for decryption.
     */
    getFile: async (fileName) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const record = await dbInstance.table('local_files').get(fileName)
      return record ? record.blob : null
    },

    // Config Domain
    getConfig: async (key) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const record = await dbInstance.local_config.get(key)
      return record ? record.value : null
    },

    getConfigRecord: async (key) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_config.get(key)
    },

    saveConfig: async (key, value) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_config.put({
        key,
        value
      })
    },

    saveConfigs: async (configs) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_config.bulkPut(configs)
    },

    deleteConfig: async (key) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_config.delete(key)
    },

    // Room Domain
    getRoom: async (id) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_rooms.get(id)
    },

    saveRoom: async (room) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_rooms.put(room)
    },

    updateRoom: async (id, changes) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_rooms.update(id, changes)
    },

    deleteRoomData: async (roomId) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      await dbInstance.local_messages.where('room_id').equals(roomId).delete()
      await dbInstance.local_assets.where('room_id').equals(roomId).delete()
      await dbInstance.local_rooms.delete(roomId)
      return true
    },

    updateRoomMemberState: async (roomId, userId, memberState) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const room = await dbInstance.local_rooms.get(roomId)
      if (room && room.participants) {
        const pIndex = room.participants.findIndex(p => p.id === userId)
        if (pIndex !== -1) {
          if (memberState.last_read_message_id !== undefined) {
            room.participants[pIndex].last_read_message_id = memberState.last_read_message_id
          }
          if (memberState.is_muted !== undefined) {
            room.participants[pIndex].is_muted = memberState.is_muted
          }
          await dbInstance.local_rooms.put(room)
        }
      }
      return true
    },

    updateRoomsWithParticipant: async (userId, participantData) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const rooms = await dbInstance.local_rooms.toArray()
      const updatedRooms = []
      for (const room of rooms) {
        if (room.participants) {
          const pIndex = room.participants.findIndex(p => p.id === userId)
          if (pIndex !== -1) {
            room.participants[pIndex].name = participantData.name
            room.participants[pIndex].username = participantData.username
            room.participants[pIndex].avatar = participantData.avatar
            updatedRooms.push(room)
          }
        }
      }
      if (updatedRooms.length > 0) {
        await dbInstance.local_rooms.bulkPut(updatedRooms)
      }
      return updatedRooms.map(r => r.id)
    },

    getAllRoomsSorted: async (lastTimestamp, batchSize) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      let query = dbInstance.local_rooms.reverse()
      if (lastTimestamp) {
        query = query.filter(item => item.updated_at < lastTimestamp)
      }
      if (batchSize) {
        query = query.limit(batchSize)
      }
      return query.toArray()
    },

    getLatestGlobalRoom: async () => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_rooms.orderBy('updated_at').last()
    },

    // Message Domain
    getMessage: async (localUuid) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_messages.get(localUuid)
    },

    saveMessage: async (message) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_messages.put(message)
    },

    updateMessage: async (localUuid, changes) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_messages.update(localUuid, changes)
    },

    getAbsoluteLatestMessage: async (roomId) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const messages = await dbInstance.local_messages
        .where('[room_id+created_at]')
        .between([roomId, ''], [roomId, '\uffff'])
        .reverse()
        .toArray()
      return messages[0] || null
    },

    getMessagesByRoom: async (roomId, limit) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      let query = dbInstance.local_messages.where('room_id').equals(roomId)
      if (limit) {
        // Dexie sortBy is performed in memory or on index, let's keep it consistent
        const raw = await query.sortBy('created_at')
        return raw.slice(0, limit)
      }
      return query.sortBy('created_at')
    },

    getMessagesByRoomCursor: async (roomId, lastItem, batchSize) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      let query = dbInstance.local_messages.where('room_id').equals(roomId)
      const allMatching = await query.sortBy('created_at')
      let startIndex = 0
      if (lastItem) {
        startIndex = allMatching.findIndex(a => a.local_uuid === lastItem.local_uuid) + 1
      }
      return allMatching.slice(startIndex, startIndex + batchSize)
    },

    getLatestMessage: async (roomId) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const messages = await dbInstance.local_messages
        .where('[room_id+created_at]')
        .between([roomId, ''], [roomId, '\uffff'])
        .reverse()
        .toArray()
      return messages.find(m => m.type !== 'reaction' && m.type !== 'ice_candidate')
    },

    getLatestGlobalMessage: async () => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_messages.orderBy('created_at').last()
    },

    getLinkMessages: async () => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_messages.where('type').equals('link').reverse().sortBy('created_at')
    },

    getMessageReactions: async (targetIds) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const ids = Array.isArray(targetIds) ? targetIds : [targetIds]
      return dbInstance.local_messages.where('target_id').anyOf(ids).toArray()
    },

    // Asset Domain
    getAsset: async (id) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_assets.get(id)
    },

    saveAsset: async (asset) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_assets.put(asset)
    },

    getAssetsByCategory: async (category, lastItem, batchSize) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      let query
      if (category === 'image') {
        query = dbInstance.local_assets.where('mime_type').startsWith('image/').reverse()
      } else if (category === 'video') {
        query = dbInstance.local_assets.where('mime_type').startsWith('video/').reverse()
      } else if (category === 'audio') {
        query = dbInstance.local_assets.where('mime_type').startsWith('audio/').reverse()
      } else if (category === 'document') {
        query = dbInstance.local_assets.where('mime_type').notEqual('image/').and(a => !a.mime_type.startsWith('video/') && !a.mime_type.startsWith('audio/')).reverse()
      } else {
        query = dbInstance.local_assets.reverse()
      }

      if (category === 'document' && !lastItem && !batchSize) {
        // Handle custom sort for document-list (allAssets)
        return dbInstance.local_assets.reverse().sortBy('created_at')
      }

      const allMatching = await query.toArray()
      let startIndex = 0
      if (lastItem) {
        startIndex = allMatching.findIndex(a => a.id === lastItem.id) + 1
      }
      if (batchSize) {
        return allMatching.slice(startIndex, startIndex + batchSize)
      }
      return allMatching
    }
  }
}
