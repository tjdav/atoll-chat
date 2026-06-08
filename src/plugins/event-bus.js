import { definePlugin } from 'coralite'

/**
 * Event Bus Plugin for Coralite
 * Provides a global singleton EventTarget for component communication.
 * Auto-binds the component's AbortSignal for native listener cleanup.
 */

export default definePlugin({
  name: 'event-bus',
  client: {
    name: 'eventBus',
    context: {
      /**
         * $bus context provider
         */
      $bus: () => {
        const hub = new EventTarget()

        return (instanceContext) => {
          return {
            /**
             * Emit a native CustomEvent
             * @param {string} eventName The name of the event
             * @param {any} payload The event payload data
             */
            emit: (eventName, payload) => {
              hub.dispatchEvent(new CustomEvent(eventName, { detail: payload }))
            },

            /**
             * Listen for an event with auto-binding to the component's signal
             * @param {string} eventName The name of the event
             * @param {Function} callback The callback function to invoke
             */
            on: (eventName, callback) => {
              const handler = (event) => callback(event.detail)

              hub.addEventListener(eventName, handler, {
                signal: instanceContext.signal
              })
            }
          }
        }
      }
    }
  }
})
