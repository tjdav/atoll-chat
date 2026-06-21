import { definePlugin } from 'coralite'

/**
 * Event Bus Plugin for Coralite
 * Provides a global singleton EventTarget for component communication.
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
      const $bus = {
        emit: (eventName, payload) => {
          hub.dispatchEvent(new CustomEvent(eventName, { detail: payload }))
        },
        on: (eventName, callback, options = {}) => {
          const handler = (event) => callback(event.detail)
          hub.addEventListener(eventName, handler, options)
          return () => hub.removeEventListener(eventName, handler)
        }
      }

      // Inject into pluginContext for Phase 1 access by downstream plugins
      pluginContext.$bus = $bus

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
