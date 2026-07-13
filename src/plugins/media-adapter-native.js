import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'

/**
 * Helper to convert Blob/File to Base64.
 * @param {Blob|File} blob - The input file or blob.
 * @returns {Promise<string>} The Base64 encoded file payload.
 */
function blobToBase64 (blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result
      if (typeof dataUrl === 'string') {
        const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1)
        resolve(base64)
      } else {
        reject(new Error('FileReader returned non-string result'))
      }
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Helper to save a file to the Capacitor cache directory and return its native URI.
 * @param {Blob|File} file - The file/blob to save.
 * @param {string} ext - Default file extension to use.
 * @returns {Promise<{ tempFileName: string|null, uri: string }>} Resolves with temp filename and native file URI.
 */
async function saveToCacheAndGetUri (file, ext = '.mp4') {
  /** @type {any} */
  const fileObj = file

  /* Check if the input file already has a direct native path/URI reference from Capacitor */
  const existingPath = fileObj && (fileObj.path || fileObj.uri || fileObj.nativeURL)
  if (existingPath && typeof existingPath === 'string') {
    console.info('[NativeMediaAdapter] Input file already has a native path/URI:', existingPath)
    return {
      tempFileName: null,
      uri: existingPath
    }
  }

  let finalExt = ext
  if (fileObj && typeof fileObj.name === 'string') {
    const lastDot = fileObj.name.lastIndexOf('.')
    if (lastDot !== -1) {
      finalExt = fileObj.name.substring(lastDot)
    }
  }

  const tempFileName = `temp_input_${Date.now()}_${Math.random().toString(36).substring(2, 11)}${finalExt}`
  const base64Data = await blobToBase64(file)

  await Filesystem.writeFile({
    path: tempFileName,
    data: base64Data,
    directory: Directory.Cache
  })

  const { uri } = await Filesystem.getUri({
    path: tempFileName,
    directory: Directory.Cache
  })

  return {
    tempFileName,
    uri
  }
}

/**
 * Native Media Adapter Factory
 * Executes native-hardware accelerated media compression and thumbnail extraction via AtollMediaPlugin.
 * @param {Object} _instanceContext - The instance context containing other plugins.
 * @returns {Object} The Native Media Adapter.
 */
