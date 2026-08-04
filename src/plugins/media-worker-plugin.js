import { definePlugin } from 'coralite'

/**
 * Media Worker Plugin for Atoll Chat
 * Manages media compression and metadata extraction off the main thread using WebCodecs via mediabunny.
 */
export default definePlugin({
  name: 'mediaWorker',
  client: {
    context: (pluginContext) => {
      const worker = new Worker('/media-worker.js', { type: 'module' })
      const pendingRequests = new Map()

      worker.onmessage = (event) => {
        const { id, type, result, error, payload } = event.data

        if (type === 'video:progress') {
          if (pluginContext.$bus) {
            pluginContext.$bus.emit('media:video_progress', {
              id,
              progress: payload.progress
            })
          }
          const pending = pendingRequests.get(id)
          if (pending && pending.onProgress) {
            pending.onProgress(payload.progress)
          }
          return
        }

        if (id && pendingRequests.has(id)) {
          const { resolve, reject } = pendingRequests.get(id)
          pendingRequests.delete(id)

          if (error) {
            reject(new Error(error))
          } else {
            resolve(result)
          }
        }
      }

      worker.onerror = (error) => {
        console.error('[media-worker-plugin] Worker Error:', error)
        for (const [id, { reject }] of pendingRequests) {
          reject(new Error('Media worker crashed'))
          pendingRequests.delete(id)
        }
      }

      const $media = {
        isSupported: () => {
          return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined'
        },

        compress: (file, options = {}) => {
          return new Promise((resolve, reject) => {
            if (!$media.isSupported()) {
              return reject(new Error('WebCodecs not supported in this browser'))
            }

            const { onProgress, ...workerOptions } = options
            const id = crypto.randomUUID()
            pendingRequests.set(id, {
              resolve,
              reject,
              onProgress
            })

            worker.postMessage({
              id,
              type: 'video:compress',
              payload: {
                file,
                options: workerOptions
              }
            })
          })
        },

        getMetadata: (file, options = {}) => {
          return new Promise((resolve, reject) => {
            const id = crypto.randomUUID()
            pendingRequests.set(id, {
              resolve,
              reject
            })

            worker.postMessage({
              id,
              type: 'media:get-metadata',
              payload: {
                file,
                options
              }
            })
          })
        },

        evaluateVideo: (file, options = {}) => {
          return new Promise((resolve, reject) => {
            const id = crypto.randomUUID()
            pendingRequests.set(id, {
              resolve,
              reject
            })

            worker.postMessage({
              id,
              type: 'video:evaluate',
              payload: {
                file,
                maxServerUploadSizeBytes: options.maxServerUploadSizeBytes,
                duration: options.duration
              }
            })
          })
        }
      }

      return (_instanceContext) => {
        return {
          $mediaWorker: $media
        }
      }
    }
  }
})
