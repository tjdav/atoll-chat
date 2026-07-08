import {
  Input,
  Output,
  Conversion,
  BlobSource,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  MP4,
  QTFF,
  WEBM,
  MATROSKA,
  MP3,
  WAVE,
  OGG,
  ADTS,
  FLAC,
  MPEG_TS,
  CanvasSink
} from '/assets/mediabunny.mjs'

const SUPPORTED_FORMATS = [MP4, QTFF, WEBM, MATROSKA, MP3, WAVE, OGG, ADTS, FLAC, MPEG_TS]

self.onmessage = async (event) => {
  const { id, type, payload } = event.data

  try {
    if (type === 'video:compress') {
      let result
      try {
        console.log('[media-worker] Attempting MP4 compression')
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
          console.warn('[media-worker] MP4 encoding not supported, falling back to WebM (VP9)')
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
    } else if (type === 'media:get-metadata') {
      const result = await getMetadata(payload.file)
      const transferables = []
      if (result.albumArt) {
        transferables.push(result.albumArt.buffer)
      }
      if (result.thumbnail) {
        transferables.push(result.thumbnail)
      }

      self.postMessage({
        id,
        type: 'media:get-metadata',
        result
      }, transferables)
    }
  } catch (error) {
    console.error(`[media-worker] Error (${type}):`, error)
    self.postMessage({
      id,
      type,
      error: error.message
    })
  }
}

async function getMetadata (file) {
  const input = new Input({
    formats: SUPPORTED_FORMATS,
    source: new BlobSource(file)
  })

  const duration = await input.computeDuration()
  const tags = await input.getMetadataTags()

  let thumbnail = null
  if (file.type.startsWith('video/')) {
    const videoTrack = await input.getPrimaryVideoTrack()
    if (videoTrack) {
      const sink = new CanvasSink(videoTrack, {
        width: 1200,
        height: 1200,
        fit: 'contain'
      })
      const result = await sink.getCanvas(0)
      if (result) {
        thumbnail = await result.canvas.transferToImageBitmap()
      }
    }
  }

  // Extract album art for audio
  let albumArt = null
  let albumArtMimeType = null
  if (tags.images && tags.images.length > 0) {
    albumArt = tags.images[0].data
    albumArtMimeType = tags.images[0].mimeType
  }

  return {
    duration,
    metadata: {
      title: tags.title,
      artist: tags.artist,
      album: tags.album,
      genre: tags.genre,
      year: tags.date instanceof Date ? tags.date.getFullYear() : null,
      track: tags.track ? tags.track.no : null
    },
    albumArt,
    albumArtMimeType,
    thumbnail
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
    formats: SUPPORTED_FORMATS,
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
