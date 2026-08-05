/**
 * Media Format & Compatibility Detector for Atoll Chat.
 * Identifies media files in non-universal containers/codecs (.mkv, .avi, .mov, .ts, .heic, .wav, .flac)
 * that cannot be natively played or rendered inline in standard HTML5 video/image/audio tags across all browsers.
 */

const NON_UNIVERSAL_VIDEO_EXTENSIONS = new Set(['mkv', 'avi', 'mov', 'flv', 'wmv', 'ts', 'm2ts', '3gp', 'ogv'])
const NON_UNIVERSAL_IMAGE_EXTENSIONS = new Set(['heic', 'heif', 'bmp', 'tiff', 'tif', 'raw', 'cr2', 'nef'])
const NON_UNIVERSAL_AUDIO_EXTENSIONS = new Set(['wav', 'aiff', 'wma', 'flac', 'ape', 'alac'])

const UNIVERSAL_VIDEO_MIMES = new Set(['video/mp4', 'video/webm'])
const UNIVERSAL_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const UNIVERSAL_AUDIO_MIMES = new Set(['audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg'])

/**
 * Evaluates whether a media file is in a non-universal format that requires format conversion for HTML5 web playback.
 *
 * @param {File} file - Selected media file.
 * @returns {{ requiresConversion: boolean, category: 'video'|'image'|'audio'|'none', reason: string, targetFormat: string, targetExtension: string }}
 */
export function checkMediaCompatibility (file) {
  if (!file || !file.name) {
    return {
      requiresConversion: false,
      category: 'none',
      reason: '',
      targetFormat: '',
      targetExtension: ''
    }
  }

  const lastDot = file.name.lastIndexOf('.')
  const extension = lastDot !== -1 ? file.name.substring(lastDot + 1).toLowerCase() : ''
  const mime = (file.type || '').toLowerCase()

  // Check Video Compatibility
  const isVideoType = mime.startsWith('video/') || NON_UNIVERSAL_VIDEO_EXTENSIONS.has(extension)
  if (isVideoType) {
    const isUniversal = UNIVERSAL_VIDEO_MIMES.has(mime) && !NON_UNIVERSAL_VIDEO_EXTENSIONS.has(extension)
    if (!isUniversal) {
      return {
        requiresConversion: true,
        category: 'video',
        reason: `Video container/format (.${extension || 'unknown'}) is not universally playable in HTML5 video elements.`,
        targetFormat: 'video/mp4',
        targetExtension: '.mp4'
      }
    }
  }

  // Check Image Compatibility
  const isImageType = mime.startsWith('image/') || NON_UNIVERSAL_IMAGE_EXTENSIONS.has(extension)
  if (isImageType) {
    const isUniversal = UNIVERSAL_IMAGE_MIMES.has(mime) && !NON_UNIVERSAL_IMAGE_EXTENSIONS.has(extension)
    if (!isUniversal) {
      return {
        requiresConversion: true,
        category: 'image',
        reason: `Image format (.${extension || 'unknown'}) is not natively supported across browsers.`,
        targetFormat: 'image/webp',
        targetExtension: '.webp'
      }
    }
  }

  // Check Audio Compatibility
  const isAudioType = mime.startsWith('audio/') || NON_UNIVERSAL_AUDIO_EXTENSIONS.has(extension)
  if (isAudioType) {
    const isUniversal = UNIVERSAL_AUDIO_MIMES.has(mime) && !NON_UNIVERSAL_AUDIO_EXTENSIONS.has(extension)
    if (!isUniversal) {
      return {
        requiresConversion: true,
        category: 'audio',
        reason: `Audio format (.${extension || 'unknown'}) is uncompressed or has limited browser playback support.`,
        targetFormat: 'audio/mp4',
        targetExtension: '.m4a'
      }
    }
  }

  return {
    requiresConversion: false,
    category: 'none',
    reason: '',
    targetFormat: '',
    targetExtension: ''
  }
}
