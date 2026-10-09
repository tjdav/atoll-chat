/**
 * Global shell state constants and store factory.
 *
 * @module @atoll/app/lib/state
 */

/**
 * Default shell state shape.
 */
export const DEFAULT_SHELL_STATE = Object.freeze({
  currentUser: null,
  isAuthenticated: false,
  oprfToken: null,
  capabilities: null,
  rooms: {},
  roomOrder: [],
  selectedRoomId: null,
  unreadCounts: {},
  activeCall: null,
  callHistory: [],
  readAloudMode: false,
  readAloudState: null,
  settings: {},
  ui: { activeRail: null, modal: null, toasts: [], offline: false },
  pendingScrollToMessage: null,
  storageReady: false,
  storagePersistent: true
})

/**
 * Creates a global state store instance.
 *
 * @param {object} [options] - Factory options.
 * @param {Record<string, any>} [options.initialState] - Initial state overrides.
 * @returns {object} State store instance.
 */
export function createStateStore({ initialState } = {}) {
  const data = { ...DEFAULT_SHELL_STATE, ...(initialState ?? {}) }
  const subscribers = new Map()

  function notify(key, newValue, oldValue) {
    const subs = subscribers.get(key)
    if (subs) {
      for (const cb of Array.from(subs)) {
        try {
          cb(newValue, oldValue)
        } catch (err) {
          queueMicrotask(() => {
            throw err
          })
        }
      }
    }
    const anySubs = subscribers.get('*')
    if (anySubs) {
      for (const cb of Array.from(anySubs)) {
        try {
          cb(null, newValue, oldValue)
        } catch (err) {
          queueMicrotask(() => {
            throw err
          })
        }
      }
    }
  }

  const proxy = new Proxy(data, {
    get(target, prop) {
      if (typeof prop !== 'string') return Reflect.get(target, prop)
      return target[prop]
    },
    set(target, prop, value) {
      if (typeof prop !== 'string') {
        target[prop] = value
        return true
      }
      const oldValue = target[prop]
      target[prop] = value
      notify(prop, value, oldValue)
      return true
    },
    deleteProperty(target, prop) {
      if (typeof prop !== 'string') return Reflect.deleteProperty(target, prop)
      const oldValue = target[prop]
      const had = prop in target
      const result = Reflect.deleteProperty(target, prop)
      if (had) notify(prop, undefined, oldValue)
      return result
    }
  })

  function subscribe(key, cb, opts = {}) {
    if (opts.signal?.aborted) return () => {}
    if (!subscribers.has(key)) subscribers.set(key, new Set())
    const set = subscribers.get(key)
    set.add(cb)
    const unsubscribe = () => {
      const current = subscribers.get(key)
      if (!current) return
      current.delete(cb)
      if (current.size === 0) subscribers.delete(key)
    }
    if (opts.signal) {
      opts.signal.addEventListener('abort', unsubscribe, { once: true })
    }
    return unsubscribe
  }

  function subscribeAny(cb, opts = {}) {
    if (opts.signal?.aborted) return () => {}
    if (!subscribers.has('*')) subscribers.set('*', new Set())
    subscribers.get('*').add(cb)
    const unsubscribe = () => {
      const current = subscribers.get('*')
      if (!current) return
      current.delete(cb)
      if (current.size === 0) subscribers.delete('*')
    }
    if (opts.signal) {
      opts.signal.addEventListener('abort', unsubscribe, { once: true })
    }
    return unsubscribe
  }

  function getSnapshot() {
    return Object.freeze({ ...data })
  }

  function reset(next) {
    const keys = Object.keys(data)
    for (const key of keys) delete data[key]
    const source = next ?? DEFAULT_SHELL_STATE
    for (const key of Object.keys(source)) {
      proxy[key] = source[key]
    }
  }

  return {
    $state: proxy,
    subscribe,
    subscribeAny,
    getSnapshot,
    reset
  }
}
