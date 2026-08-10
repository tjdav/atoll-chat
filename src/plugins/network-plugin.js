import { definePlugin } from 'coralite'

/**
 * Network Resiliency and State Monitoring Plugin for Coralite.
 */
export default definePlugin({
  name: 'network',
  client: {
    /**
     * Resolves the plugin context during the initial setup phase.
     *
     * @param {Object} pluginContext The plugin-level context object.
     * @returns {Function} A second-phase function that resolves instance-level context.
     */
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

        const { Capacitor } = await import('@capacitor/core').catch(() => ({}))
        if (Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()) {
          const { createNativeNetworkAdapter } = await import('./network-adapter-native.js')
          resolvedAdapter = createNativeNetworkAdapter(instanceContext)
          return resolvedAdapter
        }

        const { createWebNetworkAdapter } = await import('./network-adapter-web.js')
        resolvedAdapter = createWebNetworkAdapter(instanceContext)
        return resolvedAdapter
      }

      /* Expose getAdapter on the pluginContext for Phase 1 Setup */
      pluginContext.$getNetworkAdapter = getAdapter

      /**
       * Two-phase instance resolver for the network plugin.
       *
       * @param {Object} instanceContext The Coralite instance context.
       * @returns {Object} An object exposing network plugin API for the instance.
       */
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
