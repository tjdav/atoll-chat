import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'
import { ExtensionRegistry } from './registry.js'
import { validateExtensionShape } from './validate.js'
import { validateLink } from './validate-link.js'

/**
 * Coralite plugin factory for Atoll extensions.
 * Performs eager Phase 1 shape validation and Phase 2 link validation across extensions.
 *
 * @param {object} [options]
 * @param {Array<object>} [options.extensions] - Array of extension objects.
 * @param {object} [options.services] - Bag of backing service implementations.
 * @returns {object} Coralite plugin.
 */
export default (options = {}) => {
  const extensions = options.extensions ?? []
  const _services = options.services ?? {}

  // Phase 1 and Phase 2 validation runs eagerly on factory call.
  // Build registry once.
  const registry = new ExtensionRegistry()
  for (const ext of extensions) {
    validateExtensionShape(ext)
    registry.add(ext)
  }

  const { warnings } = validateLink(registry)
  if (warnings && warnings.length > 0) {
    for (const w of warnings) {
      console.warn(`[extensions] ${w}`)
    }
  }

  return definePlugin({
    name: 'extensions',
    rootDir: process.cwd(),
    filePath: fileURLToPath(import.meta.url),

    server: {
      context: (_pluginContext) => (_instanceContext) => {
        return {
          extensions: {
            registry,
            get: (id) => registry.get(id),
            list: () => registry.list(),
            byRailOrder: () => registry.byRailOrder(),
            ownerOfRoute: (route) => registry.ownerOfRoute(route),
            size: () => registry.size()
          }
        }
      }
    },

    client: {
      context: (_pluginContext) => (_instanceContext) => {
        return {
          extensions: {
            registry,
            get: (id) => registry.get(id),
            list: () => registry.list(),
            byRailOrder: () => registry.byRailOrder(),
            ownerOfRoute: (route) => registry.ownerOfRoute(route),
            size: () => registry.size()
          }
        }
      }
    }
  })
}
