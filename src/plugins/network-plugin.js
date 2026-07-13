import { definePlugin } from 'coralite'

/**
 * Network Resiliency and State Monitoring Plugin for Coralite.
 */
export default definePlugin({
  name: 'network',
  client: {
    context: (pluginContext) => {
      let resolvedAdapter = null

      /**
       * Lazily gets the appropriate platform network adapter.
       *
       * @param {Object} [instanceContext] The Coralite instance context.
       * @returns {Promise<Object>} The network adapter.
       */
      const getAdapter = async (instanceContext) => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            console.info('[network-plugin] Native platform detected. Loading Native Network Adapter.')
            const { createNativeNetworkAdapter } = await import('./network-adapter-native.js')
            resolvedAdapter = createNativeNetworkAdapter(instanceContext)
            return resolvedAdapter
          }
        } catch (_err) {
          /* Fall back gracefully to Web adapter */
        }

        console.info('[network-plugin] Web platform detected. Loading Web Network Adapter.')
        const { createWebNetworkAdapter } = await import('./network-adapter-web.js')
        resolvedAdapter = createWebNetworkAdapter(instanceContext)
        return resolvedAdapter
      }

      /* Expose getAdapter on the pluginContext for Phase 1 Setup */
      pluginContext.$getNetworkAdapter = getAdapter

      /* Phase 2: Local Instance */
      return (instanceContext) => {
        const bus = instanceContext.eventBus?.$bus

        return {
          /**
           * Registers the network listeners with the event bus.
           *
           * @returns {Promise<void>} Resolves when listeners have been registered.
           */
          async registerListeners () {
            const adapter = await getAdapter(instanceContext)
            if (adapter && typeof adapter.registerListeners === 'function') {
              await adapter.registerListeners(bus)
            }
          }
        }
      }
    }
  }
})
