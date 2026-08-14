/**
 * @file Background Web Worker for client-side local voice message transcription
 * using Useful Sensors' Moonshine model via @huggingface/transformers.
 */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3'

// Disable local model loading to fetch from Hugging Face Hub and cache weights in IndexedDB/Cache Storage
env.allowLocalModels = false

/**
 * The cached Hugging Face pipeline instance.
 * @type {any|null}
 */
let pipelineInstance = null

/**
 * Timer to automatically clean up the pipeline instance.
 * @type {any|null}
 */
let idleTimer = null

/**
 * Clear the idle cleanup timer if active.
 */
function clearIdleTimer () {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

/**
 * Start/reset the 5-minute idle cleanup timer.
 * Automatically releases the pipeline instance and frees RAM after 5 minutes of inactivity.
 */
function startIdleTimer () {
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    pipelineInstance = null
  }, 5 * 60 * 1000)
}

/**
 * Retrieves or instantiates the pipeline for automatic-speech-recognition.
 *
 * @param {string} modelName - The model identifier.
 * @returns {Promise<any>} The instantiated pipeline.
 */
async function getPipeline (modelName) {
  if (pipelineInstance) {
    return pipelineInstance
  }

  pipelineInstance = await pipeline('automatic-speech-recognition', modelName, {
    progress_callback: (data) => {
      self.postMessage({
        type: 'transcription:progress',
        payload: data
      })
    }
  })

  return pipelineInstance
}

self.addEventListener('message', async (event) => {
  const { id, type, payload } = event.data

  if (type === 'transcribe') {
    clearIdleTimer()

    try {
      const { pcmData, modelName } = payload
      if (!pcmData) {
        throw new Error('No PCM audio data provided')
      }

      const activeModel = modelName || 'onnx-community/moonshine-tiny-ONNX'
      const transcriber = await getPipeline(activeModel)
      const isMoonshine = activeModel.includes('moonshine')
      const options = isMoonshine ? {} : {
        chunk_length_s: 30,
        stride_length_s: 5
      }

      const result = await transcriber(pcmData, options)

      let text = ''
      if (result && typeof result === 'object') {
        if (typeof result.text === 'string') {
          text = result.text
        } else if (Array.isArray(result) && result[0] && typeof result[0].text === 'string') {
          text = result[0].text
        }
      }

      self.postMessage({
        id,
        type: 'transcribe:success',
        payload: { text }
      })
    } catch (err) {
      self.postMessage({
        id,
        type: 'transcribe:error',
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      startIdleTimer()
    }
  }
})
