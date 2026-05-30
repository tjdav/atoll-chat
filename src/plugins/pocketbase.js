import { definePlugin } from 'coralite'
import PocketBase from 'pocketbase'

/**
 *
 * @param {Object} options
 * @param {string} [options.baseUrl='http://127.0.0.1:8090']
 */
export default function pocketbase (options = {}) {
  const url = options.baseUrl || 'http://127.0.0.1:8090'

  return definePlugin({
    name: 'pocketbase',
    server: {
      exports: {
        pb: () => () => new PocketBase(url)
      }
    },
    client: {
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
