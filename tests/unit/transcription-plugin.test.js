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
        this.messages.push({ msg, transferables })
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

      addEventListener (type, cb) {}
    }

    // Mock AudioContext and OfflineAudioContext
    const mockAudioBuffer = {
      duration: 1.0,
      getChannelData: () => new Float32Array(16000)
    }

    class MockAudioContext {
      async decodeAudioData () {
        return mockAudioBuffer
      }

      async close () {}
    }

    class MockOfflineAudioContext {
      constructor () {
        this.destination = {}
      }

      createBufferSource () {
        return {
          connect () {},
          start () {}
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

    const contextFn = transcriptionPlugin.client.context({
      $bus: {
        emit: () => {}
      }
    })

    const mockStorage = {
      updateMessage: async (localUuid, changes) => {
        assert.equal(localUuid, 'test-uuid')
        assert.equal(changes.transcript, 'Hello, this is simulated text.')
        return 1
      }
    }

    const { $transcription } = contextFn({
      storage: { $storage: mockStorage },
      globalStore: { $state: { transcriptionModel: 'onnx-community/whisper-tiny' } }
    })

    assert.ok($transcription)
    assert.equal(typeof $transcription.transcribe, 'function')

    const mockBlob = {
      arrayBuffer: async () => new ArrayBuffer(100)
    }

    const text = await $transcription.transcribe(mockBlob, 'test-uuid')
    assert.equal(text, 'Hello, this is simulated text.')

    // Restore original globals
    window.Worker = origWorker
    globalThis.Worker = origGlobalWorker
    window.AudioContext = origAudioContext
    window.OfflineAudioContext = origOfflineAudioContext
  })
})
