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
      let resolvedAdapter = null

      const getAdapter = async () => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            console.info('[storage-plugin] Native platform detected. Loading NativeStorageAdapter.')
            const { createNativeStorageAdapter } = await import('./storage-adapter-native.js')
            resolvedAdapter = createNativeStorageAdapter()
            await resolvedAdapter.initialize()
            return resolvedAdapter
          }
        } catch (_err) {
          // Fall back gracefully to WebStorageAdapter
        }

        console.info('[storage-plugin] Web platform detected. Loading WebStorageAdapter.')
        const { createWebStorageAdapter } = await import('./storage-adapter-web.js')
        resolvedAdapter = createWebStorageAdapter()
        await resolvedAdapter.initialize()
        return resolvedAdapter
      }

      /* Phase 1 Setup: Wait for the correct adapter and cache it,
         and also register standard global references if needed */
      const initialAdapter = await getAdapter()

      // Inject into pluginContext for Phase 1 access by downstream plugins if any
      pluginContext.$storage = () => initialAdapter

      const registeredWorkers = new Set()

      // Register incoming message bridge handler for a worker
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
              worker.postMessage({
                type: 'STORAGE_RESPONSE',
                requestId,
                result
              })

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
              console.error(`[storage-plugin] Worker storage request failed: ${action}`, err)
              worker.postMessage({
                type: 'STORAGE_RESPONSE',
                requestId,
                error: err.message
              })
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
                console.error('[storage-plugin] Failed to decrypt SW forwarded push event:', err)
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
          getLatestMessage: (roomId) => initialAdapter.getLatestMessage(roomId),
          getLatestGlobalMessage: () => initialAdapter.getLatestGlobalMessage(),
          getLinkMessages: () => initialAdapter.getLinkMessages(),
          getMessageReactions: (targetIds) => initialAdapter.getMessageReactions(targetIds),

          // Asset Domain
          getAsset: (id) => initialAdapter.getAsset(id),
          saveAsset: (asset) => initialAdapter.saveAsset(asset),
          getAssetsByCategory: (category, lastItem, batchSize) => initialAdapter.getAssetsByCategory(category, lastItem, batchSize)
        }

        api.$storage = api
        return api
      }
    }
  }
})
