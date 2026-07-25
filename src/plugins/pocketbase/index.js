/**
 * @import PocketBase from 'pocketbase'
 */

import { definePlugin } from 'coralite'
import { createAuthApi } from './auth-api.js'
import { createRecordApi } from './record-api.js'
import { createRealtimeApi } from './realtime-api.js'
import { createFileApi } from './file-api.js'
import { WorkspaceAuthStore } from './workspace-store.js'

/**
 * PocketBase Coralite plugin loader with Abstraction API layer.
 *
 * @param {Object} [options={}] Plugin configuration options.
 * @param {string} [options.baseUrl='/'] PocketBase backend API base URL.
 * @param {boolean} [options.enableWorkspaces=false] Multi-tenant workspace feature flag.
 * @returns {Object} Coralite plugin definition.
 */
export default function pocketbase (options = {}) {
  const url = options.baseUrl || '/'
  const enableWorkspaces = options.enableWorkspaces || false

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
        url,
        enableWorkspaces
      },
      context: async (pluginContext) => {
        const isWorkspacesEnabled = Boolean(pluginContext.config.enableWorkspaces)

        let pb
        let customStore = null

        if (isWorkspacesEnabled) {
          customStore = new WorkspaceAuthStore()
          const active = customStore.workspaces.find(w => w.id === customStore.activeWorkspaceId)
          const activeUrl = active ? active.url : ''
          pb = new PocketBase(activeUrl, customStore)
        } else {
          pb = new PocketBase(pluginContext.config.url)
        }

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
            files,
            workspaces: customStore
          }
        }
      }
    }
  })
}
