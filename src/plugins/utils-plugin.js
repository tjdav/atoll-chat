import { definePlugin } from 'coralite'

/**
 * Utils Plugin for Atoll Chat
 * Provides common utility functions like debouncing.
 */

export default definePlugin({
  name: 'utils',
  client: {
    context: (pluginContext) => {
      /**
       * Creates a debounced function that delays invoking func until after wait milliseconds 
       * have elapsed since the last time the debounced function was invoked.
       */
      const debounce = (func, wait) => {
        let timeoutId
        return (...args) => {
          clearTimeout(timeoutId)
          timeoutId = setTimeout(() => {
            func.apply(this, args)
          }, wait)
        }
      }

      const $utils = {
        debounce
      }

      // Inject into pluginContext for Phase 1 access if needed
      pluginContext.$utils = $utils

      return (instanceContext) => {
        return {
          $utils
        }
      }
    }
  }
})
