import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'

/**
 * Coralite plugin for user-scoped synchronization.
 * Exposes `ctx.sync.runUserScopedSync` directly on the client plugin context.
 *
 * @param {object} [options={}] Plugin options.
 * @returns {object} Coralite plugin definition.
 */
export default function syncPlugin(options = {}) {
  return definePlugin({
    name: 'sync',
    rootDir: process.cwd(),
    filePath: fileURLToPath(import.meta.url),

    server: {
      context: (pluginContext) => async (_instanceContext) => ({
        runUserScopedSync: () => {
          throw new Error('sync.runUserScopedSync is not available during SSR. The sync flow is client-only.')
        }
      })
    },

    client: {
      context: (pluginContext) => async (_instanceContext) => {
        const { runUserScopedSync } = await import('../lib/sync/index.js')

        let inFlight = null

        return {
          runUserScopedSync: async ({ userId, api, storage, onProgress } = {}) => {
            if (inFlight) return inFlight
            inFlight = (async () => {
              try {
                const repos = storage.repos()
                return await runUserScopedSync({
                  api,
                  storage,
                  repos,
                  userId,
                  onProgress
                })
              } finally {
                inFlight = null
              }
            })()
            return inFlight
          }
        }
      }
    }
  })
}
