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
        console.warn('[media-worker] MP4 encoding not supported, falling back to WebM (VP9)', mp4Error)
        try {
          result = await compressVideo(payload.file, {
            ...payload.options,
            format: 'webm',
            codec: 'vp9'
          }, (progress) => {
            self.postMessage({
              id,
              type: 'video:progress',
              payload: { progress }
            })
          })
        } catch (vp9Error) {
          console.warn('[media-worker] VP9 encoding not supported, falling back to WebM (VP8)', vp9Error)
          try {
            result = await compressVideo(payload.file, {
              ...payload.options,
              format: 'webm',
              codec: 'vp8'
            }, (progress) => {
              self.postMessage({
                id,
                type: 'video:progress',
                payload: { progress }
              })
            })
          } catch (vp8Error) {
            console.warn('[media-worker] VP8 encoding not supported, falling back to WebM (AV1)', vp8Error)
            try {
              result = await compressVideo(payload.file, {
                ...payload.options,
                format: 'webm',
                codec: 'av1'
              }, (progress) => {
                self.postMessage({
                  id,
                  type: 'video:progress',
                  payload: { progress }
                })
              })
            } catch (av1Error) {
              console.warn('[media-worker] All WebCodecs options failed. Initiating FFmpeg WASM fallback...', av1Error)
              try {
                result = await transcodeWithFFmpeg(payload.file, payload.options, (progress, status) => {
                  self.postMessage({
                    id,
                    type: 'video:progress',
                    payload: {
                      progress,
                      status
                    }
                  })
                })
              } catch (ffmpegError) {
                console.error('[media-worker] FFmpeg WASM fallback failed:', ffmpegError)
                throw ffmpegError
              }
            }
          }
        }
      }

      self.postMessage({
        id,
        type: 'video:compress',
        result
      }, [result.buffer.buffer])
    } else if (type === 'media:get-metadata') {
      const result = await getMetadata(payload.file, payload.options)
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
    } else if (type === 'video:evaluate') {
      const result = await evaluateVideoCompression(payload.file, payload.maxServerUploadSizeBytes, payload.duration)
      self.postMessage({
        id,
        type: 'video:evaluate',
        result
      })
    } else if (type === 'audio:convert') {
      const result = await convertAudioToUniversal(payload.file, payload.options, (progress) => {
        self.postMessage({
          id,
          type: 'audio:progress',
          payload: { progress }
        })
      })
      self.postMessage({
        id,
        type: 'audio:convert',
        result
      }, [result.buffer.buffer])
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

async function convertAudioToUniversal (file, options = {}, onProgress) {
  const input = new Input({
    formats: SUPPORTED_FORMATS,
    source: new BlobSource(file)
  })

  const outputFormat = new Mp4OutputFormat()
  const output = new Output({
    format: outputFormat,
    target: new BufferTarget()
  })

  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    audio: {
      bitrate: options.bitrate || 128_000
    }
  })

  if (!conversion.isValid) {
    throw new Error('Audio conversion not valid: ' + conversion.discardedTracks.map(t => t.reason).join(', '))
  }

  conversion.onProgress = (progress) => {
    if (onProgress) {
      onProgress(Math.round(progress * 100))
    }
  }

  await conversion.execute()

  return {
    buffer: new Uint8Array(output.target.buffer),
    mimeType: outputFormat.mimeType || 'audio/mp4',
    extension: '.m4a'
  }
}

async function evaluateVideoCompression (file, maxServerUploadSizeBytes = 26214400, givenDuration = 0) {
  if (file.size <= maxServerUploadSizeBytes) {
    return {
      shouldCompress: false,
      estimatedSizeBytes: file.size,
      targetBitrate: 0,
      useWebRTC: false
    }
  }

  let duration = givenDuration
  if (!duration || duration <= 0) {
    try {
      const input = new Input({
        formats: SUPPORTED_FORMATS,
        source: new BlobSource(file)
      })
      duration = await input.computeDuration()
    } catch (durErr) {
      console.warn('[media-worker] Failed to compute duration for evaluation:', durErr)
    }
  }

  const originalBitrate = (duration > 0) ? (file.size * 8) / duration : 5_000_000
  const targetVideoBitrate = Math.max(300_000, Math.min(Math.round(originalBitrate * 0.70), 1_500_000))
  const audioBitrate = 128_000

  const estimatedSizeBytes = Math.round(((targetVideoBitrate + audioBitrate) * duration) / 8) + 50_000
  const canFitOnServer = estimatedSizeBytes <= maxServerUploadSizeBytes

  console.log(`[media-worker] Evaluation for ${file.name}: Original size ${(file.size / 1e6).toFixed(2)}MB, Duration ${duration.toFixed(1)}s, Original Bitrate ${Math.round(originalBitrate / 1000)}kbps -> Target Bitrate ${Math.round(targetVideoBitrate / 1000)}kbps. Estimated Size: ${(estimatedSizeBytes / 1e6).toFixed(2)}MB (Limit: ${(maxServerUploadSizeBytes / 1e6).toFixed(2)}MB). CanFitOnServer: ${canFitOnServer}`)

  if (canFitOnServer) {
    return {
      shouldCompress: true,
      estimatedSizeBytes,
      targetBitrate: targetVideoBitrate,
      useWebRTC: false
    }
  } else {
    return {
      shouldCompress: false,
      estimatedSizeBytes,
      targetBitrate: 0,
      useWebRTC: true
    }
  }
}

