import test from 'node:test'
import assert from 'node:assert/strict'
import utilsPlugin from '../../src/plugins/utils-plugin.js'

test.describe('Audio Utilities - Waveform Generation Tests', () => {
  let contextFunc

  test.beforeEach(async () => {
    delete globalThis.window.AudioContext
    delete globalThis.window.webkitAudioContext

    const instanceContext = {
      pocketbase: { pb: {} },
      cryptoWorker: { $worker: {} },
      globalStore: { $state: { decryptionCache: new Map() } },
      storage: { $storage: {} },
      eventBus: {
        $bus: {
          on: () => {
          }
        }
      }
    }

    const pluginContext = await utilsPlugin.client.context()
    const instance = pluginContext(instanceContext)
    contextFunc = instance.$media.generateWaveform
  })

  test('1. Successful Execution: decodeAudioData resolves, audioContext.close() called & awaited, returns valid SVG data URI', async () => {
    let closed = false
    class MockAudioContext {
      constructor () {
        this.state = 'running'
      }

      async decodeAudioData (buffer) {
        assert.ok(buffer instanceof ArrayBuffer, 'Buffer passed to decodeAudioData should be an ArrayBuffer')
        return {
          getChannelData: (channel) => {
            assert.equal(channel, 0)
            const data = new Float32Array(1000)
            for (let i = 0; i < 1000; i++) {
              data[i] = Math.sin(i / 10)
            }
            return data
          }
        }
      }

      async close () {
        closed = true
        this.state = 'closed'
      }
    }

    globalThis.window.AudioContext = MockAudioContext

    const mockFile = {
      type: 'audio/mp3',
      name: 'test.mp3',
      size: 1024 * 100,
      arrayBuffer: async () => new ArrayBuffer(1024)
    }

    const waveform = await contextFunc(mockFile)

    assert.ok(closed, 'audioContext.close() should have been called and awaited')
    assert.ok(typeof waveform === 'string' && waveform.startsWith('data:image/svg+xml;utf8,'), 'Should return valid SVG data URI')
    assert.ok(decodeURIComponent(waveform).includes('<svg'), 'Waveform output should contain SVG markup after decoding')
  })

  test('2. Throwing Execution: decodeAudioData throws, audioContext.close() still executes via finally, byte-based pseudo-waveform fallback', async () => {
    let closed = false
    class MockAudioContext {
      constructor () {
        this.state = 'running'
      }

      async decodeAudioData () {
        throw new Error('Corrupt audio data stream')
      }

      async close () {
        closed = true
        this.state = 'closed'
      }
    }

    globalThis.window.AudioContext = MockAudioContext

    const sampleBytes = new Uint8Array(500)
    for (let i = 0; i < 500; i++) {
      sampleBytes[i] = (i * 17) % 256
    }

    const mockFile = {
      type: 'audio/wav',
      name: 'corrupt.wav',
      size: 500,
      arrayBuffer: async () => sampleBytes.buffer
    }

    const waveform = await contextFunc(mockFile)

    assert.ok(closed, 'audioContext.close() should be executed in finally even when decodeAudioData throws')
    assert.ok(typeof waveform === 'string' && waveform.startsWith('data:image/svg+xml;utf8,'), 'Should return fallback byte-based SVG waveform')
  })

  test('3. Missing AudioContext: Fallback byte-based pseudo-waveform executes when AudioContext is undefined', async () => {
    delete globalThis.window.AudioContext
    delete globalThis.window.webkitAudioContext

    const sampleBytes = new Uint8Array(200)
    for (let i = 0; i < 200; i++) {
      sampleBytes[i] = (i * 13) % 255
    }

    const mockFile = {
      type: 'audio/ogg',
      name: 'recording.ogg',
      size: 200,
      arrayBuffer: async () => sampleBytes.buffer
    }

    const waveform = await contextFunc(mockFile)

    assert.ok(typeof waveform === 'string' && waveform.startsWith('data:image/svg+xml;utf8,'), 'Should return fallback byte-based SVG waveform when AudioContext is undefined')
  })

  test('4. Legacy Prefix Support: Works with window.webkitAudioContext if window.AudioContext is absent', async () => {
    let closed = false
    class MockWebkitAudioContext {
      constructor () {
        this.state = 'running'
      }

      async decodeAudioData () {
        return {
          getChannelData: () => new Float32Array(500).fill(0.5)
        }
      }

      async close () {
        closed = true
        this.state = 'closed'
      }
    }

    delete globalThis.window.AudioContext
    globalThis.window.webkitAudioContext = MockWebkitAudioContext

    const mockFile = {
      type: 'audio/m4a',
      name: 'legacy.m4a',
      size: 1000,
      arrayBuffer: async () => new ArrayBuffer(1000)
    }

    const waveform = await contextFunc(mockFile)

    assert.ok(closed, 'webkitAudioContext.close() should be called and closed')
    assert.ok(typeof waveform === 'string' && waveform.startsWith('data:image/svg+xml;utf8,'), 'Should succeed using legacy webkitAudioContext')
  })

  test('5. Close Failure Resilience: If audioContext.close() throws or rejects, error is caught safely without breaking caller', async () => {
    class MockAudioContext {
      constructor () {
        this.state = 'running'
      }

      async decodeAudioData () {
        return {
          getChannelData: () => new Float32Array(500).fill(0.8)
        }
      }

      async close () {
        throw new Error('Hardware audio channel error on close')
      }
    }

    globalThis.window.AudioContext = MockAudioContext

    const mockFile = {
      type: 'audio/flac',
      name: 'sample.flac',
      size: 2000,
      arrayBuffer: async () => new ArrayBuffer(2000)
    }

    const waveform = await contextFunc(mockFile)

    assert.ok(typeof waveform === 'string' && waveform.startsWith('data:image/svg+xml;utf8,'), 'Should return generated waveform even if audioContext.close() throws')
  })

  test('6. Concurrent Multi-File Invocations: Verifies multiple concurrent calls close every allocated AudioContext', async () => {
    let activeContextCount = 0
    let totalAllocated = 0
    let totalClosed = 0

    class MockAudioContext {
      constructor () {
        this.state = 'running'
        activeContextCount++
        totalAllocated++
      }

      async decodeAudioData () {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return {
          getChannelData: () => new Float32Array(300).fill(0.3)
        }
      }

      async close () {
        activeContextCount--
        totalClosed++
        this.state = 'closed'
      }
    }

    globalThis.window.AudioContext = MockAudioContext

    const files = Array.from({ length: 15 }, (_, i) => ({
      type: 'audio/mp3',
      name: `voice_${i}.mp3`,
      size: 5000,
      arrayBuffer: async () => new ArrayBuffer(5000)
    }))

    const results = await Promise.all(files.map((file) => contextFunc(file)))

    assert.equal(results.length, 15)
    assert.equal(totalAllocated, 15, 'Should allocate exactly 15 AudioContext instances')
    assert.equal(totalClosed, 15, 'Should close all 15 allocated AudioContext instances')
    assert.equal(activeContextCount, 0, 'No active unclosed AudioContext instances should remain')
    results.forEach((wf) => {
      assert.ok(typeof wf === 'string' && wf.startsWith('data:image/svg+xml;utf8,'))
    })
  })

  test('7. Edge Cases: Non-audio mime/extension, null input, oversized (>20MB) inputs return null immediately without creating AudioContext', async () => {
    let created = false
    class MockAudioContext {
      constructor () {
        created = true
      }
    }
    globalThis.window.AudioContext = MockAudioContext

    // Null/undefined file
    const res1 = await contextFunc(null)
    assert.equal(res1, null, 'Null file input should return null')

    // Non-audio file
    const res2 = await contextFunc({
      type: 'image/png',
      name: 'image.png',
      size: 1000
    })
    assert.equal(res2, null, 'Non-audio file input should return null')

    // Oversized audio file (>20MB)
    const res3 = await contextFunc({
      type: 'audio/mp3',
      name: 'large.mp3',
      size: 21 * 1024 * 1024
    })
    assert.equal(res3, null, 'Oversized (>20MB) file input should return null')

    assert.equal(created, false, 'No AudioContext should be constructed for invalid / bypassed inputs')
  })
})
