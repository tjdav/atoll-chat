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
          registry,
          get: (id) => registry.get(id),
          list: () => registry.list(),
          byRailOrder: () => registry.byRailOrder(),
          ownerOfRoute: (route) => registry.ownerOfRoute(route),
          size: () => registry.size()
        }
      }
    },

    client: {
      context: async (_pluginContext) => {
        const { ExtensionRegistry: RegistryClass } = await import('./registry.js')
        let exts = (typeof globalThis !== 'undefined' && globalThis.__ATOLL_EXTENSIONS__)
          ? globalThis.__ATOLL_EXTENSIONS__
          : []

        if (!exts || exts.length === 0) {
          try {
            const mod = await import('../../app/src/extensions/index.js')
            exts = mod.extensions || []
          } catch {}
        }

        const reg = new RegistryClass()
        for (const ext of exts) {
          reg.add(ext)
        }
        return (_instanceContext) => {
          return {
            registry: reg,
            get: (id) => reg.get(id),
            list: () => reg.list(),
            byRailOrder: () => reg.byRailOrder(),
            ownerOfRoute: (route) => reg.ownerOfRoute(route),
            size: () => reg.size()
          }
        }
      }
    }
  })
}