async function getMetadata (file, options = {}) {
  let duration = 0
  let tags = {}
  let input = null

  try {
    input = new Input({
      formats: SUPPORTED_FORMATS,
      source: new BlobSource(file)
    })
    try {
      duration = await input.computeDuration()
    } catch (durErr) {
      console.warn('[media-worker] Failed to compute duration:', durErr)
    }
    try {
      tags = await input.getMetadataTags() || {}
    } catch (tagsErr) {
      console.warn('[media-worker] Failed to get metadata tags:', tagsErr)
    }
  } catch (initErr) {
    console.warn('[media-worker] Input initialization failed:', initErr)
  }

  let thumbnail = null
  if ((file.type.startsWith('video/') || (file.name && file.name.match(/\.(mkv|avi|mov|flv|wmv|ts|m2ts|3gp|ogv)$/i))) && !options.skipThumbnail) {
    if (input) {
      try {
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
      } catch (thumbErr) {
        console.warn('[media-worker] WebCodecs thumbnail extraction failed:', thumbErr)
      }
    }
    if (!thumbnail) {
      try {
        console.info('[media-worker] Attempting FFmpeg WASM thumbnail extraction fallback...')
        thumbnail = await extractThumbnailWithFFmpeg(file)
      } catch (ffmpegThumbErr) {
        console.warn('[media-worker] FFmpeg WASM thumbnail extraction failed:', ffmpegThumbErr)
      }
    }
  }

  // Extract album art for audio
  let albumArt = null
  let albumArtMimeType = null
  if (tags && tags.images && tags.images.length > 0) {
    try {
      albumArt = tags.images[0].data
      albumArtMimeType = tags.images[0].mimeType
    } catch (artErr) {
      console.warn('[media-worker] Failed to extract album art:', artErr)
    }
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
  const input = new Input({
    formats: SUPPORTED_FORMATS,
    source: new BlobSource(file)
  })

  let duration = options.duration || 0
  if (!duration || duration <= 0) {
    try {
      duration = await input.computeDuration()
    } catch (e) {
      console.warn('[media-worker] Could not compute duration:', e)
    }
  }

  let targetBitrate = options.bitrate
  if (!targetBitrate) {
    const originalBitrate = (duration > 0) ? (file.size * 8) / duration : 5_000_000
    targetBitrate = Math.max(300_000, Math.min(Math.round(originalBitrate * 0.70), 1_500_000))
  }

  const {
    maxWidth = 1280,
    maxHeight = 720,
    format = 'mp4',
    codec = 'vp9'
  } = options

  const outputFormat = format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat()

  const output = new Output({
    format: outputFormat,
    target: new BufferTarget()
  })

  const videoConfig = {
    width: maxWidth,
    height: maxHeight,
    fit: 'contain',
    bitrate: targetBitrate
  }

  if (format === 'webm') {
    videoConfig.codec = codec
  }

  const conversionOptions = {
    input,
    output,
    tracks: 'primary',
    video: videoConfig
  }

  if (format === 'webm') {
    conversionOptions.audio = {
      codec: 'opus',
      bitrate: 128_000
    }
  }

  const conversion = await Conversion.init(conversionOptions)

  if (!conversion.isValid) {
    const videoTrackValid = !conversion.discardedTracks.some(t => t.track && t.track.kind === 'video')
    if (videoTrackValid) {
      console.warn('[media-worker] Audio track discarded in conversion; retrying video track only')
      delete conversionOptions.audio
      const videoOnlyConversion = await Conversion.init(conversionOptions)
      if (videoOnlyConversion.isValid) {
        if (onProgress) {
          videoOnlyConversion.onProgress = (progress) => onProgress(Math.round(progress * 100))
        }
        await videoOnlyConversion.execute()
        return {
          buffer: new Uint8Array(output.target.buffer),
          mimeType: outputFormat.mimeType,
          extension: outputFormat.fileExtension
        }
      }
    }
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

let ffmpegInstance = null

async function getFFmpegInstance () {
  if (!ffmpegInstance) {
    const { FFmpeg } = await import('/assets/ffmpeg/index.js')
    ffmpegInstance = new FFmpeg()
  }
  if (!ffmpegInstance.loaded) {
    await ffmpegInstance.load({
      classWorkerURL: '/assets/ffmpeg/worker.js',
      coreURL: '/assets/ffmpeg-core.js',
      wasmURL: '/assets/ffmpeg-core.wasm'
    })
  }
  return ffmpegInstance
}

async function transcodeWithFFmpeg (file, _options = {}, onProgress) {
  if (onProgress) {
    onProgress(0, 'Initializing FFmpeg WASM transcoder...')
  }

  const ffmpeg = await getFFmpegInstance()

  const progressHandler = ({ progress }) => {
    if (onProgress) {
      const pct = Math.min(99, Math.max(1, Math.round(progress * 100)))
      onProgress(pct, `Transcoding video with FFmpeg WASM... ${pct}%`)
    }
  }

  ffmpeg.on('progress', progressHandler)

  try {
    const fileArrayBuffer = await file.arrayBuffer()
    const inputData = new Uint8Array(fileArrayBuffer)

    const lastDot = file.name ? file.name.lastIndexOf('.') : -1
    const ext = lastDot !== -1 ? file.name.substring(lastDot) : '.mkv'
    const timestamp = Date.now()
    const inputName = `input_${timestamp}${ext}`
    const outputName = `output_${timestamp}.mp4`

    await ffmpeg.writeFile(inputName, inputData)

    const execArgs = [
      '-i',
      inputName,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '28',
      '-vf',
      'scale=trunc(oh*a/2)*2:720',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputName
    ]

    console.info(`[media-worker] Executing FFmpeg WASM command: ffmpeg ${execArgs.join(' ')}`)
    const ret = await ffmpeg.exec(execArgs)

    if (ret !== 0) {
      throw new Error(`FFmpeg process exited with non-zero code (${ret})`)
    }

    const outputData = await ffmpeg.readFile(outputName)

    try {
      await ffmpeg.deleteFile(inputName)
      await ffmpeg.deleteFile(outputName)
    } catch (e) {
      console.warn('[media-worker] Cleanup error (ignored):', e)
    }

    if (onProgress) {
      onProgress(100, 'Video transcoding complete!')
    }

    return {
      buffer: outputData,
      mimeType: 'video/mp4',
      extension: '.mp4'
    }
  } finally {
    ffmpeg.off('progress', progressHandler)
  }
}

async function extractThumbnailWithFFmpeg (file) {
  const ffmpeg = await getFFmpegInstance()

  try {
    const fileArrayBuffer = await file.arrayBuffer()
    const inputData = new Uint8Array(fileArrayBuffer)

    const lastDot = file.name ? file.name.lastIndexOf('.') : -1
    const ext = lastDot !== -1 ? file.name.substring(lastDot) : '.mkv'
    const timestamp = Date.now()
    const inputName = `thumb_in_${timestamp}${ext}`
    const outputName = `thumb_out_${timestamp}.jpg`

    await ffmpeg.writeFile(inputName, inputData)

    const ret = await ffmpeg.exec([
      '-ss',
      '00:00:01',
      '-i',
      inputName,
      '-vframes',
      '1',
      '-vf',
      'scale=1200:-1',
      outputName
    ])

    if (ret !== 0) {
      throw new Error(`FFmpeg thumbnail process exited with code ${ret}`)
    }

    const outputData = await ffmpeg.readFile(outputName)

    try {
      await ffmpeg.deleteFile(inputName)
      await ffmpeg.deleteFile(outputName)
    } catch (_e) {
    }

    const blob = new Blob([outputData], { type: 'image/jpeg' })
    return await createImageBitmap(blob)
  } catch (err) {
    console.warn('[media-worker] extractThumbnailWithFFmpeg failed:', err)
    return null
  }
}

