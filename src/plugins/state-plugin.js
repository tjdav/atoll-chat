import { definePlugin } from 'coralite'

/**
 * Ultimate State Plugin for Coralite (Hardened Version)
 * Provides an optimized, granular key-based pub/sub system for global state.
 *
 * @param {Object} options
 * @param {Object} [options.initialState={}] Initial global state
 */
export default function statePlugin (options = {}) {
  const initialState = options.initialState || {}

  return definePlugin({
    name: 'global-store',
    client: {
      config: { initialState },
      context: {
        $state: (globalContext) => {
          const storeState = { ...globalContext.config.initialState }
          const listeners = new Map()

          const notify = (key, value) => {
            const keyListeners = listeners.get(key)
            if (keyListeners) {
              keyListeners.forEach(fn => fn(value, storeState))
            }
          }

          return (instanceContext) => {
            return new Proxy(storeState, {
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
                return target[key]
              },
              set (target, key, value) {
                if (target[key] !== value) {
                  target[key] = value
                  notify(key, value)
                }
                return true
              }
            })
          }
        }
      }
    }
  })
}
