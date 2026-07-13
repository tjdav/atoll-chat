/**
 * Native Media Adapter Factory
 * Standardized Stub executing native-mock logs and returning uncompressed/original inputs.
 * @param {Object} _instanceContext - The instance context containing other plugins.
 * @returns {Object} The Native Media Adapter.
 */
export function createNativeMediaAdapter (_instanceContext) {
  return {
    /**
     * Compresses an image. Returns the original source/file.
     * @param {File|Blob} source - The source image or Blob.
     * @param {Object} _options - Compression options.
     * @returns {Promise<Blob>} The compressed image blob.
     */
    compressImage: async (source, _options = {}) => {
      console.info('[NativeMediaAdapter] compressImage called, bypassing for now')
      if (source instanceof Blob) {
        return source
      }
      // If it's a Canvas or other HTML element, convert to a Blob
      if (source.toBlob) {
        return new Promise((resolve, reject) => {
          source.toBlob((blob) => {
            if (blob) {
              resolve(blob)
            } else {
              reject(new Error('Canvas toBlob failed'))
            }
          }, 'image/webp', 0.8)
        })
      }
      throw new Error('Unsupported image source type on native stub')
    },

    /**
     * Compresses a video. Returns the original file.
     * @param {File} _file - The video file.
     * @param {Object} _options - Compression options.
     * @returns {Promise<File>} The compressed video file.
     */
    compressVideo: async (_file, _options = {}) => {
      console.info('[NativeMediaAdapter] compressVideo called, bypassing for now')
      return _file
    },

    /**
     * Extracts metadata/thumbnail. Returns a dummy or fallback layout.
     * @param {File} _file - The media file.
     * @returns {Promise<{ thumbnail: Blob|null, duration: number, metadata?: any, albumArt?: Blob|null }>} Unified metadata result.
     */
    extractThumbnail: async (_file) => {
      console.info('[NativeMediaAdapter] extractThumbnail called, bypassing for now')
      // Provide safe defaults for the native stub
      return {
        thumbnail: null,
        duration: 0,
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
    }
  }
}
