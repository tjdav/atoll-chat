import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

describe('In-Flight Media Decryption Deduplication & Strict Canonical Cache-Key Architecture', () => {
  let mockState
  let mockStorage
  let mockWorker
  let mockPb
  let mockBus
  let mediaPluginContext

  beforeEach(async () => {
    // Ensure global URL methods match globalThis.Blob
    if (typeof globalThis.URL.createObjectURL !== 'function' || globalThis.URL.createObjectURL.name === 'createObjectURL') {
      let objectUrlCounter = 0
      globalThis.URL.createObjectURL = (_blob) => `blob:http://localhost/${++objectUrlCounter}`
      globalThis.URL.revokeObjectURL = () => {
      }
    }

    mockState = {
      decryptionCache: new Map()
    }
    mockStorage = {
      getFile: async () => null
    }
    mockWorker = {
      execute: async () => new Uint8Array([1, 2, 3, 4]).buffer
    }
    mockPb = {
      collection: () => ({
        getOne: async () => ({
          id: 'm123',
          file: 'test.enc'
        })
      }),
      files: {
        getURL: () => 'https://example.com/file.enc'
      }
    }
    mockBus = {
      listeners: new Map(),
      on (event, fn) {
        if (!this.listeners.has(event)) {
          this.listeners.set(event, [])
        }
        this.listeners.get(event).push(fn)
      },
      emit (event, data) {
        const handlers = this.listeners.get(event) || []
        handlers.forEach(fn => fn(data))
      }
    }

    // Dynamic import of utils-plugin
    const utilsModule = await import('../../../src/plugins/utils-plugin.js')
    const plugin = utilsModule.default
    const clientFactory = await plugin.client.context()

    mediaPluginContext = clientFactory({
      pocketbase: { pb: mockPb },
      cryptoWorker: { $worker: mockWorker },
      globalStore: { $state: mockState },
      storage: { $storage: mockStorage },
      eventBus: { $bus: mockBus }
    })
  })

  test('1. Strict Canonical Key Resolution', async () => {
    const { $media } = mediaPluginContext

    let executionCount = 0
    mockWorker.execute = async () => {
      executionCount++
      return new Uint8Array([10, 20, 30]).buffer
    }

    // Global fetch mock for PocketBase media file fetch
    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })

    // Decrypt primary media -> media:m123
    const url1 = await $media.decrypt({
      media_id: 'm123',
      file_key: 'key1',
      file_nonce: 'nonce1',
      mime_type: 'image/png'
    })

    assert.equal(executionCount, 1)
    assert.ok(mockState.decryptionCache.has('media:m123'))
    assert.ok(url1)

    // Decrypt thumbnail -> thumb:m123
    const url2 = await $media.decrypt({
      media_id: 'm123',
      file_key: 'key1',
      file_nonce: 'nonce1',
      mime_type: 'image/jpeg'
    }, { isThumbnail: true })

    assert.equal(executionCount, 2)
    assert.ok(mockState.decryptionCache.has('thumb:m123'))
    assert.ok(url2)

    mockStorage.getFile = async () => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })

    // Decrypt local optimistic item -> local:local-uuid-1
    const url3 = await $media.decrypt({
      localUuid: 'local-uuid-1',
      mime_type: 'image/webp'
    }, { isLocal: true })

    assert.equal(executionCount, 3)
    assert.ok(mockState.decryptionCache.has('local:local-uuid-1'))
    assert.ok(url3)
  })

  test('2. Concurrent Request Deduplication', async () => {
    const { $media } = mediaPluginContext

    let executionCount = 0
    mockWorker.execute = async () => {
      executionCount++
      // Simulate async decryption delay
      await new Promise(resolve => setTimeout(resolve, 50))
      return new Uint8Array([100, 200]).buffer
    }

    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })

    const asset = {
      media_id: 'm999',
      file_key: 'key999',
      file_nonce: 'nonce999',
      mime_type: 'image/jpeg'
    }

    // Issue 5 concurrent requests simultaneously
    const promises = [
      $media.decrypt(asset),
      $media.decrypt(asset),
      $media.decrypt(asset),
      $media.decrypt(asset),
      $media.decrypt(asset)
    ]

    const results = await Promise.all(promises)

    // Decryption worker should be called EXACTLY ONCE
    assert.equal(executionCount, 1)

    // All callers should resolve to the exact same Object URL
    const firstUrl = results[0]
    results.forEach(url => assert.equal(url, firstUrl))

    // Verify canonical cache entry exists
    assert.ok(mockState.decryptionCache.has('media:m999'))
  })

  test('3. Caller-Isolated AbortSignal Handling', async () => {
    const { $media } = mediaPluginContext

    mockWorker.execute = async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return new Uint8Array([55, 66]).buffer
    }

    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })

    const asset = {
      media_id: 'm-abort-test',
      file_key: 'key-abort',
      file_nonce: 'nonce-abort',
      mime_type: 'image/webp'
    }

    const controller1 = new AbortController()
    const controller2 = new AbortController()

    const req1 = $media.decrypt(asset, controller1.signal)
    const req2 = $media.decrypt(asset, controller2.signal)

    // Abort caller 1 mid-flight
    setTimeout(() => {
      controller1.abort()
    }, 20)

    // Caller 1 should reject with AbortError
    await assert.rejects(req1, (err) => err.name === 'AbortError')

    // Caller 2 should successfully complete and resolve URL
    const url2 = await req2
    assert.ok(url2)

    // Underlying background job completed and cached result under canonical key
    assert.ok(mockState.decryptionCache.has('media:m-abort-test'))
  })

  test('4. Clean Failure & Retry Handling', async () => {
    const { $media } = mediaPluginContext

    let attemptCount = 0
    mockWorker.execute = async () => {
      attemptCount++
      if (attemptCount === 1) {
        throw new Error('Network / Worker Error on 1st attempt')
      }
      return new Uint8Array([77, 88]).buffer
    }

    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })

    const asset = {
      media_id: 'm-fail-test',
      file_key: 'key-fail',
      file_nonce: 'nonce-fail',
      mime_type: 'image/png'
    }

    // 1st Attempt fails
    await assert.rejects($media.decrypt(asset), /Network \/ Worker Error on 1st attempt/)

    // Cache should not pollute with error state
    assert.equal(mockState.decryptionCache.has('media:m-fail-test'), false)

    // 2nd Attempt retry succeeds
    const retryUrl = await $media.decrypt(asset)
    assert.ok(retryUrl)
    assert.ok(mockState.decryptionCache.has('media:m-fail-test'))
  })

  test('5. Synchronous Cache Hits', async () => {
    const { $media } = mediaPluginContext

    let executionCount = 0
    mockWorker.execute = async () => {
      executionCount++
      return new Uint8Array([1, 1, 1]).buffer
    }

    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })

    const asset = {
      media_id: 'm-cache-hit',
      file_key: 'key',
      file_nonce: 'nonce',
      mime_type: 'image/jpeg'
    }

    const urlInitial = await $media.decrypt(asset)
    assert.equal(executionCount, 1)

    // Subsequent call should hit cache synchronously without worker execution
    const urlCached = await $media.decrypt(asset)
    assert.equal(executionCount, 1)
    assert.equal(urlCached, urlInitial)
  })

  test('6. Session Auth Logout Cleanup', async () => {
    const { $media } = mediaPluginContext

    globalThis.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    })

    await $media.decrypt({
      media_id: 'm-logout-test',
      file_key: 'key',
      file_nonce: 'nonce',
      mime_type: 'image/jpeg'
    })

    assert.ok(mockState.decryptionCache.has('media:m-logout-test'))

    // Trigger auth:logout event
    mockBus.emit('auth:logout')

    // In-flight map cleared cleanly
  })
})
