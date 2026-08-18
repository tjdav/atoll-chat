import { Dexie } from 'dexie'

/**
 * Factory function to create a platform-agnostic web storage adapter.
 * Standardizes Dexie/IndexedDB operations under a unified interface.
 *
 * @returns {Object} An object containing all the storage adapter interface methods.
 */
export function createWebStorageAdapter () {
  /**
   * The active Dexie database instance.
   * @type {Dexie|null}
   */
  let dbInstance = null

  return {
    /**
     * Initializes the Dexie database and opens the connection.
     *
     * @param {string} [customDbName] - An optional custom database name.
     * @returns {Promise<Dexie|null>} Resolves with the Dexie instance or null if deferred.
     * @throws {Error} Re-throws unexpected errors that occur during database initialization or localStorage retrieval.
     */
    initialize: async (customDbName) => {
      let activeId = null
      if (typeof localStorage !== 'undefined') {
        try {
          activeId = localStorage.getItem('atoll_active_instance_id')
        } catch (err) {
          const isExpected = err instanceof Error && (
            err.name === 'SecurityError' ||
            err.name === 'NotAllowedError' ||
            err.message.includes('localStorage')
          )
          if (!isExpected) {
            throw err
          }
        }
      }
      const name = customDbName || (activeId ? 'atoll_data_' + activeId : null)
      if (!name) {
        return null
      }
      if (dbInstance) {
        if (dbInstance.name === name) {
          return dbInstance
        }
        await dbInstance.close()
      }

      try {
        dbInstance = new Dexie(name)
        try {
          dbInstance.version(11).stores({
            local_rooms: 'id, is_group, updated_at',
            local_messages: 'local_uuid, id, room_id, created_at, type, target_id, [room_id+created_at]',
            local_assets: 'id, room_id, message_id, mime_type, created_at',
            local_config: 'key',
            local_files: 'name'
          })
        } catch (err) {
          if (err instanceof Error) {
            throw err
          }
          throw new Error(String(err))
        }

        await dbInstance.open()
      } catch (err) {
        // If IndexedDB fails to open in restricted browser contexts (e.g. headless Firefox), construct dummy fallback flags
        const isExpected = err instanceof Error && (
          err.name === 'SecurityError' ||
          err.name === 'OpenFailedError' ||
          err.name === 'VersionError' ||
          err.name === 'UnknownError' ||
          err.message.includes('IndexedDB') ||
          err.message.includes('open')
        )
        if (!isExpected) {
          throw err
        }
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
     *
     * @param {string} storeName - The name of the Dexie store.
     * @param {Object} data - The record data object to put in the store.
     * @returns {Promise<*>} Resolves with the key of the inserted/updated record.
     * @throws {Error} Throws if the database is not initialized.
     */
    saveRecord: async (storeName, data) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.table(storeName).put(data)
    },

    /**
     * Low-level record bulk save.
     *
     * @param {string} storeName - The name of the Dexie store.
     * @param {Array<Object>} records - An array of record data objects.
     * @returns {Promise<*>} Resolves when the bulk operation is complete.
     * @throws {Error} Throws if the database is not initialized.
     */
    saveRecordsBulk: async (storeName, records) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.table(storeName).bulkPut(records)
    },

    /**
     * Low-level record delete.
     *
     * @param {string} storeName - The name of the Dexie store.
     * @param {*} key - The key of the record to delete.
     * @returns {Promise<void>} Resolves when deletion is complete.
     * @throws {Error} Throws if the database is not initialized.
     */
    deleteRecord: async (storeName, key) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.table(storeName).delete(key)
    },

    /**
     * Stores encrypted media blobs natively in IndexedDB.
     *
     * @param {string} fileName - The name of the file.
     * @param {Blob} blob - The file content blob.
     * @returns {Promise<*>} Resolves with the key of the inserted file.
     * @throws {Error} Throws if the database is not initialized.
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
     *
     * @param {string} fileName - The name of the file.
     * @returns {Promise<Blob|null>} Resolves with the file blob, or null if not found.
     * @throws {Error} Throws if the database is not initialized.
     */
    getFile: async (fileName) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const record = await dbInstance.table('local_files').get(fileName)
      return record ? record.blob : null
    },

    /**
     * Retrieves a config value by key.
     *
     * @param {string} key - The config key.
     * @returns {Promise<*|null>} Resolves with the config value, or null if not found.
     * @throws {Error} Throws if the database is not initialized.
     */
    getConfig: async (key) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const record = await dbInstance.local_config.get(key)
      return record ? record.value : null
    },

    /**
     * Retrieves a config record by key.
     *
     * @param {string} key - The config key.
     * @returns {Promise<Object|null>} Resolves with the full config record, or null if not found.
     * @throws {Error} Throws if the database is not initialized.
     */
    getConfigRecord: async (key) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_config.get(key)
    },

    /**
     * Saves a config key-value pair.
     *
     * @param {string} key - The config key.
     * @param {*} value - The config value.
     * @returns {Promise<*>} Resolves with the key.
     * @throws {Error} Throws if the database is not initialized.
     */
    saveConfig: async (key, value) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_config.put({
        key,
        value
      })
    },

    /**
     * Saves multiple config key-value pairs in bulk.
     *
     * @param {Array<Object>} configs - An array of config records.
     * @returns {Promise<*>} Resolves when the bulk operation is complete.
     * @throws {Error} Throws if the database is not initialized.
     */
    saveConfigs: async (configs) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_config.bulkPut(configs)
    },

    /**
     * Deletes a config record by key.
     *
     * @param {string} key - The config key to delete.
     * @returns {Promise<void>} Resolves when deletion is complete.
     * @throws {Error} Throws if the database is not initialized.
     */
    deleteConfig: async (key) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_config.delete(key)
    },

    /**
     * Retrieves a local room by ID.
     *
     * @param {string} id - The unique room ID.
     * @returns {Promise<Object|null>} Resolves with the room object, or null if not found.
     * @throws {Error} Throws if the database is not initialized.
     */
    getRoom: async (id) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_rooms.get(id)
    },

    /**
     * Saves a room record.
     *
     * @param {Object} room - The room data object.
     * @returns {Promise<*>} Resolves with the room ID.
     * @throws {Error} Throws if the database is not initialized.
     */
    saveRoom: async (room) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      room.weight = Number(room.weight ?? 0)
      return dbInstance.local_rooms.put(room)
    },

    /**
     * Updates an existing room record with changes.
     *
     * @param {string} id - The room ID to update.
     * @param {Object} changes - The properties to update.
     * @returns {Promise<number>} Resolves with the number of affected rows (0 or 1).
     * @throws {Error} Throws if the database is not initialized.
     */
    updateRoom: async (id, changes) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_rooms.update(id, changes)
    },

    /**
     * Deletes all local messages, local assets, and the room record for a given room.
     *
     * @param {string} roomId - The unique ID of the room.
     * @returns {Promise<boolean>} Resolves to true when the deletion completes successfully.
     * @throws {Error} Throws if the database is not initialized.
     */
    deleteRoomData: async (roomId) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      await dbInstance.local_messages.where('room_id').equals(roomId).delete()
      await dbInstance.local_assets.where('room_id').equals(roomId).delete()
      await dbInstance.local_rooms.delete(roomId)
      return true
    },

    /**
     * Updates a specific participant's state in a local room.
     *
     * @param {string} roomId - The room ID.
     * @param {string} userId - The user ID of the participant.
     * @param {Object} memberState - The dynamic member state changes (e.g., last_read_message_id, is_muted, is_typing).
     * @returns {Promise<boolean>} Resolves to true when the update is complete.
     * @throws {Error} Throws if the database is not initialized.
     */
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
          if (memberState.is_typing !== undefined) {
            room.participants[pIndex].is_typing = memberState.is_typing
          }
          await dbInstance.local_rooms.put(room)
        }
      }
      return true
    },

    /**
     * Updates all local rooms having a participant with new participant profile data.
     *
     * @param {string} userId - The target participant user ID.
     * @param {Object} participantData - The updated participant data (e.g., name, username, avatar).
     * @returns {Promise<Array<string>>} Resolves with an array of room IDs that were updated.
     * @throws {Error} Throws if the database is not initialized.
     */
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

    /**
     * Retrieves all rooms sorted strictly by descending room weight.
     * Supports index/ID cursor pagination and batch size limits.
     *
     * @param {string|Object} [lastItemOrCursor] - Cursor item, room object, or room ID to paginate after.
     * @param {number} [batchSize] - Maximum number of rooms to retrieve.
     * @returns {Promise<Array<Object>>} Resolves with sorted room records.
     * @throws {Error} Throws if the database is not initialized.
     */
    getAllRoomsSorted: async (lastItemOrCursor, batchSize) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const rooms = await dbInstance.local_rooms.toArray()

      rooms.sort((a, b) => Number(b.weight ?? 0) - Number(a.weight ?? 0))
      let filtered = rooms
      if (lastItemOrCursor) {
        const targetId = typeof lastItemOrCursor === 'object' && lastItemOrCursor !== null
          ? (lastItemOrCursor.id || lastItemOrCursor.item?.id)
          : lastItemOrCursor
        const idx = rooms.findIndex(r => r.id === targetId)
        if (idx !== -1) {
          filtered = rooms.slice(idx + 1)
        }
      }
      if (batchSize) {
        filtered = filtered.slice(0, batchSize)
      }
      return filtered
    },

    /**
     * Retrieves the single room record with the absolute latest updated_at timestamp.
     *
     * @returns {Promise<Object|null>} Resolves with the latest room, or null if empty.
     * @throws {Error} Throws if the database is not initialized.
     */
    getLatestGlobalRoom: async () => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const rooms = await dbInstance.local_rooms.toArray()
      rooms.sort((a, b) => {
        const ta = new Date(a.updated_at || a.created_at || 0).getTime()
        const tb = new Date(b.updated_at || b.created_at || 0).getTime()
        return ta - tb
      })
      return rooms[rooms.length - 1] || null
    },

    /**
     * Retrieves a local message record by its local UUID.
     *
     * @param {string} localUuid - The local UUID of the message.
     * @returns {Promise<Object|null>} Resolves with the message, or null if not found.
     * @throws {Error} Throws if the database is not initialized.
     */
    getMessage: async (localUuid) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_messages.get(localUuid)
    },

    /**
     * Saves or overwrites a local message record.
     *
     * @param {Object} message - The message record.
     * @returns {Promise<*>} Resolves with the message local UUID.
     * @throws {Error} Throws if the database is not initialized.
     */
    saveMessage: async (message) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_messages.put(message)
    },

    /**
     * Updates an existing message record with changes.
     *
     * @param {string} localUuid - The local UUID of the message.
     * @param {Object} changes - The fields and values to update.
     * @returns {Promise<number>} Resolves with the number of updated records.
     * @throws {Error} Throws if the database is not initialized.
     */
    updateMessage: async (localUuid, changes) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_messages.update(localUuid, changes)
    },

    /**
     * Retrieves the absolute latest message in a room.
     *
     * @param {string} roomId - The target room ID.
     * @returns {Promise<Object|null>} Resolves with the latest message record, or null if none.
     * @throws {Error} Throws if the database is not initialized.
     */
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

    /**
     * Retrieves local messages for a room, sorted by creation timestamp.
     * Supports a limiting count of records to fetch.
     *
     * @param {string} roomId - The target room ID.
     * @param {number} [limit] - The maximum number of messages to retrieve.
     * @returns {Promise<Array<Object>>} Resolves with the retrieved sorted messages.
     * @throws {Error} Throws if the database is not initialized.
     */
    getMessagesByRoom: async (roomId, limit) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      if (limit) {
        const raw = await dbInstance.local_messages
          .where('[room_id+created_at]')
          .between([roomId, Dexie.minKey], [roomId, Dexie.maxKey])
          .reverse()
          .limit(limit)
          .toArray()
        return raw.reverse()
      }
      return dbInstance.local_messages
        .where('[room_id+created_at]')
        .between([roomId, Dexie.minKey], [roomId, Dexie.maxKey])
        .toArray()
    },

    /**
     * Retrieves room messages after a cursor message in order of creation timestamp.
     *
     * @param {string} roomId - The target room ID.
     * @param {Object} [lastItem] - The cursor message to start after.
     * @param {number} batchSize - The batch size of messages to retrieve.
     * @returns {Promise<Array<Object>>} Resolves with a slice of matching sorted messages.
     * @throws {Error} Throws if the database is not initialized.
     */
    getMessagesByRoomCursor: async (roomId, lastItem, batchSize) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const query = dbInstance.local_messages.where('room_id').equals(roomId)
      const allMatching = await query.sortBy('created_at')
      let startIndex = 0
      if (lastItem) {
        startIndex = allMatching.findIndex(a => a.local_uuid === lastItem.local_uuid) + 1
      }
      return allMatching.slice(startIndex, startIndex + batchSize)
    },

    /**
     * Retrieves room messages created before a given timestamp or message.
     *
     * @param {string} roomId - The target room ID.
     * @param {string} beforeTime - ISO date string or timestamp.
     * @param {number} [limit=50] - Number of messages to fetch.
     * @returns {Promise<Array<Object>>} Sorted ascendingly by created_at.
     * @throws {Error} Throws if the database is not initialized.
     */
    getMessagesByRoomBefore: async (roomId, beforeTime, limit = 50) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const all = await dbInstance.local_messages
        .where('room_id')
        .equals(roomId)
        .toArray()
      const targetTime = new Date(beforeTime).getTime()
      const filtered = all.filter(m => new Date(m.created_at || 0).getTime() < targetTime)
      filtered.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      return filtered.slice(-limit)
    },

    /**
     * Retrieves a window of messages centered around a specific target message ID.
     *
     * @param {string} roomId - The target room ID.
     * @param {string} messageId - The target message ID or local_uuid.
     * @param {number} [windowSize=50] - Window size around the target message.
     * @returns {Promise<Array<Object>>} Sorted ascendingly.
     * @throws {Error} Throws if the database is not initialized.
     */
    getMessagesByRoomAround: async (roomId, messageId, windowSize = 50) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const all = await dbInstance.local_messages
        .where('room_id')
        .equals(roomId)
        .toArray()
      const index = all.findIndex(m => m.id === messageId || m.local_uuid === messageId)
      if (index === -1) {
        return all.slice(-windowSize)
      }
      const half = Math.floor(windowSize / 2)
      const start = Math.max(0, index - half)
      return all.slice(start, start + windowSize)
    },

    /**
     * Retrieves the latest non-reaction, non-signaling message in a room.
     *
     * @param {string} roomId - The target room ID.
     * @returns {Promise<Object|null>} Resolves with the message, or null if none exist.
     * @throws {Error} Throws if the database is not initialized.
     */
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

    /**
     * Retrieves the single local message with the absolute latest creation timestamp.
     *
     * @returns {Promise<Object|null>} Resolves with the message, or null if none.
     * @throws {Error} Throws if the database is not initialized.
     */
    getLatestGlobalMessage: async () => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_messages.orderBy('created_at').last()
    },

    /**
     * Retrieves all messages containing links, sorted descending by creation timestamp.
     *
     * @returns {Promise<Array<Object>>} Resolves with sorted link messages.
     * @throws {Error} Throws if the database is not initialized.
     */
    getLinkMessages: async () => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_messages.where('type').equals('link').reverse().sortBy('created_at')
    },

    /**
     * Retrieves reaction messages targeted to a specific message ID or multiple IDs.
     *
     * @param {string|Array<string>} targetIds - The target message ID or array of IDs.
     * @returns {Promise<Array<Object>>} Resolves with an array of matching reaction messages.
     * @throws {Error} Throws if the database is not initialized.
     */
    getMessageReactions: async (targetIds) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      const ids = Array.isArray(targetIds) ? targetIds : [targetIds]
      return dbInstance.local_messages.where('target_id').anyOf(ids).toArray()
    },

    /**
     * Retrieves an asset record by ID.
     *
     * @param {string} id - The unique ID of the asset.
     * @returns {Promise<Object|null>} Resolves with the asset object, or null if not found.
     * @throws {Error} Throws if the database is not initialized.
     */
    getAsset: async (id) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_assets.get(id)
    },

    /**
     * Saves or overwrites an asset record.
     *
     * @param {Object} asset - The asset data object.
     * @returns {Promise<*>} Resolves with the asset ID.
     * @throws {Error} Throws if the database is not initialized.
     */
    saveAsset: async (asset) => {
      if (!dbInstance) {
        throw new Error('Database not initialized')
      }
      return dbInstance.local_assets.put(asset)
    },

    /**
     * Retrieves and filters asset records by mime-type category, sorted descending by creation timestamp.
     * Supports cursor pagination and batch size limits.
     *
     * @param {string} category - The mime-type category ('image', 'video', 'audio', 'document', or other).
     * @param {Object} [lastItem] - The cursor asset record to start after.
     * @param {number} [batchSize] - The batch size of assets to retrieve.
     * @returns {Promise<Array<Object>>} Resolves with sorted, filtered asset records.
     * @throws {Error} Throws if the database is not initialized.
     */
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
