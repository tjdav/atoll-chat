import { definePlugin } from 'coralite'

/**
 * Fuse Plugin for Atoll Chat
 * Exposes Fuse.js for local searching.
 */
export default definePlugin({
  name: 'fuse',
  client: {
    context: async (pluginContext) => {
      const FuseModule = await import('fuse.js')
      const Fuse = FuseModule.default || FuseModule

      pluginContext.$Fuse = Fuse

      return () => {
        return {
          $Fuse: Fuse
        }
      }
    }
  }
})
