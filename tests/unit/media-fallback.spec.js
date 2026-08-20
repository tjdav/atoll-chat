import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

describe('Media Fallback & Cache Self-Healing Unit Tests', () => {
  let mockState
  let mockStorage
  let mockWorker
  let mockPb
  let mockBus
  let mediaPluginContext
  let deletedFiles
  let savedFiles

  beforeEach(async () => {
    if (typeof globalThis.URL.createObjectURL !== 'function' || globalThis.URL.createObjectURL.name === 'createObjectURL') {
      let objectUrlCounter = 0
      globalThis.URL.createObjectURL = (_blob) => `blob:http://localhost/${++objectUrlCounter}`
      globalThis.URL.revokeObjectURL = () => {
      }
    }

    deletedFiles = []
    savedFiles = []

    mockState = {
      decryptionCache: new Map()
    }
    mockStorage = {
      files: new Map(),
      getFile: async (fileId) => mockStorage.files.get(fileId) || null,
      saveFile: async (fileId, blob) => {
        mockStorage.files.set(fileId, blob)
        savedFiles.push({
          fileId,
          blob
        })
      },
      deleteFile: async (fileId) => {
        mockStorage.files.delete(fileId)
        deletedFiles.push(fileId)
      }
    }
    mockWorker = {
      execute: async (type, payload) => {
        const buf = payload.encryptedBuffer || payload.ciphertext
        if (buf) {
          const arr = new Uint8Array(buf)
          if (arr[0] === 0xff) {
            throw new Error('Corrupt payload decryption error')
          }
        }
        return new Uint8Array([1, 2, 3, 4]).buffer
      }
    }
    mockPb = {
      collection: () => ({
        getOne: async (mediaId) => ({
          id: mediaId,
          file: 'clean_remote.enc'
        })
      }),
      files: {
        getURL: () => 'https://example.com/clean_remote.enc'
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

    const utilsModule = await import('../../src/plugins/utils-plugin.js')
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

  test('1. Clean local Dexie ciphertext decrypts immediately without remote network fetch', async () => {
    const { $media } = mediaPluginContext

    let remoteFetchCalled = false
    globalThis.fetch = async () => {
      remoteFetchCalled = true
      return { ok: true }
    }

    // Set clean local blob in mock storage
    const cleanBlob = {
      arrayBuffer: async () => new Uint8Array([0x01, 0x02, 0x03]).buffer
    }
    mockStorage.files.set('m-clean-1', cleanBlob)

    const url = await $media.decrypt({
      media_id: 'm-clean-1',
      file_key: 'key1',
      file_nonce: 'nonce1',
      mime_type: 'image/jpeg'
    })

    assert.ok(url)
    assert.equal(remoteFetchCalled, false)
    assert.equal(deletedFiles.length, 0)
  })

  test('2. Corrupted local Dexie ciphertext deletes corrupt record, fetches remote, decrypts, self-heals Dexie, and returns blob URL', async () => {
    const { $media } = mediaPluginContext

    let remoteFetchCount = 0
    const cleanRemoteBytes = new Uint8Array([0x10, 0x20, 0x30])
    globalThis.fetch = async () => {
      remoteFetchCount++
      return {
        ok: true,
        blob: async () => ({
          arrayBuffer: async () => cleanRemoteBytes.buffer
        })
      }
    }

    // Set corrupt local blob (starts with 0xff to trigger worker mock error)
    const corruptBlob = {
      arrayBuffer: async () => new Uint8Array([0xff, 0x00, 0x00]).buffer
    }
    mockStorage.files.set('m-corrupt-1', corruptBlob)

    const url = await $media.decrypt({
      media_id: 'm-corrupt-1',
      file_key: 'key1',
      file_nonce: 'nonce1',
      mime_type: 'image/png'
    })

    assert.ok(url)
    assert.equal(deletedFiles.includes('m-corrupt-1'), true)
    assert.equal(remoteFetchCount, 1)
    assert.equal(savedFiles.length, 1)
    assert.equal(savedFiles[0].fileId, 'm-corrupt-1')
  })

  test('3. When local ciphertext is corrupt AND no media_id / remote fetch fails, evicts local and rejects', async () => {
    const { $media } = mediaPluginContext

    const corruptBlob = {
      arrayBuffer: async () => new Uint8Array([0xff, 0x00, 0x00]).buffer
    }
    mockStorage.files.set('local-p2p-corrupt', corruptBlob)

    await assert.rejects(
      $media.decrypt({
        localUuid: 'local-p2p-corrupt',
        file_key: 'key1',
        file_nonce: 'nonce1'
      }),
      /Media file not found locally or on server/
    )

    assert.equal(deletedFiles.includes('local-p2p-corrupt'), true)
  })

  test('4. Concurrent requests for corrupted local asset deduplicate and resolve cleanly via single remote fallback fetch', async () => {
    const { $media } = mediaPluginContext

    let remoteFetchCount = 0
    globalThis.fetch = async () => {
      remoteFetchCount++
      return {
        ok: true,
        blob: async () => ({
          arrayBuffer: async () => new Uint8Array([0x10, 0x20]).buffer
        })
      }
    }

    const corruptBlob = {
      arrayBuffer: async () => new Uint8Array([0xff, 0x00, 0x00]).buffer
    }
    mockStorage.files.set('m-concurrent-corrupt', corruptBlob)

    const asset = {
      media_id: 'm-concurrent-corrupt',
      file_key: 'key1',
      file_nonce: 'nonce1'
    }

    const promises = [
      $media.decrypt(asset),
      $media.decrypt(asset),
      $media.decrypt(asset)
    ]

    const results = await Promise.all(promises)

    assert.equal(remoteFetchCount, 1)
    assert.equal(results[0], results[1])
    assert.equal(results[1], results[2])
    assert.equal(deletedFiles.includes('m-concurrent-corrupt'), true)
  })

  test('5. $link.decryptPreview delegates to $media.decrypt with isThumbnail: true', async () => {
    const { $link } = mediaPluginContext

    globalThis.fetch = async () => ({
      ok: true,
      blob: async () => ({
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
      })
    })

    const url = await $link.decryptPreview({
      media_id: 'm-link-1',
      file_key: 'key1',
      file_nonce: 'nonce1'
    })

    assert.ok(url)
    assert.ok(mockState.decryptionCache.has('thumb:m-link-1'))
  })
})
