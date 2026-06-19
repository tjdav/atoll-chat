import { definePlugin } from 'coralite'

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
      context: (pluginContext) => async (instanceContext) => {
        const { default: PocketBase } = await import('pocketbase')
        const pb = new PocketBase(url)
        return {
          pb
        }
      }
    },
    client: {
      name: 'pocketbase',
      config: { url },
      context: async (pluginContext) => {
        const { default: PocketBase } = await import('pocketbase')
        const pbInstance = new PocketBase(pluginContext.config.url)

        return () => {
          return {
            pb: pbInstance
          }
        }
      }
    }
  })
}
