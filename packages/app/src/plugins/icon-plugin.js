import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'
import { getIconModule, isIconName, listIcons } from '../lib/icons/index.js'

/**
 * Coralite Icon Plugin.
 * Exposes canonical icon resolution tools via `ctx.icons`.
 *
 * @param {object} [options={}] - Plugin options.
 * @returns {import('coralite').Plugin} Coralite plugin object.
 */
export default function iconPlugin(options = {}) {
  return definePlugin({
    name: 'icons',
    rootDir: process.cwd(),
    filePath: fileURLToPath(import.meta.url),

    server: {
      context: (_pluginContext) => (_instanceContext) => ({
        icons: {
          get: (name) => getIconModule(name),
          list: () => listIcons(),
          has: (name) => isIconName(name)
        }
      })
    },

    client: {
      context: (_pluginContext) => (_instanceContext) => ({
        icons: {
          get: (name) => getIconModule(name),
          list: () => listIcons(),
          has: (name) => isIconName(name)
        }
      })
    }
  })
}
