/**
 * @import PocketBase from 'pocketbase'
 */

import { definePlugin } from 'coralite'
import { createAuthApi } from './auth-api.js'
import { createRecordApi } from './record-api.js'
import { createRealtimeApi } from './realtime-api.js'
import { createFileApi } from './file-api.js'

/**
 * PocketBase Coralite plugin loader with Abstraction API layer.
 *
 * @param {Object} [options={}] Plugin configuration options.
 * @param {string} [options.baseUrl='/'] PocketBase backend API base URL.
 * @returns {Object} Coralite plugin definition.
 */
export default function pocketbase (options = {}) {
  const url = options.baseUrl || '/'

  return definePlugin({
    name: 'pocketbase',
    server: {
      context: async () => {
        const { default: PocketBase } = await import('pocketbase')
        const pb = new PocketBase(url)
        pb.autoCancellation(false)

        const auth = createAuthApi(pb)
        const records = createRecordApi(pb)
        const realtime = createRealtimeApi(pb)
        const files = createFileApi(pb)

        return () => {
          return {
            pb,
            auth,
            records,
            realtime,
            files
          }
        }
      }
    },
    client: {
      config: {
        url
      },
      context: async (pluginContext) => {
        const { default: PocketBase } = await import('pocketbase')
        const pb = new PocketBase(pluginContext.config.url)
        pb.autoCancellation(false)

        const originalBuildURL = pb.buildURL.bind(pb)
        pb.buildURL = (path, params) => {
          return originalBuildURL(path, params)
        }

        const auth = createAuthApi(pb)
        const records = createRecordApi(pb)
        const realtime = createRealtimeApi(pb)
        const files = createFileApi(pb)

        return () => {
          return {
            pb,
            auth,
            records,
            realtime,
            files
          }
        }
      }
    }
  })
}
