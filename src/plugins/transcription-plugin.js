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
              pluginContext.$bus.emit('transcription:progress', payload)
            }
            return
          }

          if (id && pendingRequests.has(id)) {
            const { resolve, reject } = pendingRequests.get(id)
            pendingRequests.delete(id)

            if (error) {
              reject(new Error(error))
            } else {
              resolve(payload.text)
            }
          }
        }

        worker.onerror = (e) => {
          console.error('[transcription-plugin] Worker error:', e.message || e, e.filename, e.lineno)
          for (const [id, { reject }] of pendingRequests) {
            reject(new Error(`Transcription worker crashed: ${e.message || e}`))
            pendingRequests.delete(id)
          }
        }

        return worker
      }

      /**
       * Decodes and resamples an audio Blob to a 16,000 Hz mono Float32Array PCM buffer.
       *
       * @param {Blob} audioBlob - The source audio file/blob.
       * @returns {Promise<Float32Array>} The resampled PCM audio buffer.
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
        return renderedBuffer.getChannelData(0)
      }

      const $transcription = {
        /**
         * Low-level method to transcribe an audio Blob with optional custom model specification.
         *
         * @param {Blob} audioBlob - The PCM or container audio blob to transcribe.
         * @param {string} localUuid - Local unique identifier of the message.
         * @param {string|null} [modelName=null] - Optional name of the Hugging Face Whisper model.
         * @returns {Promise<string>} The transcribed text content.
         */
        transcribe: async (audioBlob, localUuid, modelName = null) => {
          const w = initWorker()
          const pcmData = await resampleAudioTo16kHz(audioBlob)

          return new Promise((resolve, reject) => {
            const id = crypto.randomUUID()
            pendingRequests.set(id, {
              resolve,
              reject
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
          if (pluginContext.$bus) {
            pluginContext.$bus.emit('transcription:state_change', {
              localUuid,
              state: 'transcribing'
            })
          }
          try {
            const text = await $transcription.transcribe(audioBlob, localUuid, modelName)
            if ($storage) {
              await $storage.updateMessage(localUuid, {
                transcript: text,
                transcribed_at: new Date().toISOString()
              })
            }
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('transcription:state_change', {
                localUuid,
                state: 'done',
                text
              })
            }
            return text
          } catch (err) {
            if (pluginContext.$bus) {
              pluginContext.$bus.emit('transcription:state_change', {
                localUuid,
                state: 'error',
                error: err.message
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
