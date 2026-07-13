import { definePlugin } from 'coralite'

/**
 * App Lifecycle Plugin for Coralite.
 * Detects transition between foreground and background.
 */
export default definePlugin({
  name: 'appLifecycle',
  client: {
    context: (pluginContext) => {
      let resolvedAdapter = null

      /**
       * Lazily gets the appropriate platform lifecycle adapter.
       *
       * @param {Object} [instanceContext] The Coralite instance context.
       * @returns {Promise<Object>} The lifecycle adapter.
       */
      const getAdapter = async (instanceContext) => {
        if (resolvedAdapter) {
          return resolvedAdapter
        }

        try {
          const { Capacitor } = await import('@capacitor/core')
          if (Capacitor.isNativePlatform()) {
            console.info('[app-lifecycle-plugin] Native platform detected. Loading Native Lifecycle Adapter.')
            const { createNativeAppLifecycleAdapter } = await import('./app-lifecycle-adapter-native.js')
            resolvedAdapter = createNativeAppLifecycleAdapter(instanceContext)
            return resolvedAdapter
          }
        } catch (_err) {
          /* Fall back gracefully to Web adapter */
        }

        console.info('[app-lifecycle-plugin] Web platform detected. Loading Web Lifecycle Adapter.')
        const { createWebAppLifecycleAdapter } = await import('./app-lifecycle-adapter-web.js')
        resolvedAdapter = createWebAppLifecycleAdapter(instanceContext)
        return resolvedAdapter
      }

      /* Expose getAdapter on the pluginContext for Phase 1 Setup */
      pluginContext.$getLifecycleAdapter = getAdapter

      /* Phase 2: Local Instance */
      return (instanceContext) => {
        const bus = instanceContext.eventBus?.$bus

        return {
          /**
           * Registers the application lifecycle listeners with the event bus.
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