export function createNativeMediaAdapter (_instanceContext) {
  return {
    /**
     * Compresses an image. Left as a stub for native since browsers handle Canvas beautifully.
     * @param {File|Blob} source - The source image or Blob.
     * @param {Object} _options - Compression options.
     * @returns {Promise<Blob>} The compressed image blob.
     */
    compressImage: async (source, _options = {}) => {
      if (!Capacitor.isNativePlatform()) {
        throw new Error('Cannot run NativeMediaAdapter.compressImage on a non-native platform')
      }

      console.info('[NativeMediaAdapter] compressImage called, bypassing native hardware acceleration and returning source')
      if (source instanceof Blob) {
        return source
      }
      /** @type {any} */
      const maybeCanvas = source
      if (maybeCanvas && typeof maybeCanvas.toBlob === 'function') {
        return new Promise((resolve, reject) => {
          maybeCanvas.toBlob((blob) => {
            if (blob) {
              resolve(blob)
            } else {
              reject(new Error('Canvas toBlob failed'))
            }
          }, 'image/webp', 0.8)
        })
      }
      throw new Error('Unsupported image source type on native adapter')
    },

    /**
     * Compresses a video file natively.
     * @param {File} file - The original video file.
     * @param {Object} options - Compression options.
     * @returns {Promise<File>} Resolves to the newly compressed video File.
     */
    compressVideo: async (file, options = {}) => {
      if (!Capacitor.isNativePlatform()) {
        throw new Error('Cannot run NativeMediaAdapter.compressVideo on a non-native platform')
      }

      /** @type {any} */
      const cap = Capacitor
      const plugins = cap.Plugins
      const AtollMediaPlugin = plugins ? plugins.AtollMediaPlugin : null
      if (!AtollMediaPlugin) {
        throw new Error('AtollMediaPlugin is not registered in the Capacitor environment')
      }

      let tempFileName = null
      try {
        console.info(`[NativeMediaAdapter] Preparing video for native hardware-accelerated compression: "${file.name}"`)

        /* Save the input file to the native cache directory */
        const cacheResult = await saveToCacheAndGetUri(file, '.mp4')
        tempFileName = cacheResult.tempFileName
        const sourceUri = cacheResult.uri

        /* Invoke the native plugin */
        const quality = options.quality !== undefined ? options.quality : 0.8
        const nativeResult = await AtollMediaPlugin.compressVideo({
          sourcePath: sourceUri,
          quality
        })

        const destinationPath = nativeResult.destinationPath
        if (!destinationPath) {
          throw new Error('Native video compression did not return a destinationPath')
        }

        /* Convert the absolute native path to a Web View safe source URL */
        const webPath = Capacitor.convertFileSrc(destinationPath)

        /* Fetch the file safely via stream to avoid Out-Of-Memory bridge crashes */
        const response = await fetch(webPath)
        const blob = await response.blob()

        /* Construct final File object */
        let newName = file.name
        const lastDot = file.name.lastIndexOf('.')
        if (lastDot !== -1) {
          newName = file.name.substring(0, lastDot) + '_compressed.mp4'
        } else {
          newName = file.name + '_compressed.mp4'
        }

        return new File([blob], newName, { type: blob.type || 'video/mp4' })

      } finally {
        /* Housekeeping: Delete the temporary input file if created */
        if (tempFileName) {
          try {
            await Filesystem.deleteFile({
              path: tempFileName,
              directory: Directory.Cache
            })
          } catch (deleteError) {
            console.warn('[NativeMediaAdapter] Failed to delete temporary input video file:', deleteError)
          }
        }
      }
    },

    /**
     * Extracts metadata/thumbnail from a video/audio file natively.
     * @param {File} file - The media file.
     * @returns {Promise<{ thumbnail: Blob|null, duration: number, metadata?: any, albumArt?: Blob|null }>} Unified metadata result.
     */
    extractThumbnail: async (file) => {
      if (!Capacitor.isNativePlatform()) {
        throw new Error('Cannot run NativeMediaAdapter.extractThumbnail on a non-native platform')
      }

      /** @type {any} */
      const cap = Capacitor
      const plugins = cap.Plugins
      const AtollMediaPlugin = plugins ? plugins.AtollMediaPlugin : null
      if (!AtollMediaPlugin) {
        throw new Error('AtollMediaPlugin is not registered in the Capacitor environment')
      }

      let tempFileName = null
      try {
        console.info(`[NativeMediaAdapter] Extracting thumbnail and metadata natively for: "${file.name}"`)

        /* Save the input file to the native cache directory */
        const cacheResult = await saveToCacheAndGetUri(file, '.mp4')
        tempFileName = cacheResult.tempFileName
        const sourceUri = cacheResult.uri

        /* Invoke the native plugin */
        const nativeResult = await AtollMediaPlugin.extractThumbnail({
          sourcePath: sourceUri
        })

        const thumbnailPath = nativeResult.thumbnailPath
        let thumbnailBlob = null

        /* If a thumbnail was successfully extracted, retrieve it safely */
        if (thumbnailPath) {
          const webPath = Capacitor.convertFileSrc(thumbnailPath)
          const response = await fetch(webPath)
          thumbnailBlob = await response.blob()
        }

        /* Return standard unified contract structure */
        return {
          thumbnail: thumbnailBlob,
          duration: nativeResult.duration || 0,
          metadata: {
            title: '',
            artist: '',
            album: '',
            genre: '',
            year: null,
            track: null
          },
          albumArt: null
        }

      } finally {
        /* Housekeeping: Delete the temporary input file if created */
        if (tempFileName) {
          try {
            await Filesystem.deleteFile({
              path: tempFileName,
              directory: Directory.Cache
            })
          } catch (deleteError) {
            console.warn('[NativeMediaAdapter] Failed to delete temporary input media file:', deleteError)
          }
        }
      }
    }
  }
}
