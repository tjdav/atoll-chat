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
        const testingMocks = (typeof window !== 'undefined' && window.__coralite__?.mode === 'testing')
          ? window.__coralite__?.mocks?.config
          : null

        const currentConfig = {
          ...pluginContext.config,
          ...testingMocks
        }

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
