import { definePlugin } from 'coralite'
import PocketBase from 'pocketbase'

/**
 * PocketBase plugin loader.
 * @param {Object} options Plugin configuration options.
 * @param {string} [options.baseUrl='http://127.0.0.1:8090'] The pocketbase API base URL.
 */
export default function pocketbase (options = {}) {
  const url = options.baseUrl || 'http://127.0.0.1:8090'

  return definePlugin({
    name: 'pocketbase',
    server: {
      exports: {
        pb () {
          const pb = new PocketBase(url)
          return () => pb
        }
      }
    },
    client: {
      name: 'pocketbase',
      config: { url },
      context: {
        pb: async (globalContext) => {
          const { default: PocketBase } = await import('pocketbase')
          const pb = new PocketBase(globalContext.config.url)

          return () => pb
        }
      }
    }
  })
}
