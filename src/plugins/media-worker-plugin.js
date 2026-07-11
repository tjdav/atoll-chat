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

      if (pluginContext.$bus) {
        pluginContext.$bus.on('db:new_local_data', (payload) => {
          if (!payload || !payload.message) {
            return
          }

          const { message } = payload
          /**
           * @typedef {Object} CustomWindow
           * @property {any} [$state]
           */
          /** @type {CustomWindow & typeof globalThis} */
          const win = window
          const $state = win.$state

          if (message.type === 'media_upgrade_intent') {
            const targetId = message.target_message_id
            if (targetId && $state) {
              $state.videoCompressionLocks = $state.videoCompressionLocks || {}
              $state.videoCompressionLocks[targetId] = Date.now() + (3 * 60 * 1000)
              pluginContext.$bus.emit('media:video_compressing', { target_message_id: targetId })
            }
          } else if (message.type === 'media_upgrade') {
            const targetId = message.target_message_id
            if (targetId && $state) {
              const thumbUrl = message.thumbnail?.dataUrl
              if (thumbUrl) {
                $state.decryptionCache.set(targetId, {
                  blobUrl: null,
                  thumbnailBlobUrl: thumbUrl,
                  mimeType: 'video/mp4'
                })
              }
              if ($state.videoCompressionLocks) {
                delete $state.videoCompressionLocks[targetId]
              }
              pluginContext.$bus.emit('media:video_upgraded', { target_message_id: targetId })
            }
          }
        })
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

        getMetadata: (file) => {
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
                file
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
