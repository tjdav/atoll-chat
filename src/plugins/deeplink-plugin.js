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
       * Dynamically resolves either the web or native deep link adapter.
       *
       * @param {Object} instanceContext - Global context of the instance.
       * @returns {Promise<Object>} Resolved deep link adapter.
       */
      const getAdapter = async (instanceContext) => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            const { createNativeDeepLinkAdapter } = await import('./deeplink-adapter-native.js')
            resolvedAdapter = createNativeDeepLinkAdapter(instanceContext)
            return resolvedAdapter
          }
        } catch (err) {
          if (err && err.code !== 'MODULE_NOT_FOUND' && !err.message?.includes('Cannot find module')) {
            throw err
          }
        }

        const { createWebDeepLinkAdapter } = await import('./deeplink-adapter-web.js')
        resolvedAdapter = createWebDeepLinkAdapter(instanceContext)
        return resolvedAdapter
      }

      /* Expose getAdapter on the pluginContext for Phase 1 Setup */
      pluginContext.$getDeepLinkAdapter = getAdapter

      /* Phase 2: Local Instance */
      return (instanceContext) => {
        const bus = instanceContext.eventBus.$bus

        return {
          /**
           * Initializes deep linking on the active adapter.
           *
           * @returns {Promise<void>} Resolves when deep linking is initialized.
           */
          async initialize () {
            const adapter = await getAdapter(instanceContext)
            await adapter.initialize(bus)
          }
        }
      }
    }
  }
})
