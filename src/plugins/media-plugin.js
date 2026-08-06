import { definePlugin } from 'coralite'

export default definePlugin({
  name: 'media',
  client: {
    context: (_pluginContext) => {
      let resolvedAdapter = null

      const getAdapter = async (instanceContext) => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            console.info('[media-plugin] Native platform detected. Loading NativeMediaAdapter.')
            const { createNativeMediaAdapter } = await import('./media-adapter-native.js')
            resolvedAdapter = createNativeMediaAdapter(instanceContext)
            return resolvedAdapter
          }
        } catch (err) {
          console.warn('[media-plugin] Failed to load @capacitor/core or check platform, defaulting to web adapter:', err)
        }

        console.info('[media-plugin] Web platform detected. Loading WebMediaAdapter.')
        const { createWebMediaAdapter } = await import('./media-adapter-web.js')
        resolvedAdapter = createWebMediaAdapter(instanceContext)
        return resolvedAdapter
      }

      return (instanceContext) => {
        return {
          $media: {
            compressImage: async (source, options) => {
              const adapter = await getAdapter(instanceContext)
              return adapter.compressImage(source, options)
            },
            compressGif: async (file, options) => {
              const adapter = await getAdapter(instanceContext)
              return adapter.compressGif ? adapter.compressGif(file, options) : file
            },
            compressVideo: async (file, options) => {
              const adapter = await getAdapter(instanceContext)
              return adapter.compressVideo(file, options)
            },
            evaluateVideo: async (file, options) => {
              const adapter = await getAdapter(instanceContext)
              return adapter.evaluateVideo(file, options)
            },
            convertAudio: async (file, options) => {
              const adapter = await getAdapter(instanceContext)
              return adapter.convertAudio(file, options)
            },
            checkCompatibility: async (file) => {
              const adapter = await getAdapter(instanceContext)
              return adapter.checkCompatibility ? adapter.checkCompatibility(file) : {
                requiresConversion: false,
                category: 'none'
              }
            },
            extractThumbnail: async (file) => {
              const adapter = await getAdapter(instanceContext)
              return adapter.extractThumbnail(file)
            }
          }
        }
      }
    }
  }
})
