import { definePlugin } from 'coralite'

/**
 * PocketBase plugin loader.
 * @param {Object} options Plugin configuration options.
 * @param {string} [options.baseUrl='/'] The pocketbase API base URL.
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

        return () => {
          return { pb }
        }
      }
    },
    client: {
      config: { url },
      context: async (pluginContext) => {
        const { default: PocketBase } = await import('pocketbase')
        const pb = new PocketBase(pluginContext.config.url)
        pb.autoCancellation(false)

        return () => {
          return { pb }
        }
      }
    }
  })
}
