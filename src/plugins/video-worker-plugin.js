import { definePlugin } from 'coralite'

/**
 * Video Worker Plugin for Atoll Chat
 * Manages video compression off the main thread using WebCodecs via mediabunny.
 */
export default definePlugin({
  name: 'videoWorker',
  client: {
    context: (pluginContext) => {
      const worker = new Worker('/video-worker.js', { type: 'module' })
      const pendingRequests = new Map()

      worker.onmessage = (event) => {
        const { id, type, payload, result, error } = event.data

        if (type === 'video:progress') {
          if (pluginContext.$bus) {
            pluginContext.$bus.emit('video:progress', {
              id,
              progress: payload.progress
            })
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
        console.error('[video-worker-plugin] Worker Error:', error)
        for (const [id, { reject }] of pendingRequests) {
          reject(new Error('Video worker crashed'))
          pendingRequests.delete(id)
        }
      }

      const $video = {
        isSupported: () => {
          return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined'
        },

        compress: (file, options = {}) => {
          return new Promise((resolve, reject) => {
            if (!$video.isSupported()) {
              return reject(new Error('WebCodecs not supported in this browser'))
            }

            const id = crypto.randomUUID()
            pendingRequests.set(id, {
              resolve,
              reject
            })

            worker.postMessage({
              id,
              type: 'video:compress',
              payload: {
                file,
                options
              }
            })
          })
        }
      }

      return (instanceContext) => {
        return {
          $video
        }
      }
    }
  }
})
