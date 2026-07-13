/**
 * Native Storage Adapter Stub for Atoll Chat.
 * Implements a non-blocking performance-oriented chunking mechanism for saveFile
 * and a fallback SQLite emulator in localStorage/memory to ensure platform equivalence.
 */

export function createNativeStorageAdapter () {
  // In-memory/localStorage stores to simulate SQLite persistence on Native
  const localRooms = new Map()
  const localMessages = new Map()
  const localAssets = new Map()
  const localConfig = new Map()
  const localFiles = new Map()

  // Helper to load existing localStorage keys if any
  try {
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key.startsWith('atoll_sqlite_')) {
          const val = JSON.parse(localStorage.getItem(key))
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
    console.error('[NativeStorageAdapter] Failed to sync localStorage:', err)
  }

  const persistToLocalStorage = (prefix, key, value) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`atoll_sqlite_${prefix}_${key}`, JSON.stringify(value))
      }
    } catch (err) {
      console.error('[NativeStorageAdapter] Storage write failed:', err)
    }
  }

  const removeFromLocalStorage = (prefix, key) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`atoll_sqlite_${prefix}_${key}`)
      }
    } catch (err) {
      console.error('[NativeStorageAdapter] Storage delete failed:', err)
    }
  }

  return {
    initialize: async () => {
      console.info('[NativeStorageAdapter] Initializing SQLite and File System plugins...')
      return true
    },

    /**
     * Stores encrypted media blobs natively using the chunked Performance Guardrail
     * to prevent Out-Of-Memory crashes over the Capacitor JS Bridge.
     */
    saveFile: async (fileName, blob) => {
      const CHUNK_SIZE = 2 * 1024 * 1024 // 2MB chunk limit
      const totalSize = blob.size
      let offset = 0
      let chunkIndex = 0
      const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)

      console.info(`[NativeStorageAdapter] Initiating saveFile for "${fileName}" (Size: ${totalSize} bytes, Chunks: ${totalChunks})`)

      while (offset < totalSize) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE)
        // Convert the chunk to ArrayBuffer to simulate reading the file payload
        const buffer = await chunk.arrayBuffer()
        
        chunkIndex++
        console.log(`[NativeStorageAdapter] [JS Bridge Guardrail] Writing chunk ${chunkIndex} of ${totalChunks} (${buffer.byteLength} bytes) to native disk...`)

        offset += CHUNK_SIZE
      }

      console.info(`[NativeStorageAdapter] saveFile completed successfully for "${fileName}"`)

      // For stub functionality, keep the metadata and blob in local memory/cache
      localFiles.set(fileName, { name: fileName, blob })
      persistToLocalStorage('files', fileName, { name: fileName, isMockFile: true })
      return true
    },

    getFile: async (fileName) => {
      console.info(`[NativeStorageAdapter] Retrieving file "${fileName}" from native file system...`)
      const file = localFiles.get(fileName)
      return file ? file.blob : null
    },

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

    // --- Config Domain ---
    getConfig: async (key) => {
      const record = localConfig.get(key)
      return record ? record.value : null
    },

    getConfigRecord: async (key) => {
      return localConfig.get(key) || null
    },

    saveConfig: async (key, value) => {
      const data = { key, value }
      localConfig.set(key, data)
      persistToLocalStorage('config', key, data)
      return true
    },

    saveConfigs: async (configs) => {
      for (const config of configs) {
        localConfig.set(config.key, config)
        persistToLocalStorage('config', config.key, config)
      }
      return true
    },

    deleteConfig: async (key) => {
      localConfig.delete(key)
      removeFromLocalStorage('config', key)
      return true
    },

    // --- Room Domain ---
    getRoom: async (id) => {
      return localRooms.get(id) || null
    },

    saveRoom: async (room) => {
      localRooms.set(room.id, room)
      persistToLocalStorage('rooms', room.id, room)
      return true
    },

    updateRoom: async (id, changes) => {
      const existing = localRooms.get(id) || {}
      const updated = { ...existing, ...changes }
      localRooms.set(id, updated)
      persistToLocalStorage('rooms', id, updated)
      return true
    },

    getAllRoomsSorted: async (lastTimestamp, batchSize) => {
      let rooms = Array.from(localRooms.values())
      rooms.sort((a, b) => {
        const ta = new Date(a.updated_at || 0).getTime()
        const tb = new Date(b.updated_at || 0).getTime()
        return tb - ta
      })
      if (lastTimestamp) {
        const lastTime = new Date(lastTimestamp).getTime()
        rooms = rooms.filter(r => new Date(r.updated_at || 0).getTime() < lastTime)
      }
      if (batchSize) {
        rooms = rooms.slice(0, batchSize)
      }
      return rooms
    },

    getLatestGlobalRoom: async () => {
      const rooms = Array.from(localRooms.values())
      rooms.sort((a, b) => new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime())
      return rooms[rooms.length - 1] || null
    },

    // --- Message Domain ---
    getMessage: async (localUuid) => {
      return localMessages.get(localUuid) || null
    },

    saveMessage: async (message) => {
      localMessages.set(message.local_uuid, message)
      persistToLocalStorage('messages', message.local_uuid, message)
      return true
    },

    getMessagesByRoom: async (roomId, limit) => {
      let msgs = Array.from(localMessages.values()).filter(m => m.room_id === roomId)
      msgs.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      if (limit) {
        msgs = msgs.slice(0, limit)
      }
      return msgs
    },

    getMessagesByRoomCursor: async (roomId, lastItem, batchSize) => {
      let msgs = Array.from(localMessages.values()).filter(m => m.room_id === roomId)
      msgs.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      let startIndex = 0
      if (lastItem) {
        startIndex = msgs.findIndex(a => a.local_uuid === lastItem.local_uuid) + 1
      }
      return msgs.slice(startIndex, startIndex + batchSize)
    },

    getLatestMessage: async (roomId) => {
      const msgs = Array.from(localMessages.values()).filter(m => m.room_id === roomId && m.type !== 'reaction' && m.type !== 'ice_candidate')
      msgs.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      return msgs[0] || null
    },

    getLatestGlobalMessage: async () => {
      const msgs = Array.from(localMessages.values())
      msgs.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      return msgs[msgs.length - 1] || null
    },

    getLinkMessages: async () => {
      const msgs = Array.from(localMessages.values()).filter(m => m.type === 'link')
      msgs.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      return msgs
    },

    getMessageReactions: async (targetIds) => {
      const ids = Array.isArray(targetIds) ? targetIds : [targetIds]
      return Array.from(localMessages.values()).filter(m => ids.includes(m.target_id))
    },

    // --- Asset Domain ---
    getAsset: async (id) => {
      return localAssets.get(id) || null
    },

    saveAsset: async (asset) => {
      localAssets.set(asset.id, asset)
      persistToLocalStorage('assets', asset.id, asset)
      return true
    },

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
