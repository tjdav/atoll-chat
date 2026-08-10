import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { definePlugin } from 'coralite'

/**
 * Media Worker Plugin for Atoll Chat
 * Manages media compression and metadata extraction off the main thread using WebCodecs via mediabunny.
 */
export default definePlugin({
  name: 'mediaWorker',
  server: {
    onAfterBuild: async ({ app }) => {
      const projectRoot = process.cwd()
      const outputDir = app.options.output

      if (!outputDir) {
        return
      }

      try {
        const srcPath = join(projectRoot, 'src', 'assets', 'media-worker.js')
        const content = await readFile(srcPath, 'utf-8')
        await app.writeFile('media-worker.js', content)
      } catch (err) {
        throw err
      }
    }
  },
  client: {
    context: (pluginContext) => {
      const worker = new Worker('/media-worker.js', { type: 'module' })
      const pendingRequests = new Map()

      worker.onmessage = (event) => {
        const { id, type, result, error, payload } = event.data

        if (type === 'video:progress' || type === 'audio:progress') {
          if (pluginContext.$bus) {
            pluginContext.$bus.emit(type === 'video:progress' ? 'media:video_progress' : 'media:audio_progress', {
              id,
              progress: payload.progress,
              status: payload.status
            })
          }
          const pending = pendingRequests.get(id)
          if (pending && pending.onProgress) {
            pending.onProgress(payload.progress, payload.status)
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
        },

        convertAudio: (file, options = {}) => {
          return new Promise((resolve, reject) => {
            const { onProgress, ...workerOptions } = options
            const id = crypto.randomUUID()
            pendingRequests.set(id, {
              resolve,
              reject,
              onProgress
            })

            worker.postMessage({
              id,
              type: 'audio:convert',
              payload: {
                file,
                options: workerOptions
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
