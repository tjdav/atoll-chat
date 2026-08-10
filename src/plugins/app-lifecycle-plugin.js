import { definePlugin } from 'coralite'

/**
 * App Lifecycle Plugin for Coralite.
 * Detects transition of the application between foreground and background.
 *
 */
export default definePlugin({
  name: 'appLifecycle',
  client: {
    /**
     * Set up the client-side lifecycle plugin context.
     *
     * @param {Object} pluginContext The Coralite plugin registration context.
     * @param {Function} pluginContext.$getLifecycleAdapter Lazy getter for the platform lifecycle adapter.
     * @returns {function(Object): Object} A function that resolves the local instance context.
     */
    context: (pluginContext) => {
      let resolvedAdapter = null

      /**
       * Lazily gets the appropriate platform lifecycle adapter.
       *
       * @param {Object} [instanceContext] The Coralite instance context.
       * @returns {Promise<Object>} The lifecycle adapter.
       * @throws {Error} Re-throws unexpected errors that are not related to missing module resolution.
       */
      const getAdapter = async (instanceContext) => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            const { createNativeAppLifecycleAdapter } = await import('./app-lifecycle-adapter-native.js')
            resolvedAdapter = createNativeAppLifecycleAdapter(instanceContext)
            return resolvedAdapter
          }
        } catch (err) {
          if (err instanceof Error && err.code !== 'ERR_MODULE_NOT_FOUND' && !err.message.includes('Cannot find module') && !err.message.includes('Failed to resolve')) {
            throw err
          }
        }

        const { createWebAppLifecycleAdapter } = await import('./app-lifecycle-adapter-web.js')
        resolvedAdapter = createWebAppLifecycleAdapter(instanceContext)
        return resolvedAdapter
      }

      /* Expose getAdapter on the pluginContext for Phase 1 Setup */
      pluginContext.$getLifecycleAdapter = getAdapter

      /* Phase 2: Local Instance */
      return (instanceContext) => {
        const bus = instanceContext.eventBus.$bus

        return {
          /**
           * Registers the application lifecycle listeners with the event bus.
           *
           * @returns {Promise<void>} Resolves when listeners have been registered.
           */
          async registerListeners () {
            const adapter = await getAdapter(instanceContext)
            await adapter.registerListeners(bus)
          }
        }
      }
    }
  }
})
