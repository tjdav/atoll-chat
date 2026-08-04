import { definePlugin } from 'coralite'

/**
 * Configuration Plugin for Coralite.
 * Exposes environment and runtime configuration parameters.
 *
 * @param {Object} [config={}] Initial config options.
 */
export default function configPlugin (config = {}) {
  const mergedConfig = {
    maxServerUploadSizeBytes: (typeof process !== 'undefined' && process.env?.ATOLL_MAX_SERVER_UPLOAD_SIZE_BYTES)
      ? parseInt(process.env.ATOLL_MAX_SERVER_UPLOAD_SIZE_BYTES, 10)
      : 26214400,
    webrtcChunkSizeBytes: 16384,
    notificationSoundDebounceMs: 1000,
    ...config
  }

  return definePlugin({
    name: 'config',
    client: {
      config: mergedConfig,
      context: (pluginContext) => {
        return () => ({
          $config: {
            get: (key) => {
              if (typeof window !== 'undefined' && window.sessionStorage) {
                const stored = window.sessionStorage.getItem(`atoll_config_${key}`)
                if (stored !== null) {
                  return !isNaN(stored) && stored.trim() !== '' ? Number(stored) : stored
                }
              }
              return pluginContext.config[key]
            }
          }
        })
      }
    }
  })
}
