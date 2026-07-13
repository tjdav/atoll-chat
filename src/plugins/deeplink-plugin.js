import { definePlugin } from 'coralite'

/**
 * Main deep linking plugin for Coralite.
 */
export default definePlugin({
  name: 'deeplink',
  client: {
    context: (pluginContext) => {
      let resolvedAdapter = null

      /**
       * Dynamically gets either the web or native deep link adapter.
       *
       * @param {Object} instanceContext Global context of the instance.
       * @returns {Promise<Object>} Resolved deep link adapter.
       */
      const getAdapter = async (instanceContext) => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            console.info('[deeplink-plugin] Native platform detected. Loading Native Deep Link Adapter.')
            const { createNativeDeepLinkAdapter } = await import('./deeplink-adapter-native.js')
            resolvedAdapter = createNativeDeepLinkAdapter(instanceContext)
            return resolvedAdapter
          }
        } catch (_err) {
          /* Fall back gracefully to Web adapter */
        }

        console.info('[deeplink-plugin] Web platform detected. Loading Web Deep Link Adapter.')
        const { createWebDeepLinkAdapter } = await import('./deeplink-adapter-web.js')
        resolvedAdapter = createWebDeepLinkAdapter(instanceContext)
        return resolvedAdapter
      }

      /* Expose getAdapter on the pluginContext for Phase 1 Setup */
      pluginContext.$getDeepLinkAdapter = getAdapter

      /* Phase 2: Local Instance */
      return (instanceContext) => {
        const bus = instanceContext.eventBus?.$bus

        return {
          /**
           * Initializes deep linking on the active adapter.
           *
           * @returns {Promise<void>} Resolves when initialized.
           */
          async initialize () {
            const adapter = await getAdapter(instanceContext)
            if (adapter && typeof adapter.initialize === 'function') {
              await adapter.initialize(bus)
            }
          }
        }
      }
    }
  }
})
