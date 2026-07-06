import {
  Input,
  Output,
  Conversion,
  ALL_FORMATS,
  BlobSource,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget
} from '/assets/mediabunny.mjs'

self.onmessage = async (event) => {
  const { id, type, payload } = event.data

  if (type === 'video:compress') {
    try {
      let result
      try {
        console.log('[video-worker] Attempting MP4 compression')
        result = await compressVideo(payload.file, {
          ...payload.options,
          format: 'mp4'
        }, (progress) => {
          self.postMessage({
            id,
            type: 'video:progress',
            payload: { progress }
          })
        })
      } catch (mp4Error) {
        if (mp4Error.message.includes('encoding is not supported')) {
          console.warn('[video-worker] MP4 encoding not supported, falling back to WebM (VP9)')
          result = await compressVideo(payload.file, {
            ...payload.options,
            format: 'webm'
          }, (progress) => {
            self.postMessage({
              id,
              type: 'video:progress',
              payload: { progress }
            })
          })
        } else {
          throw mp4Error
        }
      }

      self.postMessage({
        id,
        type: 'video:compress',
        result
      }, [result.buffer.buffer])
    } catch (error) {
      console.error('[video-worker] Compression error:', error)
      self.postMessage({
        id,
        type: 'video:compress',
        error: error.message
      })
    }
  }
}

async function compressVideo (file, options = {}, onProgress) {
  const {
    maxWidth = 1280,
    maxHeight = 720,
    bitrate = 2_000_000,
    format = 'mp4'
  } = options

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file)
  })

  const outputFormat = format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat()

  const output = new Output({
    format: outputFormat,
    target: new BufferTarget()
  })

  const conversionOptions = {
    input,
    output,
    tracks: 'primary',
    video: {
      width: maxWidth,
      height: maxHeight,
      fit: 'contain',
      bitrate
    }
  }

  if (format === 'webm') {
    conversionOptions.video.codec = 'vp9'
  }

  const conversion = await Conversion.init(conversionOptions)

  if (!conversion.isValid) {
    throw new Error('Conversion not valid: ' + conversion.discardedTracks.map(t => t.reason).join(', '))
  }

  conversion.onProgress = (progress) => {
    if (onProgress) {
      onProgress(Math.round(progress * 100))
    }
  }

  await conversion.execute()

  return {
    buffer: new Uint8Array(output.target.buffer),
    mimeType: outputFormat.mimeType,
    extension: outputFormat.fileExtension
  }
}
