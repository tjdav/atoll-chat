/**
 * Native Storage Adapter Stub for Atoll Chat.
 * Implements a non-blocking performance-oriented chunking mechanism for saveFile
 * and a fallback SQLite emulator in localStorage/memory to ensure platform equivalence.
 */

/**
 * Creates and returns the Native Storage Adapter instance.
 *
 * @returns {Object} The native storage adapter instance containing all API methods.
 */
export function createNativeStorageAdapter () {
  // In-memory/localStorage stores to simulate SQLite persistence on Native
  const localRooms = new Map()
  const localMessages = new Map()
  const localAssets = new Map()
  const localConfig = new Map()
  const localFiles = new Map()

  // Helper to load existing localStorage keys if any
  if (typeof localStorage !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('atoll_sqlite_')) {
          const item = localStorage.getItem(key)
          if (item) {
            const val = JSON.parse(item)
            if (key.includes('_rooms_')) {
              localRooms.set(val.id, val)
            } else if (key.includes('_messages_')) {
              localMessages.set(val.local_uuid, val)
            } else if (key.includes('_assets_')) {
              localAssets.set(val.id, val)
            } else if (key.includes('_config_')) {
              localConfig.set(val.key, val)
            } else if (key.includes('_files_')) {
              localFiles.set(val.name, val)
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && (err.name === 'SecurityError' || err.name === 'QuotaExceededError')) {
        // Gracefully ignore expected security/quota issues by doing nothing
      } else {
        throw err
      }
    }
  }

  /**
   * Helper to persist a serialized record to localStorage as a fallback.
   *
   * @param {string} prefix - The namespace or store name.
   * @param {string} key - The record key.
   * @param {*} value - The record data.
   * @throws {Error} Re-throws unexpected storage/serialization exceptions.
   */
  const persistToLocalStorage = (prefix, key, value) => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`atoll_sqlite_${prefix}_${key}`, JSON.stringify(value))
      } catch (err) {
        if (err instanceof Error && (err.name === 'SecurityError' || err.name === 'QuotaExceededError')) {
          // Gracefully fallback to memory-only when storage is restricted or full
        } else {
          throw err
        }
      }
    }
  }

  /**
   * Helper to remove a record from localStorage.
   *
   * @param {string} prefix - The namespace or store name.
   * @param {string} key - The record key.
   * @throws {Error} Re-throws unexpected deletion/access exceptions.
   */
  const removeFromLocalStorage = (prefix, key) => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(`atoll_sqlite_${prefix}_${key}`)
      } catch (err) {
        if (err instanceof Error && err.name === 'SecurityError') {
          // Gracefully ignore storage security/access restrictions on delete
        } else {
          throw err
        }
      }
    }
  }

  return {
    /**
     * Initializes the SQLite storage adapter.
     *
     * @returns {Promise<boolean>} Resolves to true when initialization succeeds.
     */
    initialize: async () => {
      return true
    },

    /**
     * Stores encrypted media blobs natively using the chunked Performance Guardrail
     * to prevent Out-Of-Memory crashes over the Capacitor JS Bridge.
     *
     * @param {string} fileName - The name of the file to save.
     * @param {Blob} blob - The Blob to save.
     * @returns {Promise<boolean>} Resolves to true when the file is successfully saved.
     */
    saveFile: async (fileName, blob) => {
      // 2MB chunk limit
      const CHUNK_SIZE = 2 * 1024 * 1024
      const totalSize = blob.size
      let offset = 0
      let chunkIndex = 0
      const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)

      while (offset < totalSize) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE)
        // Convert the chunk to ArrayBuffer to simulate reading the file payload
        const buffer = await chunk.arrayBuffer()

        chunkIndex++
        offset += CHUNK_SIZE
      }

      // For stub functionality, keep the metadata and blob in local memory/cache
      localFiles.set(fileName, {
        name: fileName,
        blob
      })
      persistToLocalStorage('files', fileName, {
        name: fileName,
        isMockFile: true
      })
      return true
    },

    /**
     * Retrieves a saved file blob from the file system.
     *
     * @param {string} fileName - The name of the file to retrieve.
     * @returns {Promise<Blob|null>} Resolves to the retrieved Blob, or null if not found.
     */
    getFile: async (fileName) => {
      const file = localFiles.get(fileName)
      return file ? file.blob : null
    },

    /**
     * Saves a single record to the designated local store.
     *
     * @param {string} storeName - The name of the target database store.
     * @param {Object} data - The record data to save.
     * @returns {Promise<boolean>} Resolves to true when the record is saved.
     */
    saveRecord: async (storeName, data) => {
      if (storeName === 'local_rooms') {
        localRooms.set(data.id, data)
        persistToLocalStorage('rooms', data.id, data)
      } else if (storeName === 'local_messages') {
        localMessages.set(data.local_uuid, data)
        persistToLocalStorage('messages', data.local_uuid, data)
      } else if (storeName === 'local_assets') {
        localAssets.set(data.id, data)
        persistToLocalStorage('assets', data.id, data)
      } else if (storeName === 'local_config') {
        localConfig.set(data.key, data)
        persistToLocalStorage('config', data.key, data)
      }
      return true
    },

    /**
     * Bulk saves multiple records to the designated local store.
     *
     * @param {string} storeName - The name of the target database store.
     * @param {Array<Object>} records - An array of record objects to save.
     * @returns {Promise<boolean>} Resolves to true when all records are saved.
     */
    saveRecordsBulk: async (storeName, records) => {
      for (const record of records) {
        if (storeName === 'local_rooms') {
          localRooms.set(record.id, record)
          persistToLocalStorage('rooms', record.id, record)
        } else if (storeName === 'local_messages') {
          localMessages.set(record.local_uuid, record)
          persistToLocalStorage('messages', record.local_uuid, record)
        } else if (storeName === 'local_assets') {
          localAssets.set(record.id, record)
          persistToLocalStorage('assets', record.id, record)
        } else if (storeName === 'local_config') {
          localConfig.set(record.key, record)
          persistToLocalStorage('config', record.key, record)
        }
      }
      return true
    },

    /**
     * Deletes a record from the designated local store.
     *
     * @param {string} storeName - The name of the target database store.
     * @param {string} key - The key of the record to delete.
     * @returns {Promise<boolean>} Resolves to true when the record is deleted.
     */
    deleteRecord: async (storeName, key) => {
      if (storeName === 'local_rooms') {
        localRooms.delete(key)
        removeFromLocalStorage('rooms', key)
      } else if (storeName === 'local_messages') {
        localMessages.delete(key)
        removeFromLocalStorage('messages', key)
      } else if (storeName === 'local_assets') {
        localAssets.delete(key)
        removeFromLocalStorage('assets', key)
      } else if (storeName === 'local_config') {
        localConfig.delete(key)
        removeFromLocalStorage('config', key)
      }
      return true
    },

    // Config Domain
    /**
     * Retrieves a config value by its key.
     *
     * @param {string} key - The configuration key.
     * @returns {Promise<*>} Resolves to the config value, or null if not found.
     */
    getConfig: async (key) => {
      const record = localConfig.get(key)
      return record ? record.value : null
    },

    /**
     * Retrieves a complete config record by its key.
     *
     * @param {string} key - The configuration key.
     * @returns {Promise<Object|null>} Resolves to the config record, or null if not found.
     */
    getConfigRecord: async (key) => {
      return localConfig.get(key) || null
    },

    /**
     * Saves a single configuration value under the specified key.
     *
     * @param {string} key - The configuration key.
     * @param {*} value - The configuration value to save.
     * @returns {Promise<boolean>} Resolves to true when saved.
     */
    saveConfig: async (key, value) => {
      const data = {
        key,
        value
      }
      localConfig.set(key, data)
      persistToLocalStorage('config', key, data)
      return true
    },

    /**
     * Bulk saves multiple configuration records.
     *
     * @param {Array<Object>} configs - An array of configuration records to save.
     * @returns {Promise<boolean>} Resolves to true when all configs are saved.
     */
    saveConfigs: async (configs) => {
      for (const config of configs) {
        localConfig.set(config.key, config)
        persistToLocalStorage('config', config.key, config)
      }
      return true
    },

    /**
     * Deletes a configuration record by its key.
     *
     * @param {string} key - The configuration key to delete.
     * @returns {Promise<boolean>} Resolves to true when deleted.
     */
    deleteConfig: async (key) => {
      localConfig.delete(key)
      removeFromLocalStorage('config', key)
      return true
    },

    // Room Domain
    /**
     * Retrieves a local room record by its ID.
     *
     * @param {string} id - The room ID.
     * @returns {Promise<Object|null>} Resolves to the room record, or null if not found.
     */
    getRoom: async (id) => {
      return localRooms.get(id) || null
    },

    /**
     * Saves a room record locally.
     *
     * @param {Object} room - The room record to save.
     * @returns {Promise<boolean>} Resolves to true when the room is saved.
     */
    saveRoom: async (room) => {
      room.weight = Number(room.weight ?? 0)
      localRooms.set(room.id, room)
      persistToLocalStorage('rooms', room.id, room)
      return true
    },

    /**
     * Updates an existing room record with delta changes.
     *
     * @param {string} id - The room ID to update.
     * @param {Object} changes - The properties to merge.
     * @returns {Promise<boolean>} Resolves to true when the room is updated.
     */
    updateRoom: async (id, changes) => {
      const existing = localRooms.get(id) || {}
      const updated = {
        ...existing,
        ...changes
      }
      localRooms.set(id, updated)
      persistToLocalStorage('rooms', id, updated)
      return true
    },

    /**
     * Deletes all local room data including associated messages and assets.
     *
     * @param {string} roomId - The ID of the room to delete.
     * @returns {Promise<boolean>} Resolves to true when room data is cleared.
     */
    deleteRoomData: async (roomId) => {
      // Remove room messages
      for (const [uuid, msg] of localMessages.entries()) {
        if (msg.room_id === roomId) {
          localMessages.delete(uuid)
          removeFromLocalStorage('messages', uuid)
        }
      }
      // Remove room assets
      for (const [id, asset] of localAssets.entries()) {
        if (asset.room_id === roomId) {
          localAssets.delete(id)
          removeFromLocalStorage('assets', id)
        }
      }
      // Remove room
      localRooms.delete(roomId)
      removeFromLocalStorage('rooms', roomId)
      return true
    },

    /**
     * Updates the status/membership metadata of a participant inside a room.
     *
     * @param {string} roomId - The room ID.
     * @param {string} userId - The participant's user ID.
     * @param {Object} memberState - The updated state properties (e.g. is_muted, last_read_message_id, is_typing).
     * @returns {Promise<boolean>} Resolves to true when the member state is successfully updated.
     */
    updateRoomMemberState: async (roomId, userId, memberState) => {
      const room = localRooms.get(roomId)
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
          localRooms.set(roomId, room)
          persistToLocalStorage('rooms', roomId, room)
        }
      }
      return true
    },

    /**
     * Updates participant profile information across all rooms where they participate.
     *
     * @param {string} userId - The user ID of the participant whose profile changed.
     * @param {Object} participantData - The new profile properties (name, username, avatar).
     * @returns {Promise<Array<string>>} Resolves to an array of room IDs that were modified.
     */
    updateRoomsWithParticipant: async (userId, participantData) => {
      const updatedRoomIds = []
      for (const [id, room] of localRooms.entries()) {
        if (room.participants) {
          const pIndex = room.participants.findIndex(p => p.id === userId)
          if (pIndex !== -1) {
            room.participants[pIndex].name = participantData.name
            room.participants[pIndex].username = participantData.username
            room.participants[pIndex].avatar = participantData.avatar
            localRooms.set(id, room)
            persistToLocalStorage('rooms', id, room)
            updatedRoomIds.push(id)
          }
        }
      }
      return updatedRoomIds
    },

    /**
     * Retrieves all rooms sorted strictly by descending room weight.
     * Supports index/ID cursor pagination and batch size limits.
     *
     * @param {string|Object} [lastItemOrCursor] - Cursor item, room object, or room ID to paginate after.
     * @param {number} [batchSize] - Maximum number of rooms to retrieve.
     * @returns {Promise<Array<Object>>} Resolves to the list of sorted rooms.
     */
    getAllRoomsSorted: async (lastItemOrCursor, batchSize) => {
      let rooms = Array.from(localRooms.values())

      rooms.sort((a, b) => Number(b.weight ?? 0) - Number(a.weight ?? 0))

      if (lastItemOrCursor) {
        const targetId = typeof lastItemOrCursor === 'object' && lastItemOrCursor !== null
          ? (lastItemOrCursor.id || lastItemOrCursor.item?.id)
          : lastItemOrCursor
        const idx = rooms.findIndex(r => r.id === targetId)
        if (idx !== -1) {
          rooms = rooms.slice(idx + 1)
        }
      }
      if (batchSize) {
        rooms = rooms.slice(0, batchSize)
      }
      return rooms
    },

    /**
     * Retrieves the absolute latest room by updated_at timestamp.
     *
     * @returns {Promise<Object|null>} Resolves to the most recently updated room, or null if none.
     */
    getLatestGlobalRoom: async () => {
      const rooms = Array.from(localRooms.values())
      rooms.sort((a, b) => new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime())
      return rooms[rooms.length - 1] || null
    },

    // Message Domain
    /**
     * Retrieves a message record by its local UUID.
     *
     * @param {string} localUuid - The message local unique identifier.
     * @returns {Promise<Object|null>} Resolves to the message record, or null if not found.
     */
    getMessage: async (localUuid) => {
      return localMessages.get(localUuid) || null
    },

    /**
     * Saves a message locally.
     *
     * @param {Object} message - The message record to save.
     * @returns {Promise<boolean>} Resolves to true when the message is saved.
     */
    saveMessage: async (message) => {
      localMessages.set(message.local_uuid, message)
      persistToLocalStorage('messages', message.local_uuid, message)
      return true
    },

    /**
     * Updates an existing message record.
     *
     * @param {string} localUuid - The message UUID to update.
     * @param {Object} changes - The delta properties to merge.
     * @returns {Promise<boolean>} Resolves to true when the message is updated.
     */
    updateMessage: async (localUuid, changes) => {
      const existing = localMessages.get(localUuid) || {}
      const updated = {
        ...existing,
        ...changes
      }
      localMessages.set(localUuid, updated)
      persistToLocalStorage('messages', localUuid, updated)
      return true
    },

    /**
     * Retrieves the single most recent message in a room.
     *
     * @param {string} roomId - The target room ID.
     * @returns {Promise<Object|null>} Resolves to the latest message, or null if empty.
     */
    getAbsoluteLatestMessage: async (roomId) => {
      const msgs = Array.from(localMessages.values()).filter(m => m.room_id === roomId)
      msgs.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      return msgs[0] || null
    },

    /**
     * Retrieves messages within a room, sorted chronologically (ascending).
     *
     * @param {string} roomId - The room ID.
     * @param {number} [limit] - Maximum number of messages to return.
     * @returns {Promise<Array<Object>>} Resolves to the chronological list of room messages.
     */
    getMessagesByRoom: async (roomId, limit) => {
      let msgs = Array.from(localMessages.values()).filter(m => m.room_id === roomId)
      msgs.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      if (limit) {
        msgs = msgs.slice(-limit)
      }
      return msgs
    },

    /**
     * Retrieves room messages created before a given timestamp or message.
     *
     * @param {string} roomId - The target room ID.
     * @param {string} beforeTime - ISO date string or timestamp.
     * @param {number} [limit=50] - Number of messages to fetch.
     * @returns {Promise<Array<Object>>} Sorted ascendingly by created_at.
     */
    getMessagesByRoomBefore: async (roomId, beforeTime, limit = 50) => {
      let msgs = Array.from(localMessages.values()).filter(m => m.room_id === roomId)
      const targetTime = new Date(beforeTime).getTime()
      msgs = msgs.filter(m => new Date(m.created_at || 0).getTime() < targetTime)
      msgs.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      if (limit) {
        msgs = msgs.slice(-limit)
      }
      return msgs
    },

    /**
     * Retrieves a window of messages centered around a specific target message ID.
     *
     * @param {string} roomId - The target room ID.
     * @param {string} messageId - The target message ID or local_uuid.
     * @param {number} [windowSize=50] - Window size around the target message.
     * @returns {Promise<Array<Object>>} Sorted ascendingly.
     */
    getMessagesByRoomAround: async (roomId, messageId, windowSize = 50) => {
      let msgs = Array.from(localMessages.values()).filter(m => m.room_id === roomId)
      msgs.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      const index = msgs.findIndex(m => m.id === messageId || m.local_uuid === messageId)
      if (index === -1) {
        return msgs.slice(-windowSize)
      }
      const half = Math.floor(windowSize / 2)
      const start = Math.max(0, index - half)
      return msgs.slice(start, start + windowSize)
    },

    /**
     * Retrieves room messages paginated sequentially via cursor-based matching.
     *
     * @param {string} roomId - The room ID.
     * @param {Object} [lastItem] - The last cursor message record from the previous batch.
     * @param {number} batchSize - The size of the batch to retrieve.
     * @returns {Promise<Array<Object>>} Resolves to the next sequential batch of messages.
     */
    getMessagesByRoomCursor: async (roomId, lastItem, batchSize) => {
      let msgs = Array.from(localMessages.values()).filter(m => m.room_id === roomId)
      msgs.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      let startIndex = 0
      if (lastItem) {
        startIndex = msgs.findIndex(a => a.local_uuid === lastItem.local_uuid) + 1
      }
      return msgs.slice(startIndex, startIndex + batchSize)
    },

    /**
     * Retrieves the latest non-utility/non-signaling message in a room.
     * Ignores auxiliary message types like reactions and ice candidates.
     *
     * @param {string} roomId - The room ID.
     * @returns {Promise<Object|null>} Resolves to the latest user message, or null.
     */
    getLatestMessage: async (roomId) => {
      const msgs = Array.from(localMessages.values()).filter(m => m.room_id === roomId && m.type !== 'reaction' && m.type !== 'ice_candidate')
      msgs.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      return msgs[0] || null
    },

    /**
     * Retrieves the absolute latest message across all chats.
     *
     * @returns {Promise<Object|null>} Resolves to the newest message, or null if none.
     */
    getLatestGlobalMessage: async () => {
      const msgs = Array.from(localMessages.values())
      msgs.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      return msgs[msgs.length - 1] || null
    },

    /**
     * Retrieves all messages marked with the "link" type, sorted descending.
     *
     * @returns {Promise<Array<Object>>} Resolves to a list of link messages.
     */
    getLinkMessages: async () => {
      const msgs = Array.from(localMessages.values()).filter(m => m.type === 'link')
      msgs.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      return msgs
    },

    /**
     * Retrieves reactions associated with one or many target message IDs.
     *
     * @param {string|Array<string>} targetIds - The target message identifier(s).
     * @returns {Promise<Array<Object>>} Resolves to the matching reaction messages.
     */
    getMessageReactions: async (targetIds) => {
      const ids = Array.isArray(targetIds) ? targetIds : [targetIds]
      return Array.from(localMessages.values()).filter(m => ids.includes(m.target_id))
    },

    // Asset Domain
    /**
     * Retrieves an asset record by its ID.
     *
     * @param {string} id - The unique asset ID.
     * @returns {Promise<Object|null>} Resolves to the asset, or null if not found.
     */
    getAsset: async (id) => {
      return localAssets.get(id) || null
    },

    /**
     * Saves an asset record locally.
     *
     * @param {Object} asset - The asset record to save.
     * @returns {Promise<boolean>} Resolves to true when saved.
     */
    saveAsset: async (asset) => {
      localAssets.set(asset.id, asset)
      persistToLocalStorage('assets', asset.id, asset)
      return true
    },

    /**
     * Retrieves assets filtered by category (image, video, audio, document) and paginated chronologically.
     *
     * @param {string} category - The asset category ('image', 'video', 'audio', or 'document').
     * @param {Object} [lastItem] - The cursor record of the last item in the previous batch.
     * @param {number} [batchSize] - The maximum batch size to return.
     * @returns {Promise<Array<Object>>} Resolves to the filtered, paginated asset list.
     */
    getAssetsByCategory: async (category, lastItem, batchSize) => {
      let assets = Array.from(localAssets.values())
      if (category === 'image') {
        assets = assets.filter(a => (a.mime_type || '').startsWith('image/'))
      } else if (category === 'video') {
        assets = assets.filter(a => (a.mime_type || '').startsWith('video/'))
      } else if (category === 'audio') {
        assets = assets.filter(a => (a.mime_type || '').startsWith('audio/'))
      } else if (category === 'document') {
        assets = assets.filter(a => {
          const mime = a.mime_type || ''
          return !mime.startsWith('image/') && !mime.startsWith('video/') && !mime.startsWith('audio/')
        })
      }

      assets.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

      let startIndex = 0
      if (lastItem) {
        startIndex = assets.findIndex(a => a.id === lastItem.id) + 1
      }
      if (batchSize) {
        return assets.slice(startIndex, startIndex + batchSize)
      }
      return assets
    }
  }
}
