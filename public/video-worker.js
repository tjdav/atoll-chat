import {
  Input,
  Output,
  Conversion,
  ALL_FORMATS,
  BlobSource,
  Mp4OutputFormat,
  BufferTarget
} from '/assets/mediabunny.mjs'

self.onmessage = async (event) => {
  const { id, type, payload } = event.data

  if (type === 'video:compress') {
    try {
      const result = await compressVideo(payload.file, payload.options, (progress) => {
        self.postMessage({
          id,
          type: 'video:progress',
          payload: { progress }
        })
      })
      self.postMessage({
        id,
        type: 'video:compress',
        result
      }, [result.buffer])
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
    bitrate = 2_000_000
  } = options

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file)
  })

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget()
  })

  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: {
      width: maxWidth,
      height: maxHeight,
      fit: 'contain',
      bitrate
    }
  })

  if (!conversion.isValid) {
    throw new Error('Conversion not valid: ' + conversion.discardedTracks.map(t => t.reason).join(', '))
  }

  conversion.onProgress = (progress) => {
    if (onProgress) {
      onProgress(Math.round(progress * 100))
    }
  }

  await conversion.execute()

  return new Uint8Array(output.target.buffer)
}
