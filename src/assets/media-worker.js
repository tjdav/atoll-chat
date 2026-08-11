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
      let result = null
      const configs = [
        { format: 'mp4' },
        {
          format: 'webm',
          codec: 'vp9'
        },
        {
          format: 'webm',
          codec: 'vp8'
        },
        {
          format: 'webm',
          codec: 'av1'
        }
      ]

      for (const config of configs) {
        try {
          result = await compressVideo(payload.file, {
            ...payload.options,
            ...config
          }, (progress) => {
            self.postMessage({
              id,
              type: 'video:progress',
              payload: { progress }
            })
          })
          break
        } catch {
          // Fallback to the next codec configuration
        }
      }

      if (!result) {
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
          throw ffmpegError
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
  } catch (err) {
    self.postMessage({
      id,
      type,
      error: err.message
    })
  }
}

/**
 * Converts audio to a universal format (MP4 audio / AAC).
 *
 * @param {Blob|File} file - The raw audio file to convert.
 * @param {Object} [options={}] - Conversion options.
 * @param {number} [options.bitrate=128000] - Output target bitrate.
 * @param {Function} [onProgress] - Callback invoked with the progress percentage (0-100).
 * @returns {Promise<{buffer: Uint8Array, mimeType: string, extension: string}>} The converted audio bytes and metadata.
 * @throws {Error} If the conversion configuration is invalid or execution fails.
 */
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

/**
 * Evaluates whether a video file requires compression before server upload,
 * determining the target bitrate or suggesting a P2P WebRTC transfer if the server limit is exceeded.
 *
 * @param {Blob|File} file - The raw video file.
 * @param {number} [maxServerUploadSizeBytes=26214400] - Maximum file size permitted on the server.
 * @param {number} [givenDuration=0] - Pre-computed video duration in seconds.
 * @returns {Promise<{shouldCompress: boolean, estimatedSizeBytes: number, targetBitrate: number, useWebRTC: boolean}>} Evaluation results.
 */
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
    } catch {
      // Handled: Proceed with evaluation using default fallback duration logic
    }
  }

  const originalBitrate = (duration > 0) ? (file.size * 8) / duration : 5_000_000
  const targetVideoBitrate = Math.max(300_000, Math.min(Math.round(originalBitrate * 0.70), 1_500_000))
  const audioBitrate = 128_000

  const estimatedSizeBytes = Math.round(((targetVideoBitrate + audioBitrate) * duration) / 8) + 50_000
  const canFitOnServer = estimatedSizeBytes <= maxServerUploadSizeBytes

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

/**
 * Extracts metadata, tags, duration, and covers/thumbnails from a media file.
 *
 * @param {Blob|File} file - The media file (audio or video).
 * @param {Object} [options={}] - Options for metadata extraction.
 * @param {boolean} [options.skipThumbnail=false] - Whether to skip video frame thumbnail extraction.
 * @returns {Promise<{duration: number, metadata: {title: string, artist: string, album: string, genre: string, year: (number|null), track: (number|null)}, albumArt: (ArrayBuffer|null), albumArtMimeType: (string|null), thumbnail: (ImageBitmap|null)}>} Extracted metadata.
 */
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
    } catch {
      // Ignored: Default duration remains 0
    }
    try {
      tags = await input.getMetadataTags() || {}
    } catch {
      // Ignored: Default tags remains empty
    }
  } catch {
    // Ignored: Input initialization failed, proceed with empty metadata
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
      } catch {
        // Ignored: Canvas extraction failed, attempt FFmpeg fallback
      }
    }
    if (!thumbnail) {
      try {
        thumbnail = await extractThumbnailWithFFmpeg(file)
      } catch {
        // Ignored: Handled fallback failure gracefully
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
    } catch {
      // Ignored: Fallback when image extraction fails
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

/**
 * Compresses a video using WebCodecs with dynamic options.
 *
 * @param {Blob|File} file - The raw video file.
 * @param {Object} [options={}] - Compression parameters.
 * @param {number} [options.duration] - Pre-computed video duration in seconds.
 * @param {number} [options.bitrate] - Requested target bitrate.
 * @param {number} [options.maxWidth=1280] - Maximum video width.
 * @param {number} [options.maxHeight=720] - Maximum video height.
 * @param {string} [options.format='mp4'] - Desired output container ('mp4' or 'webm').
 * @param {string} [options.codec='vp9'] - Desired WebM video codec ('vp9', 'vp8', or 'av1').
 * @param {Function} [onProgress] - Callback invoked with the compression progress percentage.
 * @returns {Promise<{buffer: Uint8Array, mimeType: string, extension: string}>} Compiled video.
 * @throws {Error} If video container setup or transcoding fails.
 */
async function compressVideo (file, options = {}, onProgress) {
  const input = new Input({
    formats: SUPPORTED_FORMATS,
    source: new BlobSource(file)
  })

  let duration = options.duration || 0
  if (!duration || duration <= 0) {
    try {
      duration = await input.computeDuration()
    } catch {
      // Ignored: Falls back to default duration or zero
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

/**
 * Instantiates and loads the FFmpeg WASM library if not already active.
 *
 * @returns {Promise<Object>} Loaded FFmpeg instance.
 * @throws {Error} If FFmpeg fails to load.
 */
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

/**
 * Transcodes a video using FFmpeg WASM as a robust fallback.
 *
 * @param {Blob|File} file - The raw video file.
 * @param {Object} [_options={}] - Unused options placeholder.
 * @param {Function} [onProgress] - Callback for transcode updates, reporting progress percentage and status text.
 * @returns {Promise<{buffer: Uint8Array, mimeType: string, extension: string}>} Compiled video bytes and metadata.
 * @throws {Error} If transcoding fails or the FFmpeg command fails to complete.
 */
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

    const ret = await ffmpeg.exec(execArgs)

    if (ret !== 0) {
      throw new Error(`FFmpeg process exited with non-zero code (${ret})`)
    }

    const outputData = await ffmpeg.readFile(outputName)

    try {
      await ffmpeg.deleteFile(inputName)
      await ffmpeg.deleteFile(outputName)
    } catch {
      // Ignored: Cleanup files failed
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

/**
 * Extracts a representative frame image from a video file using FFmpeg WASM.
 *
 * @param {Blob|File} file - The video file.
 * @returns {Promise<ImageBitmap|null>} The generated thumbnail ImageBitmap, or null if extraction fails.
 */
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
    } catch {
      // Ignored: Cleanup files failed
    }

    const blob = new Blob([outputData], { type: 'image/jpeg' })
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}
