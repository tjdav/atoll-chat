/**
 * Global shell state constants and store factory.
 *
 * @module @atoll/app/lib/state
 */

/**
 * Default shell state shape.
 */
export const DEFAULT_SHELL_STATE = Object.freeze({
  isAuthenticated: false,
  currentUser: null,
  oprfToken: null,
  locale: 'en',
  storageReady: false,
  storagePersistent: true
})

/**
 * Creates a global state store instance.
 *
 * @param {Record<string, any>} [initialState] - Initial state overrides.
 * @returns {object} State store instance.
 */
export function createStateStore(initialState = {}) {
  const state = {
    ...DEFAULT_SHELL_STATE,
    ...initialState
  }
  const listeners = new Map()

  return {
    $state: state,

    /**
     * Subscribes a callback to state changes for a given key.
     *
     * @param {string} key - State property key.
     * @param {Function} cb - Callback function.
     * @returns {Function} Unsubscribe function.
     */
    subscribe(key, cb) {
      if (!listeners.has(key)) {
        listeners.set(key, new Set())
      }
      listeners.get(key).add(cb)
      return () => listeners.get(key)?.delete(cb)
    }
  }
}
