import { definePlugin } from 'coralite'

/**
 * Configuration Plugin for Coralite.
 * Exposes environment and runtime configuration parameters.
 *
 * @param {Object} [config={}] Initial config options.
 */
export default function configPlugin (config = {}) {
  const mergedConfig = {
    maxServerUploadSizeBytes: 26214400,
    webrtcChunkSizeBytes: 16384,
    notificationSoundDebounceMs: 1000,
    ...config
  }

  return definePlugin({
    name: 'config',
    client: {
      config: mergedConfig,
      context: (pluginContext) => {
        const currentConfig = {
          ...pluginContext.config
        }

        pluginContext.$config = currentConfig

        window.$config = currentConfig

        return () => {
          return {
            $config: {
              get: (key) => currentConfig[key]
            }
          }
        }
      }
    }
  })
}
