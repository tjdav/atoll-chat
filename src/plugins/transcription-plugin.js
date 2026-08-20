import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { definePlugin } from 'coralite'

/**
 * Transcription Plugin for Atoll Chat
 * Manages background Speech-to-Text operations using Useful Sensors' Moonshine model
 * via a dedicated Web Worker running @huggingface/transformers.
 */
export default definePlugin({
  name: 'transcription',
  server: {
    /**
     * Copies the background transcription worker asset to the build directory.
     *
     * @param {Object} context - The server plugin hook context.
     * @returns {Promise<void>}
     */
    onAfterBuild: async ({ app }) => {
      const projectRoot = process.cwd()
      const outputDir = app.options.output

      if (!outputDir) {
        return
      }

      try {
        const srcPath = join(projectRoot, 'src', 'assets', 'transcription-worker.js')
        const content = await readFile(srcPath, 'utf-8')
        await app.writeFile('transcription-worker.js', content)
      } catch (err) {
        throw err
      }
    }
  },
  client: {
    context: (pluginContext) => {
      let worker = null
      const pendingRequests = new Map()

      /**
       * Initializes the background transcription Web Worker.
       *
       * @returns {Worker} The active worker instance.
       */
      const initWorker = () => {
        if (worker) {
          return worker
        }
        worker = new Worker('/transcription-worker.js', { type: 'module' })

        worker.onmessage = (event) => {
          const { id, type, payload, error } = event.data

          if (type === 'transcription:progress') {
            if (pluginContext.$bus) {
              const activeMetrics = pendingRequests.size > 0
                ? pendingRequests.values().next().value?.metrics
                : null
              pluginContext.$bus.emit('transcription:progress', {
                ...payload,
                ...(activeMetrics ? { metrics: activeMetrics } : {})
              })
            }
            return
          }

          if (id && pendingRequests.has(id)) {
            const { resolve, reject, metrics } = pendingRequests.get(id)
            pendingRequests.delete(id)

            if (error) {
              const err = new Error(error)
              err.metrics = metrics
              reject(err)
            } else {
              resolve({
                text: payload.text,
                metrics
              })
            }
          }
        }

        worker.onerror = (e) => {
          const detail = e.message || e.error?.message || (typeof e === 'string' ? e : 'Unknown worker error')
          console.error('[transcription-plugin] Worker error:', detail, e.filename, e.lineno)
          for (const [id, { reject, metrics }] of pendingRequests) {
            const err = new Error(`Transcription worker crashed: ${detail}`)
            err.metrics = metrics
            reject(err)
            pendingRequests.delete(id)
          }
        }

        return worker
      }

      /**
       * Decodes and resamples an audio Blob to a 16,000 Hz mono Float32Array PCM buffer.
       * Calculates diagnostic amplitude metrics (peak, RMS) and validates non-zero buffer output.
       *
       * @param {Blob} audioBlob - The source audio file/blob.
       * @returns {Promise<{pcmData: Float32Array, metrics: Object}>} Resampled PCM audio buffer and diagnostic metrics.
       */
      const resampleAudioTo16kHz = async (audioBlob) => {
        const arrayBuffer = await audioBlob.arrayBuffer()
        const AudioContextClass = window.AudioContext || window.webkitAudioContext
        if (!AudioContextClass) {
          throw new Error('AudioContext is not supported in this environment')
        }

        const audioCtx = new AudioContextClass()
        let audioBuffer
        try {
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
        } finally {
          await audioCtx.close()
        }

        const targetSampleRate = 16000
        const numberOfChannels = 1

        const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext
        if (!OfflineAudioContextClass) {
          throw new Error('OfflineAudioContext is not supported in this environment')
        }

        const offlineCtx = new OfflineAudioContextClass(
          numberOfChannels,
          Math.round(audioBuffer.duration * targetSampleRate),
          targetSampleRate
        )

        const bufferSource = offlineCtx.createBufferSource()
        bufferSource.buffer = audioBuffer
        bufferSource.connect(offlineCtx.destination)
        bufferSource.start()

        const renderedBuffer = await offlineCtx.startRendering()
        const pcmData = renderedBuffer.getChannelData(0)

        if (!pcmData || pcmData.length === 0) {
          throw new Error('Resampled audio buffer is empty')
        }

        let maxAbsPeak = 0
        let sumSquares = 0
        for (let i = 0; i < pcmData.length; i++) {
          const absVal = Math.abs(pcmData[i])
          if (absVal > maxAbsPeak) {
            maxAbsPeak = absVal
          }
          sumSquares += pcmData[i] * pcmData[i]
        }

        const calculatedRms = Math.sqrt(sumSquares / pcmData.length)

        const metrics = {
          blobSize: audioBlob.size || 0,
          byteLength: arrayBuffer.byteLength || 0,
          duration: audioBuffer.duration || 0,
          channels: audioBuffer.numberOfChannels || 1,
          sampleRate: audioBuffer.sampleRate || targetSampleRate,
          peak: maxAbsPeak,
          rms: calculatedRms,
          isSilent: maxAbsPeak < 0.0001
        }

        console.log('[transcription-plugin] Resampled audio diagnostics:', metrics)

        return {
          pcmData,
          metrics
        }
      }

      const $transcription = {
        /**
         * Low-level method to transcribe an audio Blob with optional custom model specification.
         *
         * @param {Blob} audioBlob - The PCM or container audio blob to transcribe.
         * @param {string} localUuid - Local unique identifier of the message.
         * @param {string|null} [modelName=null] - Optional name of the Hugging Face Whisper model.
         * @returns {Promise<{text: string, metrics: Object}>} The transcribed result and diagnostic metrics.
         */
        transcribe: async (audioBlob, localUuid, modelName = null) => {
          const w = initWorker()
          const { pcmData, metrics } = await resampleAudioTo16kHz(audioBlob)

          if (metrics.isSilent) {
            console.warn('[transcription-plugin] Digital silence detected (peak < 0.0001):', metrics)
            return {
              text: '(No speech detected)',
              metrics
            }
          }

          return new Promise((resolve, reject) => {
            const id = crypto.randomUUID()
            pendingRequests.set(id, {
              resolve,
              reject,
              metrics,
              localUuid
            })

            const model = modelName || (pluginContext.$state?.transcriptionModel || 'onnx-community/moonshine-tiny-ONNX')

            w.postMessage({
              id,
              type: 'transcribe',
              payload: {
                pcmData,
                modelName: model
              }
            }, [pcmData.buffer])
          })
        }
      }

      return (instanceContext) => {
        const { $storage } = instanceContext.storage || {}
        const { $state } = instanceContext.globalStore || {}

        pluginContext.$state = $state

        /**
         * Orchestrated speech-to-text pipeline that resamples audio, posts it to the worker,
         * broadcasts updates across the application lifecycle, and persists results to local database.
         *
         * @param {Blob} audioBlob - The source audio file blob.
         * @param {string} localUuid - Local message UUID associated with the transcription.
         * @param {string|null} [modelName=null] - Whisper model override.
         * @returns {Promise<string>} Resolves to the final transcribed string.
         * @throws {Error} Propagates any internal transcoding, worker, or storage failure.
         */
        const transcribeAndSave = async (audioBlob, localUuid, modelName = null) => {
          let activeMetrics = null
          if (pluginContext.$bus) {
            pluginContext.$bus.emit('transcription:state_change', {
              localUuid,
              state: 'transcribing'
            })
          }
          try {
            const result = await $transcription.transcribe(audioBlob, localUuid, modelName)
            const text = typeof result === 'object' && result !== null ? result.text : result
            activeMetrics = typeof result === 'object' && result !== null ? result.metrics : null

            if ($storage && text) {
              await $storage.updateMessage(localUuid, {
                transcript: text,
                transcribed_at: new Date().toISOString()
              })
            }
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('transcription:state_change', {
                localUuid,
                state: 'done',
                text,
                metrics: activeMetrics
              })
            }
            return text
          } catch (err) {
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('transcription:state_change', {
                localUuid,
                state: 'error',
                error: err.message,
                metrics: err.metrics || activeMetrics
              })
            }
            throw err
          }
        }

        return {
          $transcription: {
            ...$transcription,
            transcribe: transcribeAndSave
          }
        }
      }
    }
  }
})
