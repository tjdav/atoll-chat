import { definePlugin } from 'coralite'

export default definePlugin({
  name: 'state',
  client: {
    setup () {
      const state = {}
      const listeners = new Map()

      const getState = (key) => state[key]

      const setState = (key, value) => {
        // Strict equality check (Remember to pass new references for objects/arrays!)
        if (state[key] !== value) {
          state[key] = value

          if (listeners.has(key)) {
            listeners.get(key).forEach(callback => {
              // Isolate errors so one broken component doesn't halt the state update
              try {
                callback(value)
              } catch (error) {
                console.error(`[Global State] Error in subscriber for "${key}":`, error)
              }
            })
          }
        }
      }

      const subscribe = (key, callback) => {
        if (!listeners.has(key)) {
          listeners.set(key, new Set())
        }
        listeners.get(key).add(callback)

        // Check if the key exists, allowing explicit 'undefined' values to be passed
        if (key in state) {
          try {
            callback(state[key])
          } catch (error) {
            console.error(`[Global State] Error in immediate subscriber for "${key}":`, error)
          }
        }

        // Return cleanup function
        return () => {
          const keyListeners = listeners.get(key)
          if (keyListeners) {
            keyListeners.delete(callback)

            // Clean up the Set if it's empty to prevent memory leaks
            if (keyListeners.size === 0) {
              listeners.delete(key)
            }
          }
        }
      }

      return {
        getState,
        setState,
        subscribe
      }
    },
    helpers: {
      getState: (context) => {
        const getState = context.values.getState

        return () => key => {
          return getState(key)
        }
      },
      setState: (context) => {
        const getState = context.values.setState

        return () => key => {
          return getState(key)
        }
      },
      subscribe: (context) => {
        const subscribe = context.values.subscribe

        return () => key => {
          return subscribe(key)
        }
      }
    }
  }
})
