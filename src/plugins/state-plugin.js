import { definePlugin } from 'coralite'
import { MediaLRUCache } from '../utils/media-lru-cache.js'

/**
 * Ultimate State Plugin for Coralite (Hardened Version)
 * Provides an optimized, granular key-based pub/sub system for global state.
 *
 * @param {Object} options Plugin configuration options.
 * @param {Object} [options.initialState={}] Initial global state.
 */
export default function statePlugin (options = {}) {
  return definePlugin({
    name: 'globalStore',
    client: {
      config: { initialState: options.initialState || {} },
      context: (pluginContext) => {
        const storeState = {
          users: {},
          ...pluginContext.config.initialState,
          decryptionCache: new MediaLRUCache({ maxEntries: 128 })
        }

        const listeners = new Map()

        const notify = (key, value) => {
          const keyListeners = listeners.get(key)
          if (keyListeners) {
            keyListeners.forEach(fn => fn(value, storeState))
          }
        }

        /** @todo use until coralite has testing env */
        /**
         * @typedef {Object} CustomWindow
         * @property {any} [$state]
         */
        /** @type {CustomWindow & typeof globalThis} */
        const win = window
        win.$state = storeState
        win.$stateSet = (key, value) => {
          if (storeState[key] !== value) {
            storeState[key] = value
            notify(key, value)
          }
        }

        return (instanceContext) => {
          const $state = new Proxy(storeState, {
            get (target, key) {
              if (key === 'subscribe') {
                return (prop, fn) => {
                  if (!listeners.has(prop)) {
                    listeners.set(prop, new Set())
                  }
                  listeners.get(prop).add(fn)

                  const unsubscribe = () => {
                    const listener = listeners.get(prop)
                    if (listener) {
                      listener.delete(fn)
                    }
                  }

                  if (instanceContext.signal) {
                    instanceContext.signal.addEventListener('abort', unsubscribe, { once: true })
                  }

                  return unsubscribe
                }
              }
              if (key === 'set') {
                return (prop, value) => {
                  $state[prop] = value
                }
              }
              return target[key]
            },
            set (target, key, value) {
              if (target[key] !== value) {
                target[key] = value
                notify(key, value)

                if (key === 'currentUser' && value && value.id) {
                  target.users = {
                    ...(target.users || {}),
                    [value.id]: {
                      ...(target.users?.[value.id] || {}),
                      ...value
                    }
                  }
                  notify('users', target.users)
                }
              }
              return true
            }
          })

          return { $state }
        }
      }
    }
  })
}
