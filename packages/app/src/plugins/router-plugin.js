import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'
import { createRouter } from '../lib/router/index.js'

/**
 * Coralite plugin factory for the Atoll router.
 * Provides in-page query parameter navigation and subscriber capabilities.
 *
 * @param {object} [options] - Plugin configuration options.
 * @returns {object} Coralite plugin definition.
 */
export default (options = {}) => {
  return definePlugin({
    name: 'router',
    rootDir: process.cwd(),
    filePath: fileURLToPath(import.meta.url),

    server: {
      context: (_pluginContext) => (_instanceContext) => ({
        getActiveRail: () => null,
        getActiveDetail: () => null,
        getSelection: () => null,
        getParams: () => ({}),
        navigate: () => {},
        back: () => {},
        subscribe: () => () => {}
      })
    },

    client: {
      context: async (pluginContext) => {
        const { createRouter: makeRouter } = await import('../lib/router/index.js')
        const router = pluginContext.__router_client__ ??
          (pluginContext.__router_client__ = makeRouter({ win: window }))
        return (_instanceContext) => ({
          getActiveRail: () => router.getActiveRail(),
          getActiveDetail: () => router.getActiveDetail(),
          getSelection: () => router.getSelection(),
          getParams: () => router.getParams(),
          navigate: (params, options) => router.navigate(params, options),
          back: () => router.back(),
          subscribe: (cb) => router.subscribe(cb)
        })
      }
    }
  })
}
