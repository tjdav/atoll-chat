import { definePlugin } from 'coralite'

/**
 * Platform-agnostic Push Plugin Gateway for Atoll Chat.
 * Exposes a gateway interface that delegates push registrations
 * and permission checks to native or web platform adapters.
 *
 * @param {Object} [options={}] Plugin configuration options.
 * @param {string} [options.vapidKey=''] The VAPID public key for Web Push.
 * @returns {import('coralite').CoralitePlugin} The Coralite push plugin.
 */
export default function pushPlugin (options = {}) {
  const vapidKey = options.vapidKey || ''

  return definePlugin({
    name: 'push',
    client: {
      config: { vapidKey },

      /**
       * Inits the client-side push plugin context.
       *
       * @param {Object} pluginContext The Coralite plugin context.
       * @returns {Promise<function(Object): Object>} Resolve function for local instances.
       */
      context: async (pluginContext) => {
        let resolvedAdapter = null

        /**
         * Resolves and caches the platform-specific push adapter.
         *
         * @param {Object} [instanceContext] The Coralite instance context.
         * @returns {Promise<Object>} The resolved push adapter.
         * @throws {Error} Re-throws unexpected system, database, or network errors.
         */
        const getAdapter = async (instanceContext) => {
          if (resolvedAdapter) {
            return resolvedAdapter
          }

          try {
            const { Capacitor } = await import('@capacitor/core')
            if (Capacitor.isNativePlatform()) {
              const { createNativePushAdapter } = await import('./push-adapter-native.js')
              resolvedAdapter = createNativePushAdapter(instanceContext)
              return resolvedAdapter
            }
          } catch (err) {
            if (err instanceof Error && err.code !== 'ERR_MODULE_NOT_FOUND' && !err.message.includes('Cannot find module') && !err.message.includes('Failed to resolve')) {
              throw err
            }
          }

          const { createWebPushAdapter } = await import('./push-adapter-web.js')
          resolvedAdapter = createWebPushAdapter(instanceContext)
          return resolvedAdapter
        }

        /* Resolve the platform-specific adapter on Phase 1 Setup */
        const initialAdapter = await getAdapter()

        /* Wait for global references if needed */
        pluginContext.$push = () => initialAdapter

        /* Phase 2: Local Instance */
        return (instanceContext) => {
          const api = {
            /**
             * Prompts the user for push notification permission.
             *
             * @returns {Promise<boolean>} Resolves to true if permission was granted.
             */
            async requestPermission () {
              const adapter = await getAdapter(instanceContext)
              return adapter.requestPermission()
            },

            /**
             * Registers the push token or web push subscription object.
             *
             * @returns {Promise<Object|string|null>} Resolves to the registration payload.
             */
            async register () {
              const adapter = await getAdapter(instanceContext)
              const key = pluginContext.config.vapidKey
              return adapter.register(key)
            }
          }

          api.$push = api
          return api
        }
      }
    }
  })
}
