import { definePlugin } from 'coralite'

/**
 * Platform-agnostic Push Plugin Gateway for Atoll Chat.
 *
 * @param {Object} options Plugin configuration options.
 * @param {string} [options.vapidKey=''] The VAPID public key for Web Push.
 */
export default function pushPlugin (options = {}) {
  const vapidKey = options.vapidKey || ''

  return definePlugin({
    name: 'push',
    client: {
      config: { vapidKey },
      context: async (pluginContext) => {
        let resolvedAdapter = null

        const getAdapter = async (instanceContext) => {
          if (resolvedAdapter) {
            return resolvedAdapter
          }

          try {
            const { Capacitor } = await import('@capacitor/core')
            if (Capacitor.isNativePlatform()) {
              console.info('[push-plugin] Native platform detected. Loading NativePushAdapter.')
              const { createNativePushAdapter } = await import('./push-adapter-native.js')
              resolvedAdapter = createNativePushAdapter(instanceContext)
              return resolvedAdapter
            }
          } catch (_err) {
            /* Fall back gracefully to WebPushAdapter */
          }

          console.info('[push-plugin] Web platform detected. Loading WebPushAdapter.')
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
             * @returns {Promise<boolean>} True if permission is granted.
             */
            async requestPermission () {
              const adapter = await getAdapter(instanceContext)
              return adapter.requestPermission()
            },

            /**
             * Registers the push token or web push subscription object.
             *
             * @returns {Promise<Object|string|null>} The registration payload.
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
