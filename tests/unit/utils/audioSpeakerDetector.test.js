import test, { describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { createAudioSpeakerDetector } from '../../../src/utils/audioSpeakerDetector.js'

describe('createAudioSpeakerDetector utility tests', () => {
  let originalAudioContext
  let originalWebkitAudioContext

  beforeEach(() => {
    originalAudioContext = globalThis.window.AudioContext
    originalWebkitAudioContext = globalThis.window.webkitAudioContext
  })

  afterEach(() => {
    globalThis.window.AudioContext = originalAudioContext
    globalThis.window.webkitAudioContext = originalWebkitAudioContext
  })

  // Helper mock classes
  class MockAudioNode {
    constructor () {
      this.connectedTo = null
    }
    connect (destination) {
      this.connectedTo = destination
    }
    disconnect () {
      this.connectedTo = null
    }
  }

  class MockAudioContext {
    constructor () {
      this.state = 'suspended'
    }
    createMediaStreamSource (stream) {
      return new MockAudioNode()
    }
    createAnalyser () {
      const node = new MockAudioNode()
      node.fftSize = 512
      node.smoothingTimeConstant = 0.4
      node.getFloatTimeDomainData = (array) => {
        if (MockAudioContext.pcmDataMockValues) {
          array.set(MockAudioContext.pcmDataMockValues)
        } else {
          array.fill(0)
        }
      }
      return node
    }
    async resume () {
      this.state = 'running'
    }
    async close () {
      this.state = 'closed'
    }
  }

  MockAudioContext.pcmDataMockValues = null

  test('should return null when initialized without window support or invalid stream', () => {
    const detector = createAudioSpeakerDetector()
    // Invalid stream (no tracks)
    const streamId = detector.attachStream(null)
    assert.strictEqual(streamId, null)

    const emptyStream = {
      getAudioTracks: () => []
    }
    const streamIdEmpty = detector.attachStream(emptyStream)
    assert.strictEqual(streamIdEmpty, null)
  })

  test('should create AudioContext and attach stream correctly', async () => {
    globalThis.window.AudioContext = MockAudioContext

    let callbackCalled = false
    let lastSpeakingState = false

    const detector = createAudioSpeakerDetector({
      threshold: 0.01,
      hangoverMs: 50,
      onSpeakingChange: (event) => {
        callbackCalled = true
        lastSpeakingState = event.isSpeaking
      }
    })

    const mockTrack = {
      enabled: true,
      readyState: 'live'
    }
    const mockStream = {
      id: 'test-stream-id',
      getAudioTracks: () => [mockTrack]
    }

    // Set pcm data mock values above threshold (rms should be above 0.01)
    const highPcm = new Float32Array(512).fill(0.1)
    MockAudioContext.pcmDataMockValues = highPcm

    const streamId = detector.attachStream(mockStream, 'local-user')
    assert.strictEqual(streamId, 'test-stream-id')

    // Wait a brief moment to allow requestAnimationFrame/setTimeout ticks to occur
    await new Promise(resolve => setTimeout(resolve, 30))

    assert.strictEqual(callbackCalled, true)
    assert.strictEqual(lastSpeakingState, true)

    // Now make silent (pcm = 0)
    MockAudioContext.pcmDataMockValues = new Float32Array(512).fill(0)

    // Wait longer than hangoverMs (50ms)
    await new Promise(resolve => setTimeout(resolve, 100))

    assert.strictEqual(lastSpeakingState, false)

    detector.destroy()
  })

  test('should re-throw unexpected exceptions while attaching and detaching streams', () => {
    globalThis.window.AudioContext = class BrokenAudioContext {
      constructor () {
        this.state = 'running'
      }
      createMediaStreamSource () {
        // Throw a TypeError - which is NOT an expected Web Audio exception
        throw new TypeError('Unexpected browser TypeError')
      }
    }

    const detector = createAudioSpeakerDetector()
    const mockTrack = {
      enabled: true,
      readyState: 'live'
    }
    const mockStream = {
      id: 'broken-stream',
      getAudioTracks: () => [mockTrack]
    }

    assert.throws(() => {
      detector.attachStream(mockStream)
    }, TypeError)
  })

  test('should catch and handle expected audio exceptions gracefully (not throw)', () => {
    globalThis.window.AudioContext = class ExpectedBrokenAudioContext {
      constructor () {
        this.state = 'running'
      }
      createMediaStreamSource () {
        // Throw a DOMException with InvalidStateError name (expected Web Audio error)
        throw new DOMException('Cannot create media source', 'InvalidStateError')
      }
    }

    const detector = createAudioSpeakerDetector()
    const mockTrack = {
      enabled: true,
      readyState: 'live'
    }
    const mockStream = {
      id: 'expected-broken-stream',
      getAudioTracks: () => [mockTrack]
    }

    // Should return null and not throw
    const streamId = detector.attachStream(mockStream)
    assert.strictEqual(streamId, null)
  })

  test('should handle expected exceptions on source disconnect during detachStream', () => {
    globalThis.window.AudioContext = class DisconnectBrokenAudioContext {
      constructor () {
        this.state = 'running'
      }
      createMediaStreamSource () {
        return {
          connect () {
          },
          disconnect () {
            throw new DOMException('AudioNode is not connected', 'InvalidAccessError')
          }
        }
      }
      createAnalyser () {
        return {
          fftSize: 512,
          smoothingTimeConstant: 0.4,
          connect () {
          },
          getFloatTimeDomainData () {
          }
        }
      }
    }

    const detector = createAudioSpeakerDetector()
    const mockTrack = {
      enabled: true,
      readyState: 'live'
    }
    const mockStream = {
      id: 'disconnect-broken-stream',
      getAudioTracks: () => [mockTrack]
    }

    const streamId = detector.attachStream(mockStream)
    assert.strictEqual(streamId, 'disconnect-broken-stream')

    // Should handle the InvalidAccessError gracefully and not throw
    assert.doesNotThrow(() => {
      detector.detachStream(streamId)
    })
  })

  test('should re-throw unexpected exceptions on source disconnect during detachStream', () => {
    globalThis.window.AudioContext = class DisconnectTypeErrorAudioContext {
      constructor () {
        this.state = 'running'
      }
      createMediaStreamSource () {
        return {
          connect () {
          },
          disconnect () {
            throw new TypeError('Unexpected disconnected type error')
          }
        }
      }
      createAnalyser () {
        return {
          fftSize: 512,
          smoothingTimeConstant: 0.4,
          connect () {
          },
          getFloatTimeDomainData () {
          }
        }
      }
    }

    const detector = createAudioSpeakerDetector()
    const mockTrack = {
      enabled: true,
      readyState: 'live'
    }
    const mockStream = {
      id: 'disconnect-type-error-stream',
      getAudioTracks: () => [mockTrack]
    }

    const streamId = detector.attachStream(mockStream)
    assert.strictEqual(streamId, 'disconnect-type-error-stream')

    // Should re-throw TypeError
    assert.throws(() => {
      detector.detachStream(streamId)
    }, TypeError)
  })
})
