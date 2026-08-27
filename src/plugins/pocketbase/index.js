/**
 * @import PocketBase from 'pocketbase'
 */

import { definePlugin } from 'coralite'

/**
 * PocketBase Coralite plugin loader with Abstraction API layer.
 *
 * @param {Object} [options={}] Plugin configuration options.
 * @param {string} [options.baseUrl='/'] PocketBase backend API base URL.
 * @param {string} [options.appUrl=''] Native app URL override.
 * @returns {Object} Coralite plugin definition.
 */
export default function pocketbase (options = {}) {
  const url = options.baseUrl || '/'

  return definePlugin({
    name: 'pocketbase',
    server: {
      context: async () => {
        const { default: PocketBase } = await import('pocketbase')
        const { createAuthApi } = await import('./auth-api.js')
        const { createRecordApi } = await import('./record-api.js')
        const { createRealtimeApi } = await import('./realtime-api.js')
        const { createFileApi } = await import('./file-api.js')

        const pb = new PocketBase(url)
        pb.autoCancellation(false)

        const auth = createAuthApi(pb)
        const records = createRecordApi(pb)
        const realtime = createRealtimeApi(pb)
        const files = createFileApi(pb)

        return () => ({
          pb,
          auth,
          records,
          realtime,
          files
        })
      }
    },
    client: {
      config: {
        url,
        appUrl: options.appUrl || ''
      },
      context: async (pluginContext) => {
        const { default: PocketBase } = await import('pocketbase')
        const { createAuthApi } = await import('./auth-api.js')
        const { createRecordApi } = await import('./record-api.js')
        const { createRealtimeApi } = await import('./realtime-api.js')
        const { createFileApi } = await import('./file-api.js')

        let targetUrl = pluginContext.config.url || '/'
        const isNative = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()

        if (isNative) {
          const appUrl = pluginContext.config.appUrl
          if (appUrl) {
            targetUrl = appUrl
          } else if (targetUrl === '/' || targetUrl.startsWith('http:') || targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1')) {
            targetUrl = targetUrl.replace(/^http:\/\//, 'https://').replace(/:8090$/, ':3443')
          }
        }

        const pb = new PocketBase(targetUrl)
        pb.autoCancellation(false)

        const auth = createAuthApi(pb)
        const records = createRecordApi(pb)
        const realtime = createRealtimeApi(pb)
        const files = createFileApi(pb)

        const contextObj = {
          pb,
          auth,
          records,
          realtime,
          files
        }

        const proxyContext = new Proxy(contextObj, {
          get (target, prop) {
            if (prop in target) {
              return target[prop]
            }
            const val = pb[prop]
            if (typeof val === 'function') {
              return val.bind(pb)
            }
            return val
          }
        })

        return () => proxyContext
      }
    }
  })
}
