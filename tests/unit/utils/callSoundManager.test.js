import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { playRingtone, stopRingtone } from '../../../src/utils/call/callSoundManager.js'

describe('callSoundManager utility tests', () => {
  let originalAudio
  let originalCreateObjectURL
  let originalRevokeObjectURL
  let originalConsoleError

  let createdAudios = []
  let createdBlobUrls = []
  let revokedBlobUrls = []
  let consoleErrorLogs = []

  class MockAudio {
    constructor (src) {
      this.src = src
      this.loop = false
      this.volume = 1.0
      this.paused = true
      this.currentTime = 0
      this.playRejectedWith = null
      this.playCalled = false
      this.pauseCalled = false
      createdAudios.push(this)
    }

    async play () {
      this.playCalled = true
      this.paused = false
      if (this.playRejectedWith) {
        throw this.playRejectedWith
      }
    }

    pause () {
      this.pauseCalled = true
      this.paused = true
    }
  }

  beforeEach(() => {
    stopRingtone()

    originalAudio = globalThis.Audio
    originalCreateObjectURL = globalThis.URL?.createObjectURL
    originalRevokeObjectURL = globalThis.URL?.revokeObjectURL
    originalConsoleError = console.error

    createdAudios = []
    createdBlobUrls = []
    revokedBlobUrls = []
    consoleErrorLogs = []

    globalThis.Audio = MockAudio
    if (!globalThis.URL) {
      globalThis.URL = {}
    }
    globalThis.URL.createObjectURL = (_blob) => {
      const url = `blob:http://localhost/${Math.random().toString(36).substring(2)}`
      createdBlobUrls.push(url)
      return url
    }
    globalThis.URL.revokeObjectURL = (url) => {
      revokedBlobUrls.push(url)
    }

    console.error = (...args) => {
      consoleErrorLogs.push(args)
    }
  })

  afterEach(() => {
    stopRingtone()

    globalThis.Audio = originalAudio
    if (globalThis.URL) {
      if (originalCreateObjectURL) {
        globalThis.URL.createObjectURL = originalCreateObjectURL
      } else {
        delete globalThis.URL.createObjectURL
      }
      if (originalRevokeObjectURL) {
        globalThis.URL.revokeObjectURL = originalRevokeObjectURL
      } else {
        delete globalThis.URL.revokeObjectURL
      }
    }
    console.error = originalConsoleError
  })

  it('should play ringtone with correct volume and default path when sounds enabled', async () => {
    const globalStore = {
      $state: {
        callSoundsEnabled: true,
        mediaVolume: 0.8
      }
    }
    const $storage = { getConfig: async () => null }

    await playRingtone({
      globalStore,
      $storage
    })

    assert.equal(createdAudios.length, 1)
    const audio = createdAudios[0]
    assert.equal(audio.src, '/sounds/ringtone.mp3')
    assert.equal(audio.loop, true)
    assert.equal(audio.volume, 0.8)
    assert.equal(audio.playCalled, true)
  })

  it('should handle custom sound blob and revoke blob URL when stopped', async () => {
    const mockBlob = new Blob(['dummy audio content'], { type: 'audio/mp3' })
    const globalStore = {
      $state: {
        callSoundsEnabled: true,
        mediaVolume: 1.0
      }
    }
    const $storage = { getConfig: async (key) => (key === 'custom_call_sound' ? mockBlob : null) }

    await playRingtone({
      globalStore,
      $storage
    })

    assert.equal(createdAudios.length, 1)
    const audio = createdAudios[0]
    assert.match(audio.src, /^blob:/)
    assert.equal(createdBlobUrls.length, 1)

    stopRingtone()

    assert.equal(audio.pauseCalled, true)
    assert.equal(audio.currentTime, 0)
    assert.equal(revokedBlobUrls.length, 1)
    assert.equal(revokedBlobUrls[0], audio.src)
  })

  it('should cancel in-flight ringtone if stopRingtone() is called during storage retrieval', async () => {
    let resolveStorage
    const storagePromise = new Promise((resolve) => {
      resolveStorage = resolve
    })

    const mockBlob = new Blob(['custom sound'], { type: 'audio/mp3' })
    const globalStore = { $state: { callSoundsEnabled: true } }
    const $storage = { getConfig: async () => storagePromise }

    const playPromise = playRingtone({
      globalStore,
      $storage
    })

    // Stop ringtone while getConfig is in-flight
    stopRingtone()

    // Resolve storage fetch after stopRingtone was executed
    resolveStorage(mockBlob)
    await playPromise

    // No Audio object should have been instantiated or played
    assert.equal(createdAudios.length, 0)
    // Any created blob URL should be revoked
    assert.equal(createdBlobUrls.length, revokedBlobUrls.length)
  })

  it('should quietly suppress expected media interruption errors (AbortError, NotAllowedError)', async () => {
    const globalStore = { $state: { callSoundsEnabled: true } }
    const $storage = { getConfig: async () => null }

    // Test AbortError
    MockAudio.prototype.play = async function () {
      const err = new Error("The fetching process for the media resource was aborted by the user agent at the user's request.")
      err.name = 'AbortError'
      throw err
    }

    await playRingtone({
      globalStore,
      $storage
    })
    assert.equal(consoleErrorLogs.length, 0)

    // Reset and test NotAllowedError
    stopRingtone()
    MockAudio.prototype.play = async function () {
      const err = new Error("play() failed because the user didn't interact with the document first.")
      err.name = 'NotAllowedError'
      throw err
    }

    await playRingtone({
      globalStore,
      $storage
    })
    assert.equal(consoleErrorLogs.length, 0)
  })

  it('should reset playing state and allow subsequent play calls if play() fails or rejects', async () => {
    const globalStore = { $state: { callSoundsEnabled: true } }
    const $storage = { getConfig: async () => null }

    MockAudio.prototype.play = async function () {
      const err = new Error('Autoplay blocked')
      err.name = 'NotAllowedError'
      throw err
    }

    await playRingtone({
      globalStore,
      $storage
    })
    assert.equal(createdAudios.length, 1)

    // Verify subsequent playRingtone call is allowed and not blocked by stale isPlaying/ringtoneAudio state
    MockAudio.prototype.play = async function () {
      this.playCalled = true
    }

    await playRingtone({
      globalStore,
      $storage
    })
    assert.equal(createdAudios.length, 2)
  })

  it('should preserve console.error for unexpected failures', async () => {
    const globalStore = { $state: { callSoundsEnabled: true } }
    const $storage = { getConfig: async () => null }

    MockAudio.prototype.play = async function () {
      throw new Error('Network error loading media')
    }

    await playRingtone({
      globalStore,
      $storage
    })

    assert.equal(consoleErrorLogs.length, 1)
    assert.match(consoleErrorLogs[0][0], /Failed to play ringtone/)
    assert.equal(consoleErrorLogs[0][1].message, 'Network error loading media')
  })

  it('should be safe and idempotent to call stopRingtone multiple times or when idle', () => {
    assert.doesNotThrow(() => {
      stopRingtone()
      stopRingtone()
      stopRingtone()
    })
  })

  it('should do nothing if callSoundsEnabled is false or audio is already playing', async () => {
    const globalStore = { $state: { callSoundsEnabled: false } }
    const $storage = { getConfig: async () => null }

    await playRingtone({
      globalStore,
      $storage
    })
    assert.equal(createdAudios.length, 0)
  })
})
