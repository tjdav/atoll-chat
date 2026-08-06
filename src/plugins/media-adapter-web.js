import { checkMediaCompatibility } from '../utils/media-compatibility.js'

/**
 * Web Media Adapter Factory
 * Orchestrates WebCodecs video compression, metadata extraction (via Web Worker), and canvas image compression on the main thread.
 * @param {Object} instanceContext - The instance context containing other plugins.
 * @returns {Object} The Web Media Adapter.
 */
export function createWebMediaAdapter (instanceContext) {
  /**
   * Compresses an image on the main thread using canvas.
   * @param {File|Blob|string|HTMLImageElement|HTMLCanvasElement|Object} source - The source image representation.
   * @param {Object} options - Compression options.
   * @returns {Promise<Blob>} The compressed image blob.
   */
  async function compressImage (source, options = {}) {
    const {
      maxWidth = 1200,
      maxHeight = 1200,
      quality = 0.8,
      format = 'image/webp',
      cropToSquare = false
    } = options

    let img
    let shouldRevoke = false

    if (
      source instanceof HTMLImageElement ||
      source instanceof HTMLCanvasElement ||
      (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) ||
      (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas)
    ) {
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
        const ratio = Math.min(maxWidth / targetWidth, maxHeight / targetHeight, 1.0)
        targetWidth *= ratio
        targetHeight *= ratio
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
      if (shouldRevoke && img instanceof HTMLImageElement && img.src) {
        URL.revokeObjectURL(img.src)
      }
    }
  }

  return {
    checkCompatibility: (file) => checkMediaCompatibility(file),
    compressImage,

    /**
     * Compresses or converts an animated GIF file via mediaWorker if available, or returns original file.
     * @param {File} file - Original animated GIF file.
     * @param {Object} options - Compression options.
     * @returns {Promise<File>} Resolves to compressed File or original GIF File.
     */
    compressGif: async (file, options = {}) => {
      const mediaWorkerPlugin = instanceContext.mediaWorker
      if (mediaWorkerPlugin && mediaWorkerPlugin.$mediaWorker && mediaWorkerPlugin.$mediaWorker.isSupported()) {
        try {
          const { buffer, mimeType, extension } = await mediaWorkerPlugin.$mediaWorker.compress(file, {
            maxWidth: 1200,
            maxHeight: 1200,
            ...options
          })
          const compressedBlob = new Blob([buffer], { type: mimeType })
          const lastDot = file.name.lastIndexOf('.')
          const baseName = lastDot !== -1 ? file.name.substring(0, lastDot) : file.name
          const newName = baseName + extension
          return new File([compressedBlob], newName, { type: mimeType })
        } catch {
          return file
        }
      }
      return file
    },

    /**
     * Compresses a video file using the media-worker-plugin (mediaWorker plugin context).
     * @param {File} file - The original video file.
     * @param {Object} options - Compression options.
     * @returns {Promise<File>} Resolves to a new File with the compressed video.
     */
    compressVideo: async (file, options = {}) => {
      const mediaWorkerPlugin = instanceContext.mediaWorker
      if (!mediaWorkerPlugin) {
        throw new Error('mediaWorker plugin not registered')
      }

      const $mediaWorker = mediaWorkerPlugin.$mediaWorker
      if (!$mediaWorker.isSupported()) {
        throw new Error('WebCodecs not supported in this browser')
      }

      const { buffer, mimeType, extension } = await $mediaWorker.compress(file, {
        maxWidth: 1280,
        maxHeight: 720,
        ...options
      })

      const compressedBlob = new Blob([buffer], { type: mimeType })
      let newName = file.name
      const lastDot = file.name.lastIndexOf('.')
      if (lastDot !== -1) {
        newName = file.name.substring(0, lastDot) + extension
      } else {
        newName = file.name + extension
      }

      return new File([compressedBlob], newName, { type: mimeType })
    },

    /**
     * Evaluates video file size against server upload threshold and computes estimated compressed size.
     * @param {File} file - Original video file.
     * @param {Object} options - Evaluation options (maxServerUploadSizeBytes, duration).
     * @returns {Promise<{ shouldCompress: boolean, estimatedSizeBytes: number, targetBitrate: number, useWebRTC: boolean }>} Evaluation result.
     */
    evaluateVideo: async (file, options = {}) => {
      const mediaWorkerPlugin = instanceContext.mediaWorker
      if (!mediaWorkerPlugin) {
        return {
          shouldCompress: false,
          estimatedSizeBytes: file.size,
          targetBitrate: 0,
          useWebRTC: file.size > (options.maxServerUploadSizeBytes || 26214400)
        }
      }

      const $mediaWorker = mediaWorkerPlugin.$mediaWorker
      return $mediaWorker.evaluateVideo(file, options)
    },

    /**
     * Converts raw or uncompressed audio files (WAV, FLAC) to universal MP4/AAC audio format.
     * @param {File} file - Original audio file.
     * @param {Object} options - Conversion options.
     * @returns {Promise<File>} Converted web audio File.
     */
    convertAudio: async (file, options = {}) => {
      const mediaWorkerPlugin = instanceContext.mediaWorker
      if (!mediaWorkerPlugin) {
        throw new Error('mediaWorker plugin not registered')
      }

      const $mediaWorker = mediaWorkerPlugin.$mediaWorker
      const { buffer, mimeType, extension } = await $mediaWorker.convertAudio(file, options)
      const blob = new Blob([buffer], { type: mimeType })
      let newName = file.name
      const lastDot = file.name.lastIndexOf('.')
      if (lastDot !== -1) {
        newName = file.name.substring(0, lastDot) + extension
      } else {
        newName = file.name + extension
      }

      return new File([blob], newName, { type: mimeType })
    },

    /**
     * Extracts metadata and thumbnail from a video/audio file.
     * @param {File} file - The file to extract from.
     * @returns {Promise<{ thumbnail: Blob|null, duration: number, metadata?: any, albumArt?: Blob|null }>} Unified metadata extraction result.
     */
    extractThumbnail: async (file) => {
      const mediaWorkerPlugin = instanceContext.mediaWorker
      if (!mediaWorkerPlugin) {
        throw new Error('mediaWorker plugin not registered')
      }

      const $mediaWorker = mediaWorkerPlugin.$mediaWorker
      const result = await $mediaWorker.getMetadata(file)

      let compressedThumbnailBlob = null
      if (result.thumbnail) {
        compressedThumbnailBlob = await compressImage(result.thumbnail, {
          maxWidth: 1200,
          maxHeight: 1200,
          quality: 0.8,
          format: 'image/webp'
        })
      }

      let albumArtBlob = null
      if (result.albumArt) {
        albumArtBlob = new Blob([result.albumArt], { type: result.albumArtMimeType || 'image/jpeg' })
      }

      return {
        thumbnail: compressedThumbnailBlob,
        duration: result.duration,
        metadata: result.metadata,
        albumArt: albumArtBlob
      }
    }
  }
}
