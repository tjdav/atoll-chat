import fs from 'fs'
import path from 'path'

const coraliteElementPath = path.resolve('node_modules/coralite/dist/lib/coralite-element.js')

// In-memory registry of already loaded/defined custom elements
const registeredComponents = new Set()

/**
 * Programmatically loads and registers a compiled Coralite component into happy-dom's global customElements registry.
 *
 * @param {string} componentName - The tag name of the component (e.g., 'atoll-badge').
 * @param {Object} [mocks] - Optional mocks for global context plugins (e.g., globalStore, pocketbase, storage).
 * @returns {Promise<string>} Resolves to the registered custom element tag name.
 */
export async function loadComponent (componentName, mocks = {}) {
  const tagName = componentName.toLowerCase()

  if (customElements.get(tagName)) {
    return tagName
  }

  // Resolve and load CoraliteElement and createCoraliteClass
  const { createCoraliteClass } = await import('file://' + coraliteElementPath)

  // Find and load the compiled component definition file from dist/assets/js/
  const dir = 'dist/assets/js/'
  if (!fs.existsSync(dir)) {
    throw new Error(`Compiled assets directory "${dir}" does not exist. Please run "pnpm run build" first to compile components.`)
  }

  const files = fs.readdirSync(dir)
  const matched = files.find(f => f.startsWith(`${tagName}-`) && f.endsWith('.js'))
  if (!matched) {
    throw new Error(`Could not find compiled file for component "${tagName}". Try running "pnpm run build" first.`)
  }

  const specModule = await import('file://' + path.resolve(dir, matched))
  const spec = specModule.default

  // Recursively load and register dependencies
  if (spec.dependencies && Array.isArray(spec.dependencies)) {
    for (const dep of spec.dependencies) {
      try {
        await loadComponent(dep, mocks)
      } catch (err) {
        // Ignore third-party non-Coralite custom elements (e.g. altcha-widget)
      }
    }
  }

  // Create and define client context getter to expose global plugins/stores (like $state, pocketbase)
  const defaultMocks = {
    utils: {
      $url: {
        normalizeUrl: (url) => url
      },
      $time: {
        formatRelative: () => ''
      },
      $func: {
        debounce: (fn) => fn,
        throttle: (fn) => fn
      }
    },
    markdown: {
      renderMarkdown: async (content) => `<p>${content || ''}</p>`
    },
    eventBus: {
      $bus: {
        emit: () => {
        },
        on: () => {
        },
        off: () => {
        }
      }
    },
    router: {
      $url: {
        normalizeUrl: (url) => url
      }
    },
    deeplink: {
      $url: {
        normalizeUrl: (url) => url
      }
    },
    deeplinkManifest: {
      $url: {
        normalizeUrl: (url) => url
      }
    },
    sync: {
      $sync: {
        startSubscriptions: async () => {
        },
        stopSubscriptions: async () => {
        }
      }
    },
    realtimeSync: {
      $sync: {
        startSubscriptions: async () => {
        },
        stopSubscriptions: async () => {
        }
      }
    },
    cryptoWorker: {
      $worker: {
        execute: async () => {
        }
      }
    },
    globalStore: {
      $state: {
        isAuthenticated: false,
        isVaultUnlocked: false,
        currentUser: null,
        users: {},
        subscribe: (_key, _cb) => {
          return () => {
          }
        }
      }
    },
    pocketbase: {
      pb: {
        baseUrl: '/',
        buildURL: (path) => path
      },
      files: {
        getUrl: () => '',
        getURL: () => ''
      }
    },
    storage: {
      $storage: {
        getAllRoomsSorted: async () => []
      }
    },
    ...mocks
  }

  // Important: We must merge with the original localContext (refs, observe, state, etc.)
  const clientContextGetter = (localContext) => {
    return {
      ...localContext,
      ...defaultMocks
    }
  }

  // Instantiate and define the Custom Element Class
  const elementClass = createCoraliteClass(spec, clientContextGetter)
  customElements.define(tagName, elementClass)
  registeredComponents.add(tagName)

  return tagName
}
export { registeredComponents }
