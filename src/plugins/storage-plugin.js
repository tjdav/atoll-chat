import { definePlugin } from 'coralite'

/**
 * Storage Plugin Gateway for Atoll Chat.
 * Implements the Two-Phase Resolver to conditionally import, load,
 * and proxy calls to the platform-specific Storage Adapter.
 */
export default definePlugin({
  name: 'storage',
  client: {
    context: async (pluginContext) => {
      /**
       * Traverses an object deeply to identify and gather all transferable objects
       * (e.g. ArrayBuffer, TypedArray buffers) to optimize postMessage operations.
       *
       * @param {*} obj - The target object to scan.
       * @param {Set<*>} [seen=new Set()] - A set used to prevent cyclic references during traversal.
       * @returns {Array<ArrayBuffer>} An array containing unique transferable objects.
       * @throws {TypeError} Re-throws unexpected type errors not related to non-serializable properties.
       */
      function getTransferables (obj, seen = new Set()) {
        if (!obj || typeof obj !== 'object') {
          return []
        }
        if (seen.has(obj)) {
          return []
        }
        seen.add(obj)

        const transferables = []

        if (obj instanceof ArrayBuffer) {
          transferables.push(obj)
        } else if (ArrayBuffer.isView(obj) && obj.buffer instanceof ArrayBuffer) {
          transferables.push(obj.buffer)
        } else {
          try {
            const keys = Object.keys(obj)
            for (let i = 0; i < keys.length; i++) {
              const val = obj[keys[i]]
              if (val && typeof val === 'object') {
                transferables.push(...getTransferables(val, seen))
              }
            }
          } catch (err) {
            /* Re-throw unexpected system or network errors.
               Ignore only expected TypeErrors or SecurityErrors (non-serializable/restricted properties),
               returning whatever transferables we have already gathered up to this point. */
            if (err instanceof TypeError || (err instanceof Error && err.name === 'SecurityError')) {
              return Array.from(new Set(transferables))
            }
            throw err
          }
        }

        return Array.from(new Set(transferables))
      }

      let resolvedAdapter = null

      /**
       * Dynamically loads and instantiates the platform-appropriate storage adapter.
       * Attempts to load the NativeStorageAdapter on native Capacitor platforms,
       * and falls back to WebStorageAdapter if on web or if native loading fails.
       *
       * @returns {Promise<Object>} Resolves to the initialized storage adapter.
       * @throws {Error} Re-throws unexpected load errors not related to missing Capacitor packages.
       */
      const getAdapter = async () => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            const { createNativeStorageAdapter } = await import('./storage-adapter-native.js')
            resolvedAdapter = createNativeStorageAdapter()
            await resolvedAdapter.initialize()
            return resolvedAdapter
          }
        } catch (err) {
          /* Fall back gracefully to WebStorageAdapter if Capacitor packages are not found or loaded.
             Unexpected or critical exceptions (not related to missing module resolution) should be re-thrown. */
          const isExpected = err instanceof Error && (
            err.message?.includes('Cannot find module') ||
            err.message?.includes('import') ||
            err.message?.includes('Capacitor')
          )
          if (!isExpected) {
            throw err
          }
        }

        const { createWebStorageAdapter } = await import('./storage-adapter-web.js')
        resolvedAdapter = createWebStorageAdapter()
        let activeId = null
        if (typeof localStorage !== 'undefined') {
          try {
            activeId = localStorage.getItem('atoll_active_instance_id')
          } catch (err) {
            // Fail safe and default to null if localStorage is inaccessible (e.g. SecurityError in iframe)
            if (err instanceof Error && err.name !== 'SecurityError') {
              throw err
            }
          }
        }
        if (activeId) {
          await resolvedAdapter.initialize('atoll_data_' + activeId)
        }
        return resolvedAdapter
      }

      /* Phase 1 Setup: Wait for the correct adapter and cache it,
         and also register standard global references if needed */
      const initialAdapter = await getAdapter()

      // Inject into pluginContext for Phase 1 access by downstream plugins if any
      pluginContext.$storage = () => initialAdapter

      const registeredWorkers = new Set()

      /**
       * Registers a web or service worker to listen for storage requests
       * and bridges requests back to the platform storage adapter.
       *
       * @param {Object} worker - The worker instance to register.
       */
      pluginContext.registerStorageWorker = (worker) => {
        if (registeredWorkers.has(worker)) {
          return
        }
        registeredWorkers.add(worker)

        worker.addEventListener('message', async (event) => {
          const { type, action, payload: args, requestId } = event.data

          if (type === 'STORAGE_REQUEST' && requestId) {
            try {
              let result
              // Route to the appropriate adapter API action
              if (typeof initialAdapter[action] === 'function') {
                result = await initialAdapter[action](...(args || []))
              } else {
                throw new Error(`Unsupported storage action: ${action}`)
              }

              // Send back successful response
              const successMsg = {
                type: 'STORAGE_RESPONSE',
                requestId,
                result
              }
              worker.postMessage(successMsg, getTransferables(successMsg))

              // Emit appropriate tracking events via global event bus ($bus) if database mutation was successful
              if (pluginContext.$bus) {
                if (action === 'saveRoom' || action === 'updateRoom') {
                  const room = args?.[0]
                  const roomId = room?.id
                  if (roomId) {
                    pluginContext.$bus.emit('db:new_local_room', { room_id: roomId })
                  }
                } else if (action === 'deleteRoomData') {
                  const roomId = args?.[0]
                  if (roomId) {
                    pluginContext.$bus.emit('db:room_deleted', { room_id: roomId })
                  }
                } else if (action === 'saveMessage' || action === 'saveAsset') {
                  const dataObj = args?.[0]
                  const roomId = dataObj?.room_id
                  if (roomId) {
                    pluginContext.$bus.emit('db:new_local_data', {
                      room_id: roomId,
                      message: dataObj
                    })
                  }
                } else if (action === 'updateMessage') {
                  const localUuid = args?.[0]
                  const changes = args?.[1]
                  const roomId = args?.[2]
                  if (roomId) {
                    pluginContext.$bus.emit('db:new_local_data', {
                      room_id: roomId,
                      message: {
                        local_uuid: localUuid,
                        ...changes
                      }
                    })
                  }
                } else if (action === 'updateRoomMemberState') {
                  const roomId = args?.[0]
                  if (roomId) {
                    pluginContext.$bus.emit('db:new_local_data', { room_id: roomId })
                    pluginContext.$bus.emit('room:member_updated', { room_id: roomId })
                  }
                } else if (action === 'updateRoomsWithParticipant') {
                  const updatedRoomIds = result
                  if (Array.isArray(updatedRoomIds)) {
                    for (const rid of updatedRoomIds) {
                      pluginContext.$bus.emit('db:new_local_data', { room_id: rid })
                      pluginContext.$bus.emit('room:member_updated', { room_id: rid })
                    }
                  }
                } else if (action === 'saveRecord' || action === 'saveRecordsBulk' || action === 'deleteRecord') {
                  // For low-level fallback writes
                  const storeName = args?.[0]
                  const record = args?.[1]
                  if (record) {
                    const roomId = record.room_id || record.id
                    if (storeName === 'local_rooms' && roomId) {
                      if (action === 'deleteRecord') {
                        pluginContext.$bus.emit('db:room_deleted', { room_id: record })
                      } else {
                        pluginContext.$bus.emit('db:new_local_room', { room_id: roomId })
                      }
                    } else if ((storeName === 'local_messages' || storeName === 'local_assets') && roomId) {
                      pluginContext.$bus.emit('db:new_local_data', {
                        room_id: roomId,
                        message: record
                      })
                    }
                  }
                }
              }
            } catch (err) {
              const errMsg = {
                type: 'STORAGE_RESPONSE',
                requestId,
                error: err instanceof Error ? err.message : String(err)
              }
              worker.postMessage(errMsg, getTransferables(errMsg))
            }
          }
        })
      }

      // Handle Service Worker PUSH_RECEIVED messages
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', async (event) => {
          if (event.data && event.data.type === 'PUSH_RECEIVED') {
            const cryptoWorkerPlugin = pluginContext.$cryptoWorker ? pluginContext.$cryptoWorker() : null
            if (cryptoWorkerPlugin && cryptoWorkerPlugin.$worker) {
              try {
                // Forward the push record to the worker decryption pipeline
                await cryptoWorkerPlugin.$worker.execute('worker:process_incoming_message', event.data.payload)
              } catch (err) {
                // Re-throw unexpected errors to avoid swallowing, or propagate via Event Bus
                if (pluginContext.$bus) {
                  pluginContext.$bus.emit('push:decryption_error', {
                    error: err instanceof Error ? err.message : String(err)
                  })
                } else {
                  throw err
                }
              }
            }
          }
        })
      }

      // Phase 2: Return proxy methods for main thread UI components
      return () => {
        const api = {
          initialize: (customDbName) => initialAdapter.initialize(customDbName),
          saveRecord: (storeName, data) => initialAdapter.saveRecord(storeName, data),
          saveRecordsBulk: (storeName, records) => initialAdapter.saveRecordsBulk(storeName, records),
          deleteRecord: (storeName, key) => initialAdapter.deleteRecord(storeName, key),
          saveFile: (fileName, blob) => initialAdapter.saveFile(fileName, blob),
          getFile: (fileName) => initialAdapter.getFile(fileName),
          deleteFile: (fileName) => (typeof initialAdapter.deleteFile === 'function' ? initialAdapter.deleteFile(fileName) : initialAdapter.deleteRecord('local_files', fileName)),

          // Config Domain
          getConfig: (key) => initialAdapter.getConfig(key),
          getConfigRecord: (key) => initialAdapter.getConfigRecord(key),
          saveConfig: (key, value) => initialAdapter.saveConfig(key, value),
          saveConfigs: (configs) => initialAdapter.saveConfigs(configs),
          deleteConfig: (key) => initialAdapter.deleteConfig(key),

          // Room Domain
          getRoom: (id) => initialAdapter.getRoom(id),
          saveRoom: (room) => initialAdapter.saveRoom(room),
          updateRoom: (id, changes) => initialAdapter.updateRoom(id, changes),
          deleteRoomData: (roomId) => initialAdapter.deleteRoomData(roomId),
          updateRoomMemberState: (roomId, userId, memberState) => initialAdapter.updateRoomMemberState(roomId, userId, memberState),
          updateRoomsWithParticipant: (userId, participantData) => initialAdapter.updateRoomsWithParticipant(userId, participantData),
          getAllRoomsSorted: (lastTimestamp, batchSize) => initialAdapter.getAllRoomsSorted(lastTimestamp, batchSize),
          getLatestGlobalRoom: () => initialAdapter.getLatestGlobalRoom(),

          // Message Domain
          getMessage: (localUuid) => initialAdapter.getMessage(localUuid),
          saveMessage: (message) => initialAdapter.saveMessage(message),
          updateMessage: (localUuid, changes) => initialAdapter.updateMessage(localUuid, changes),
          getAbsoluteLatestMessage: (roomId) => initialAdapter.getAbsoluteLatestMessage(roomId),
          getMessagesByRoom: (roomId, limit) => initialAdapter.getMessagesByRoom(roomId, limit),
          getMessagesByRoomCursor: (roomId, lastItem, batchSize) => initialAdapter.getMessagesByRoomCursor(roomId, lastItem, batchSize),
          getMessagesByRoomBefore: (roomId, beforeTime, limit) => initialAdapter.getMessagesByRoomBefore(roomId, beforeTime, limit),
          getMessagesByRoomAround: (roomId, messageId, windowSize) => initialAdapter.getMessagesByRoomAround(roomId, messageId, windowSize),
          getLatestMessage: (roomId) => initialAdapter.getLatestMessage(roomId),
          getLatestGlobalMessage: () => initialAdapter.getLatestGlobalMessage(),
          getLinkMessages: () => initialAdapter.getLinkMessages(),
          getMessageReactions: (targetIds) => initialAdapter.getMessageReactions(targetIds),

          // Asset Domain
          getAsset: (id) => initialAdapter.getAsset(id),
          saveAsset: (asset) => initialAdapter.saveAsset(asset),
          getAssetsByCategory: (category, lastItem, batchSize) => initialAdapter.getAssetsByCategory(category, lastItem, batchSize),

          // Cache & History Domain
          getStorageUsage: () => initialAdapter.getStorageUsage(),
          clearLocalMediaCache: async () => {
            const res = await initialAdapter.clearLocalMediaCache()

            pluginContext.$bus.emit('db:history_cleared')

            return res
          },
          clearLocalVoiceCache: async () => {
            const res = await initialAdapter.clearLocalVoiceCache()

            pluginContext.$bus.emit('db:history_cleared')

            return res
          },
          clearLocalMessagesCache: async () => {
            const res = await initialAdapter.clearLocalMessagesCache()

            pluginContext.$bus.emit('db:history_cleared')

            return res
          },
          clearLocalHistory: async () => {
            const res = await initialAdapter.clearLocalHistory()

            pluginContext.$bus.emit('db:history_cleared')

            return res
          },
          purgeAllData: () => initialAdapter.purgeAllData()
        }

        api.$storage = api
        return api
      }
    }
  }
})
