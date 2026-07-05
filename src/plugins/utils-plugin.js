import { definePlugin } from 'coralite'

/**
 * Utils Plugin for Atoll Chat
 * Provides common utility functions like debouncing and image compression.
 */

export default definePlugin({
  name: 'utils',
  client: {
    context: (pluginContext) => {
      /**
       * Compresses an image.
       * @param {File|Blob|string|HTMLImageElement|HTMLCanvasElement} source - The image source.
       * @param {Object} options - Compression options.
       * @param {number} [options.maxWidth=1200] - Maximum width.
       * @param {number} [options.maxHeight=1200] - Maximum height.
       * @param {number} [options.quality=0.8] - Compression quality (0 to 1).
       * @param {string} [options.format='image/webp'] - Output format.
       * @param {boolean} [options.cropToSquare=false] - Whether to crop to a square.
       * @returns {Promise<Blob>} - Resolves to the compressed image Blob.
       */
      const compressImage = async (source, options = {}) => {
        const {
          maxWidth = 1200,
          maxHeight = 1200,
          quality = 0.8,
          format = 'image/webp',
          cropToSquare = false
        } = options

        let img
        let shouldRevoke = false

        if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
          img = source
        } else {
          img = new Image()
          const promise = new Promise((resolve, reject) => {
            img.onload = () => resolve(img)
            img.onerror = () => reject(new Error('Failed to load image source'))
          })

          if (source instanceof Blob) {
            const url = URL.createObjectURL(source)
            img.src = url
            shouldRevoke = true
          } else {
            img.src = source
          }

          await promise
        }

        try {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')

          let targetWidth = img.width
          let targetHeight = img.height

          if (cropToSquare) {
            const size = Math.min(targetWidth, targetHeight)

            // Calculate scaled size if it exceeds constraints
            let finalSize = size
            if (finalSize > maxWidth || finalSize > maxHeight) {
              finalSize = Math.min(maxWidth, maxHeight)
            }

            canvas.width = finalSize
            canvas.height = finalSize

            const sourceX = (img.width - size) / 2
            const sourceY = (img.height - size) / 2

            ctx.drawImage(img, sourceX, sourceY, size, size, 0, 0, finalSize, finalSize)
          } else {
            if (targetWidth > maxWidth || targetHeight > maxHeight) {
              const ratio = Math.min(maxWidth / targetWidth, maxHeight / targetHeight)
              targetWidth *= ratio
              targetHeight *= ratio
            }

            canvas.width = targetWidth
            canvas.height = targetHeight
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
          }

          return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) {
                resolve(blob)
              } else {
                reject(new Error('Canvas toBlob failed'))
              }
            }, format, quality)
          })
        } finally {
          if (shouldRevoke && img.src) {
            URL.revokeObjectURL(img.src)
          }
        }
      }

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
        formatRelativeTime,
        compressImage
      }

      // Inject into pluginContext for Phase 1 access if needed
      pluginContext.$utils = $utils

      return (instanceContext) => {
        const { pocketbase, cryptoWorker, globalStore } = instanceContext

        /**
         * Fetches an encrypted asset from PocketBase, decrypts it using the crypto worker,
         * and returns an Object URL. Manages the global decryption cache.
         * @param {Object} asset - The asset metadata (must include media_id, file_key, file_nonce, mime_type).
         * @param {AbortSignal} [signal] - Optional AbortSignal.
         * @returns {Promise<string>} - Resolves to the decrypted Object URL.
         */
        const fetchAndDecrypt = async (asset, signal) => {
          const { pb } = pocketbase
          const { $worker } = cryptoWorker
          const { $state } = globalStore

          // Check cache first
          if (asset.message_id && $state.decryptionCache.has(asset.message_id)) {
            const cached = $state.decryptionCache.get(asset.message_id)
            return typeof cached === 'string' ? cached : cached.blobUrl
          }

          if (asset.id && $state.decryptionCache.has(asset.id)) {
            const cached = $state.decryptionCache.get(asset.id)
            return typeof cached === 'string' ? cached : cached.blobUrl
          }

          const mediaRecord = await pb.collection('media').getOne(asset.media_id)
          const url = pb.files.getURL(mediaRecord, mediaRecord.file)

          const response = await fetch(url, { signal })
          if (!response.ok) {
            throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`)
          }
          const encryptedBuffer = await response.arrayBuffer()

          if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError')
          }

          const decryptedBuffer = await $worker.execute('worker:decrypt_file', {
            encryptedBuffer,
            nonce: asset.file_nonce,
            key: asset.file_key
          })

          if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError')
          }

          const mediaBlob = new Blob([decryptedBuffer], { type: asset.mime_type })
          const objectUrl = URL.createObjectURL(mediaBlob)

          // Cache it
          const cacheKey = asset.message_id || asset.id
          if (cacheKey) {
            $state.decryptionCache.set(cacheKey, {
              blobUrl: objectUrl,
              mimeType: asset.mime_type
            })
          }

          return objectUrl
        }

        return {
          $utils: {
            ...$utils,
            fetchAndDecrypt
          }
        }
      }
    }
  }
})
