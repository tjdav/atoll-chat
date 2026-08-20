import test, { describe } from 'node:test'
import assert from 'node:assert'
import { checkMediaCompatibility } from '../../../src/utils/media-compatibility.js'

describe('checkMediaCompatibility utility tests', () => {
  test('should return default object when file is null or undefined', () => {
    const expected = {
      requiresConversion: false,
      category: 'none',
      reason: '',
      targetFormat: '',
      targetExtension: ''
    }
    assert.deepStrictEqual(checkMediaCompatibility(null), expected)
    assert.deepStrictEqual(checkMediaCompatibility(undefined), expected)
  })

  test('should return default object when file has no name', () => {
    const expected = {
      requiresConversion: false,
      category: 'none',
      reason: '',
      targetFormat: '',
      targetExtension: ''
    }
    assert.deepStrictEqual(checkMediaCompatibility({ type: 'video/mp4' }), expected)
    assert.deepStrictEqual(checkMediaCompatibility({ name: '' }), expected)
  })

  test('should handle files with no extension', () => {
    const res1 = checkMediaCompatibility({
      name: 'video-file',
      type: 'video/mp4'
    })
    assert.strictEqual(res1.requiresConversion, false)
    assert.strictEqual(res1.category, 'none')

    const res2 = checkMediaCompatibility({
      name: 'video-file',
      type: 'video/x-matroska'
    })
    assert.strictEqual(res2.requiresConversion, true)
    assert.strictEqual(res2.category, 'video')
    assert.strictEqual(res2.targetFormat, 'video/mp4')
    assert.strictEqual(res2.targetExtension, '.mp4')
  })

  // Case Insensitivity
  test('should be resilient to case of extensions and mime types', () => {
    // Uppercase universal image
    const res1 = checkMediaCompatibility({
      name: 'IMAGE.PNG',
      type: 'IMAGE/PNG'
    })
    assert.strictEqual(res1.requiresConversion, false)

    // Uppercase non-universal video
    const res2 = checkMediaCompatibility({
      name: 'movie.MKV',
      type: 'video/x-matroska'
    })
    assert.strictEqual(res2.requiresConversion, true)
    assert.strictEqual(res2.category, 'video')
    assert.strictEqual(res2.targetFormat, 'video/mp4')
    assert.strictEqual(res2.targetExtension, '.mp4')
    assert.match(res2.reason, /\.mkv/i)
  })

  // Universal Formats
  test('should not require conversion for universal videos', () => {
    const files = [
      {
        name: 'clip.mp4',
        type: 'video/mp4'
      },
      {
        name: 'clip.webm',
        type: 'video/webm'
      }
    ]
    for (const f of files) {
      const res = checkMediaCompatibility(f)
      assert.strictEqual(res.requiresConversion, false, `Failed for ${f.name}`)
      assert.strictEqual(res.category, 'none')
    }
  })

  test('should not require conversion for universal images', () => {
    const files = [
      {
        name: 'pic.jpg',
        type: 'image/jpeg'
      },
      {
        name: 'pic.jpeg',
        type: 'image/jpeg'
      },
      {
        name: 'pic.png',
        type: 'image/png'
      },
      {
        name: 'pic.gif',
        type: 'image/gif'
      }
    ]
    for (const f of files) {
      const res = checkMediaCompatibility(f)
      assert.strictEqual(res.requiresConversion, false, `Failed for ${f.name}`)
      assert.strictEqual(res.category, 'none')
    }
  })

  test('should recognize .lottie, .json, and .webp as stickers with category "sticker"', () => {
    const stickerFiles = [
      {
        name: 'sticker.lottie',
        type: 'application/json'
      },
      {
        name: 'anim.json',
        type: 'application/json'
      },
      {
        name: 'pic.webp',
        type: 'image/webp'
      }
    ]
    for (const f of stickerFiles) {
      const res = checkMediaCompatibility(f)
      assert.strictEqual(res.requiresConversion, false, `Failed for ${f.name}`)
      assert.strictEqual(res.category, 'sticker')
    }
  })

  test('should not require conversion for universal audios', () => {
    const files = [
      {
        name: 'song.mp4',
        type: 'audio/mp4'
      },
      {
        name: 'song.m4a',
        type: 'audio/mp4'
      },
      {
        name: 'song.aac',
        type: 'audio/aac'
      },
      {
        name: 'song.mp3',
        type: 'audio/mpeg'
      },
      {
        name: 'song.webm',
        type: 'audio/webm'
      },
      {
        name: 'song.ogg',
        type: 'audio/ogg'
      }
    ]
    for (const f of files) {
      const res = checkMediaCompatibility(f)
      assert.strictEqual(res.requiresConversion, false, `Failed for ${f.name}`)
      assert.strictEqual(res.category, 'none')
    }
  })

  test('should require conversion for non-universal video formats', () => {
    const nonUniversalVideos = [
      {
        name: 'movie.mkv',
        type: 'video/x-matroska',
        ext: 'mkv'
      },
      {
        name: 'movie.avi',
        type: 'video/x-msvideo',
        ext: 'avi'
      },
      {
        name: 'movie.mov',
        type: 'video/quicktime',
        ext: 'mov'
      },
      {
        name: 'movie.flv',
        type: 'video/x-flv',
        ext: 'flv'
      },
      {
        name: 'movie.wmv',
        type: 'video/x-ms-wmv',
        ext: 'wmv'
      },
      {
        name: 'movie.ts',
        type: 'video/mp2t',
        ext: 'ts'
      },
      {
        name: 'movie.m2ts',
        type: 'video/mp2t',
        ext: 'm2ts'
      },
      {
        name: 'movie.3gp',
        type: 'video/3gpp',
        ext: '3gp'
      },
      {
        name: 'movie.ogv',
        type: 'video/ogg',
        ext: 'ogv'
      }
    ]

    for (const f of nonUniversalVideos) {
      const res = checkMediaCompatibility(f)
      assert.strictEqual(res.requiresConversion, true, `Failed for ${f.name}`)
      assert.strictEqual(res.category, 'video')
      assert.strictEqual(res.targetFormat, 'video/mp4')
      assert.strictEqual(res.targetExtension, '.mp4')
      assert.strictEqual(res.reason, `Video container/format (.${f.ext}) is not universally playable in HTML5 video elements.`)
    }
  })

  test('should require conversion for non-universal image formats', () => {
    const nonUniversalImages = [
      {
        name: 'photo.heic',
        type: 'image/heic',
        ext: 'heic'
      },
      {
        name: 'photo.heif',
        type: 'image/heif',
        ext: 'heif'
      },
      {
        name: 'photo.bmp',
        type: 'image/bmp',
        ext: 'bmp'
      },
      {
        name: 'photo.tiff',
        type: 'image/tiff',
        ext: 'tiff'
      },
      {
        name: 'photo.tif',
        type: 'image/tiff',
        ext: 'tif'
      },
      {
        name: 'photo.raw',
        type: 'image/x-panasonic-raw',
        ext: 'raw'
      },
      {
        name: 'photo.cr2',
        type: 'image/x-canon-cr2',
        ext: 'cr2'
      },
      {
        name: 'photo.nef',
        type: 'image/x-nikon-nef',
        ext: 'nef'
      }
    ]

    for (const f of nonUniversalImages) {
      const res = checkMediaCompatibility(f)
      assert.strictEqual(res.requiresConversion, true, `Failed for ${f.name}`)
      assert.strictEqual(res.category, 'image')
      assert.strictEqual(res.targetFormat, 'image/webp')
      assert.strictEqual(res.targetExtension, '.webp')
      assert.strictEqual(res.reason, `Image format (.${f.ext}) is not natively supported across browsers.`)
    }
  })

  test('should require conversion for non-universal audio formats', () => {
    const nonUniversalAudios = [
      {
        name: 'track.wav',
        type: 'audio/wav',
        ext: 'wav'
      },
      {
        name: 'track.aiff',
        type: 'audio/x-aiff',
        ext: 'aiff'
      },
      {
        name: 'track.wma',
        type: 'audio/x-ms-wma',
        ext: 'wma'
      },
      {
        name: 'track.flac',
        type: 'audio/flac',
        ext: 'flac'
      },
      {
        name: 'track.ape',
        type: 'audio/x-ape',
        ext: 'ape'
      },
      {
        name: 'track.alac',
        type: 'audio/m4a',
        ext: 'alac'
      }
    ]

    for (const f of nonUniversalAudios) {
      const res = checkMediaCompatibility(f)
      assert.strictEqual(res.requiresConversion, true, `Failed for ${f.name}`)
      assert.strictEqual(res.category, 'audio')
      assert.strictEqual(res.targetFormat, 'audio/mp4')
      assert.strictEqual(res.targetExtension, '.m4a')
      assert.strictEqual(res.reason, `Audio format (.${f.ext}) is uncompressed or has limited browser playback support.`)
    }
  })

  test('should not require conversion for non-media formats', () => {
    const files = [
      {
        name: 'document.pdf',
        type: 'application/pdf'
      },
      {
        name: 'notes.txt',
        type: 'text/plain'
      },
      {
        name: 'archive.zip',
        type: 'application/zip'
      }
    ]
    for (const f of files) {
      const res = checkMediaCompatibility(f)
      assert.strictEqual(res.requiresConversion, false, `Failed for ${f.name}`)
      assert.strictEqual(res.category, 'none')
    }
  })
})
