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
        $store: (globalContext) => {
          const storeState = { ...globalContext.config.initialState }

          /** @type {Map<string, Set<Function>>} */
          const listeners = new Map()

          const storeInterface = {
            /**
             * Returns a specific global state value or the entire store.
             * @param {string} [key]
             * @returns {any}
             */
            get: (key) => (key ? storeState[key] : storeState),

            /**
             * Updates the global state with a shallow merge and notifies targeted listeners.
             * Only fires if values actually change (diff check).
             * @param {Object} patch
             */
            set: (patch) => {
              for (const key in patch) {
                const newValue = patch[key]

                // Diff check: only update and fire if value actually changed
                if (storeState[key] !== newValue) {
                  storeState[key] = newValue

                  // Fire ONLY the listeners subscribed to this specific key
                  const keyListeners = listeners.get(key)
                  if (keyListeners) {
                    keyListeners.forEach(fn => fn(newValue, storeState))
                  }
                }
              }
            },

            /**
             * Subscribes to changes of a specific key.
             * @param {string} key Key to listen to
             * @param {Function} fn Callback function receiving (newValue, storeState)
             * @param {Object} [options={}]
             * @param {AbortSignal} [options.signal] Optional signal for auto-cleanup
             * @returns {Function} Unsubscribe function
             */
            subscribe: (key, fn, options = {}) => {
              if (!listeners.has(key)) {
                listeners.set(key, new Set())
              }
              const keyListeners = listeners.get(key)
              keyListeners.add(fn)

              const unsubscribe = () => {
                const currentKeyListeners = listeners.get(key)
                if (currentKeyListeners) {
                  currentKeyListeners.delete(fn)
                  if (currentKeyListeners.size === 0) {
                    listeners.delete(key)
                  }
                }
              }

              if (options.signal) {
                if (options.signal.aborted) {
                  unsubscribe()
                } else {
                  options.signal.addEventListener('abort', unsubscribe, { once: true })
                }
              }

              return unsubscribe
            }
          }

          return (instanceContext) => storeInterface
        }
      }
    }
  })
}
