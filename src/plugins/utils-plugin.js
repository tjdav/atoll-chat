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

      /**
       * Formats a timestamp into a relative time string.
       * Rules:
       * < 1 hour: 39m
       * < 24 hours: 10h
       * < 7 days: 1d, 5d
       * > 7 days: 5w or 1y
       */
      const formatRelativeTime = (timestamp) => {
        if (!timestamp) {
          return ''
        }
        const date = new Date(timestamp)
        const now = new Date()
        const diffInSeconds = Math.floor((now - date) / 1000)

        if (diffInSeconds < 60) {
          return 'now'
        }

        const diffInMinutes = Math.floor(diffInSeconds / 60)
        if (diffInMinutes < 60) {
          return `${diffInMinutes}m`
        }

        const diffInHours = Math.floor(diffInMinutes / 60)
        if (diffInHours < 24) {
          return `${diffInHours}h`
        }

        const diffInDays = Math.floor(diffInHours / 24)
        if (diffInDays < 7) {
          return `${diffInDays}d`
        }

        const diffInWeeks = Math.floor(diffInDays / 7)
        if (diffInWeeks < 52) {
          return `${diffInWeeks}w`
        }

        const diffInYears = Math.floor(diffInDays / 365)
        return `${diffInYears}y`
      }

      const $utils = {
        debounce,
        formatRelativeTime
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
