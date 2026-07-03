import { definePlugin } from 'coralite'

/**
 * Event Bus Plugin for Coralite
 * Provides a global singleton EventTarget for communication.
 * Auto-binds the component's AbortSignal for native listener cleanup.
 */

export default definePlugin({
  name: 'eventBus',
  client: {
    context: (pluginContext) => {
      const hub = new EventTarget()

      /**
       * Internal bus implementation.
       */
      const transformEventName = (name) => {
        if (typeof name !== 'string') {
          return name
        }
        let transformed = name.toLowerCase().replace(/-/g, '_')
        if (!transformed.includes(':')) {
          transformed = `app:${transformed}`
        }
        return transformed
      }

      /**
       * Internal bus implementation.
       */
      const $bus = {
        emit: (eventName, payload) => {
          const transformedName = transformEventName(eventName)
          hub.dispatchEvent(new CustomEvent(transformedName, { detail: payload }))
        },
        on: (eventName, callback, options = {}) => {
          const transformedName = transformEventName(eventName)
          const handler = (event) => callback(event.detail)
          hub.addEventListener(transformedName, handler, options)
          return () => hub.removeEventListener(transformedName, handler)
        }
      }

      // Inject into pluginContext for Phase 1 access by downstream plugins
      pluginContext.$bus = $bus

      // Expose to window for E2E testing and global access
      window.$bus = $bus

      return (instanceContext) => {
        return {
          $bus: {
            emit: $bus.emit,
            on: (eventName, callback) => {
              return $bus.on(eventName, callback, {
                signal: instanceContext.signal
              })
            }
          }
        }
      }
    }
  }
})
