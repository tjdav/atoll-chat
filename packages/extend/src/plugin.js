import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'
import { ExtensionRegistry } from './registry.js'

/**
 * Coralite plugin factory for Atoll extensions.
 *
 * @param {object} [options]
 * @param {Array<object>} [options.extensions] - Array of normalized extension objects.
 * @param {object} [options.services] - Bag of backing service implementations (stored for future plugins).
 * @returns {object} Coralite plugin.
 */
export default (options = {}) => {
  const extensions = options.extensions ?? []
  const _services = options.services ?? {}

  return definePlugin({
    name: 'extensions',
    rootDir: process.cwd(),
    filePath: fileURLToPath(import.meta.url),

    server: {
      context: (pluginContext) => (_instanceContext) => {
        const registry = pluginContext.__ext_registry_server__ ??
          (pluginContext.__ext_registry_server__ = buildRegistry(extensions))
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
      context: (pluginContext) => (_instanceContext) => {
        const registry = pluginContext.__ext_registry_client__ ??
          (pluginContext.__ext_registry_client__ = buildRegistry(extensions))
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

/**
 * Constructs and populates an ExtensionRegistry instance.
 *
 * @param {Array<object>} extensions
 * @returns {ExtensionRegistry}
 */
function buildRegistry(extensions) {
  const registry = new ExtensionRegistry()
  for (const ext of extensions) {
    registry.add(ext)
  }
  return registry
}
