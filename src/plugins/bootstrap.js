import { definePlugin } from 'coralite'

/**
 * Bootstrap Plugin for Coralite
 * Provides access to Bootstrap's JavaScript components (like Modal).
 */

export default definePlugin({
  name: 'bootstrap',
  client: {
    name: 'bootstrap',
    context: async () => {
      const { Modal } = await import('bootstrap')

      return () => {
        return {
          Modal
        }
      }
    }
  }
})
