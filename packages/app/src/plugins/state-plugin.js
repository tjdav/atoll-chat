import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'

/**
 * Global state store plugin factory for Coralite.
 *
 * @param {object} [options] - Plugin options.
 * @param {Record<string, any>} [options.initialState] - Initial state overrides.
 * @returns {import('coralite').Plugin} Plugin instance.
 */
export default (options = {}) => {
  return definePlugin({
    name: 'globalStore',
    rootDir: process.cwd(),
    filePath: fileURLToPath(import.meta.url),

    server: {
      context: (pluginContext) => (_instanceContext) => {
        const noop = () => {}
        return {
          $state: {},
          subscribe: () => noop,
          subscribeAny: () => noop,
          getSnapshot: () => ({}),
          reset: noop
        }
      }
    },

    client: {
      config: {
        initialState: options.initialState ?? {}
      },
      context: async (pluginContext) => {
        const initialState = pluginContext.config?.initialState ?? {}
        const { createStateStore } = await import('../lib/state/index.js')
        const store = createStateStore({ initialState })
        return (_instanceContext) => ({
          $state: store.$state,
          subscribe: (key, cb, opts) => store.subscribe(key, cb, opts),
          subscribeAny: (cb, opts) => store.subscribeAny(cb, opts),
          getSnapshot: () => store.getSnapshot(),
          reset: (next) => store.reset(next)
        })
      }
    }
  })
}
