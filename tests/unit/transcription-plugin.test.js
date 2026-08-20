import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import transcriptionPlugin from '../../src/plugins/transcription-plugin.js'

describe('Transcription Plugin Tests', () => {
  test('should initialize context and export $transcription service', async () => {
    // Save original globals
    const origWorker = window.Worker
    const origAudioContext = window.AudioContext
    const origOfflineAudioContext = window.OfflineAudioContext
    const origGlobalWorker = globalThis.Worker

    // Mock the transcription worker class
    class MockWorker {
      constructor (url, options) {
        this.url = url
        this.options = options
        this.messages = []
      }

      postMessage (msg, transferables) {
        this.messages.push({
          msg,
          transferables
        })
        // Simulate a successful transcription response on message send
        if (msg.type === 'transcribe') {
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: {
                  id: msg.id,
                  type: 'transcribe:success',
                  payload: { text: 'Hello, this is simulated text.' }
                }
              })
            }
          }, 10)
        }
      }

      addEventListener (type, cb) {
      }
    }

    // Helper to generate synthetic PCM sine wave buffer
    const generateSyntheticPcm = (sampleRate = 16000, durationSec = 1.0, frequencyHz = 440, amplitude = 0.5) => {
      const length = Math.round(sampleRate * durationSec)
      const pcm = new Float32Array(length)
      for (let i = 0; i < length; i++) {
        pcm[i] = amplitude * Math.sin(2 * Math.PI * frequencyHz * (i / sampleRate))
      }
      return pcm
    }

    // Mock AudioContext and OfflineAudioContext
    const mockAudioBuffer = {
      duration: 1.0,
      numberOfChannels: 1,
      sampleRate: 16000,
      getChannelData: () => generateSyntheticPcm(16000, 1.0, 440, 0.5)
    }

    class MockAudioContext {
      async decodeAudioData () {
        return mockAudioBuffer
      }

      async close () {
      }
    }

    class MockOfflineAudioContext {
      constructor () {
        this.destination = {}
      }

      createBufferSource () {
        return {
          connect () {
          },
          start () {
          }
        }
      }

      async startRendering () {
        return mockAudioBuffer
      }
    }

    window.Worker = MockWorker
    globalThis.Worker = MockWorker
    window.AudioContext = MockAudioContext
    window.OfflineAudioContext = MockOfflineAudioContext

    const busEmits = []
    const contextFn = transcriptionPlugin.client.context({
      $bus: {
        emit: (event, payload) => {
          busEmits.push({
            event,
            payload
          })
        }
      }
    })

    const mockStorage = {
      updateMessage: async (localUuid, changes) => {
        assert.equal(localUuid, 'test-uuid')
        assert.equal(changes.transcript, 'Hello, this is simulated text.')
        return 1
      }
    }

    const instanceServices = contextFn({
      storage: { $storage: mockStorage },
      globalStore: { $state: { transcriptionModel: 'onnx-community/moonshine-tiny-ONNX' } }
    })
    const { $transcription } = instanceServices

    assert.ok($transcription)
    assert.equal(typeof $transcription.transcribe, 'function')

    const mockBlob = {
      size: 200,
      arrayBuffer: async () => new ArrayBuffer(200)
    }

    const text = await $transcription.transcribe(mockBlob, 'test-uuid')
    assert.equal(text, 'Hello, this is simulated text.')

    // Verify diagnostic metrics in state_change bus emits
    const doneEmit = busEmits.find(e => e.event === 'transcription:state_change' && e.payload.state === 'done')
    assert.ok(doneEmit)
    assert.equal(doneEmit.payload.text, 'Hello, this is simulated text.')
    assert.ok(doneEmit.payload.metrics)
    assert.ok(doneEmit.payload.metrics.peak > 0.4)
    assert.ok(doneEmit.payload.metrics.rms > 0.3)
    assert.equal(doneEmit.payload.metrics.isSilent, false)

    // Restore original globals
    window.Worker = origWorker
    globalThis.Worker = origGlobalWorker
    window.AudioContext = origAudioContext
    window.OfflineAudioContext = origOfflineAudioContext
  })

  test('should handle digital silence short-circuiting and zero-length buffer error', async () => {
    const origWorker = window.Worker
    const origAudioContext = window.AudioContext
    const origOfflineAudioContext = window.OfflineAudioContext
    const origGlobalWorker = globalThis.Worker

    let workerCalled = false
    class MockWorker {
      postMessage () {
        workerCalled = true
      }
    }

    window.Worker = MockWorker
    globalThis.Worker = MockWorker

    // 1. Digital silence test (all zeros)
    let currentMockPcm = new Float32Array(16000)
    class MockAudioContext {
      async decodeAudioData () {
        return {
          duration: 1.0,
          numberOfChannels: 1,
          sampleRate: 16000,
          getChannelData: () => currentMockPcm
        }
      }

      async close () {
      }
    }

    class MockOfflineAudioContext {
      constructor () {
        this.destination = {}
      }
      createBufferSource () {
        return {
          connect () {
          },
          start () {
          }
        }
      }
      async startRendering () {
        return { getChannelData: () => currentMockPcm }
      }
    }

    window.AudioContext = MockAudioContext
    window.OfflineAudioContext = MockOfflineAudioContext

    const busEmits = []
    const contextFn = transcriptionPlugin.client.context({
      $bus: {
        emit: (event, payload) => {
          busEmits.push({
            event,
            payload
          })
        }
      }
    })

    const { $transcription } = contextFn({
      storage: { $storage: null },
      globalStore: { $state: {} }
    })

    const silentBlob = {
      size: 100,
      arrayBuffer: async () => new ArrayBuffer(100)
    }
    const result = await $transcription.transcribe(silentBlob, 'silent-uuid')

    assert.equal(result, '(No speech detected)')
    assert.equal(workerCalled, false) // Short-circuited without posting to worker

    const silentStateEmit = busEmits.find(e => e.event === 'transcription:state_change' && e.payload.state === 'done')
    assert.ok(silentStateEmit)
    assert.equal(silentStateEmit.payload.metrics.isSilent, true)
    assert.equal(silentStateEmit.payload.metrics.peak, 0)

    // 2. Empty resampled PCM buffer error test
    currentMockPcm = new Float32Array(0)
    const emptyBlob = {
      size: 0,
      arrayBuffer: async () => new ArrayBuffer(0)
    }

    await assert.rejects(
      async () => {
        await $transcription.transcribe(emptyBlob, 'empty-uuid')
      },
      (err) => {
        assert.match(err.message, /Resampled audio buffer is empty/)
        return true
      }
    )

    // Restore globals
    window.Worker = origWorker
    globalThis.Worker = origGlobalWorker
    window.AudioContext = origAudioContext
    window.OfflineAudioContext = origOfflineAudioContext
  })

  test('should pass configured transcriptionModel to worker payload', async () => {
    const origWorker = window.Worker
    const origAudioContext = window.AudioContext
    const origOfflineAudioContext = window.OfflineAudioContext
    const origGlobalWorker = globalThis.Worker

    let postedMessagePayload = null
    class MockWorker {
      postMessage (msg) {
        postedMessagePayload = msg.payload
        if (msg.type === 'transcribe' && this.onmessage) {
          setTimeout(() => {
            this.onmessage({
              data: {
                id: msg.id,
                type: 'transcribe:success',
                payload: { text: 'Transcribed with custom model' }
              }
            })
          }, 5)
        }
      }
    }

    class MockAudioContext {
      async decodeAudioData () {
        return {
          duration: 1.0,
          numberOfChannels: 1,
          sampleRate: 16000,
          getChannelData: () => new Float32Array([0.1, 0.2, 0.3])
        }
      }
      async close () {
      }
    }

    class MockOfflineAudioContext {
      constructor () {
        this.destination = {}
      }
      createBufferSource () {
        return {
          connect () {
          },
          start () {
          }
        }
      }
      async startRendering () {
        return { getChannelData: () => new Float32Array([0.1, 0.2, 0.3]) }
      }
    }

    window.Worker = MockWorker
    globalThis.Worker = MockWorker
    window.AudioContext = MockAudioContext
    window.OfflineAudioContext = MockOfflineAudioContext

    const contextFn = transcriptionPlugin.client.context({
      $bus: {
        emit: () => {
        }
      }
    })
    const { $transcription } = contextFn({
      storage: { $storage: null },
      globalStore: { $state: { transcriptionModel: 'onnx-community/whisper-tiny.en' } }
    })

    const audioBlob = {
      size: 100,
      arrayBuffer: async () => new ArrayBuffer(100)
    }
    const res = await $transcription.transcribe(audioBlob, 'model-test-uuid')

    assert.equal(res, 'Transcribed with custom model')
    assert.equal(postedMessagePayload.modelName, 'onnx-community/whisper-tiny.en')

    // Restore globals
    window.Worker = origWorker
    globalThis.Worker = origGlobalWorker
    window.AudioContext = origAudioContext
    window.OfflineAudioContext = origOfflineAudioContext
  })
})
