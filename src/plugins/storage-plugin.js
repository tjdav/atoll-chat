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

      // Phase 1 Setup: Wait for the correct adapter and cache it,
      // and also register standard global references if needed
      const initialAdapter = await getAdapter()

      // Inject into pluginContext for Phase 1 access by downstream plugins if any
      pluginContext.$storage = () => initialAdapter

      // Phase 2: Return proxy methods for main thread UI components
      return () => {
        const api = {
          initialize: () => initialAdapter.initialize(),
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
          getAllRoomsSorted: (lastTimestamp, batchSize) => initialAdapter.getAllRoomsSorted(lastTimestamp, batchSize),
          getLatestGlobalRoom: () => initialAdapter.getLatestGlobalRoom(),

          // Message Domain
          getMessage: (localUuid) => initialAdapter.getMessage(localUuid),
          saveMessage: (message) => initialAdapter.saveMessage(message),
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
