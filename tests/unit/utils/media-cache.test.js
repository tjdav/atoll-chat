import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { MediaLRUCache } from '../../../src/utils/media-lru-cache.js'

describe('MediaLRUCache Unit Tests', () => {
  let revokedUrls = []

  beforeEach(() => {
    revokedUrls = []
    if (!globalThis.URL) {
      globalThis.URL = {}
    }
    globalThis.URL.revokeObjectURL = (url) => {
      revokedUrls.push(url)
    }
  })

  test('Capacity Bound & LRU Order Eviction', () => {
    const cache = new MediaLRUCache({ maxEntries: 3 })
    cache.setActiveRoom('room1')

    cache.set('key1', {
      blobUrl: 'blob:1',
      roomId: 'room1'
    })
    cache.set('key2', {
      blobUrl: 'blob:2',
      roomId: 'room1'
    })
    cache.set('key3', {
      blobUrl: 'blob:3',
      roomId: 'room1'
    })

    assert.equal(cache.size, 3)

    // Access key1 to make key2 the least recently used
    cache.get('key1')

    // Adding key4 should evict key2
    cache.set('key4', {
      blobUrl: 'blob:4',
      roomId: 'room1'
    })

    assert.equal(cache.size, 3)
    assert.equal(cache.has('key2'), false)
    assert.equal(cache.has('key1'), true)
    assert.equal(cache.has('key3'), true)
    assert.equal(cache.has('key4'), true)
  })

  test('Active Room Tombstone Preservation (Deferred Revocation)', () => {
    const cache = new MediaLRUCache({ maxEntries: 2 })
    cache.setActiveRoom('active-room')

    cache.set('key1', {
      blobUrl: 'blob:1',
      roomId: 'active-room'
    })
    cache.set('key2', {
      blobUrl: 'blob:2',
      roomId: 'active-room'
    })

    // Evict key1 because maxEntries is 2
    cache.set('key3', {
      blobUrl: 'blob:3',
      roomId: 'active-room'
    })

    // key1 should be removed from cache map, but placed into tombstones without being revoked yet
    assert.equal(cache.has('key1'), false)
    assert.equal(revokedUrls.includes('blob:1'), false)
    assert.equal(cache.tombstones.size, 1)

    // Room transition flushes tombstones
    cache.setActiveRoom('new-room')
    assert.equal(revokedUrls.includes('blob:1'), true)
    assert.equal(cache.tombstones.size, 0)
  })

  test('Inactive Room Immediate Revocation', () => {
    const cache = new MediaLRUCache({ maxEntries: 2 })
    cache.setActiveRoom('active-room')

    cache.set('key1', {
      blobUrl: 'blob:old-room',
      roomId: 'inactive-room'
    })
    cache.set('key2', {
      blobUrl: 'blob:active',
      roomId: 'active-room'
    })

    // Evict key1
    cache.set('key3', {
      blobUrl: 'blob:active2',
      roomId: 'active-room'
    })

    // key1 belonged to inactive-room, so it must be revoked immediately upon eviction
    assert.equal(cache.has('key1'), false)
    assert.equal(revokedUrls.includes('blob:old-room'), true)
    assert.equal(cache.tombstones.size, 0)
  })

  test('Logout Teardown Gate', () => {
    const cache = new MediaLRUCache({ maxEntries: 5 })
    cache.set('key1', { blobUrl: 'blob:1' })
    cache.set('key2', { blobUrl: 'blob:2' })

    cache.clear()

    assert.equal(cache.size, 0)
    assert.equal(cache.isTornDown, true)
    assert.equal(revokedUrls.includes('blob:1'), true)
    assert.equal(revokedUrls.includes('blob:2'), true)

    // Set while torn down should immediately revoke and reject entry
    cache.set('lateKey', { blobUrl: 'blob:late' })

    assert.equal(cache.has('lateKey'), false)
    assert.equal(revokedUrls.includes('blob:late'), true)

    // Reset restores functionality
    cache.reset()
    assert.equal(cache.isTornDown, false)
    cache.set('newKey', { blobUrl: 'blob:new' })
    assert.equal(cache.has('newKey'), true)
  })

  test('Overwrite Safety & Non-Blob URL Safety', () => {
    const cache = new MediaLRUCache({ maxEntries: 5 })

    cache.set('key1', {
      blobUrl: 'blob:same-url',
      mimeType: 'image/png'
    })
    // Updating key1 with same blobUrl
    cache.set('key1', {
      blobUrl: 'blob:same-url',
      mimeType: 'image/png',
      updated: true
    })

    assert.equal(revokedUrls.includes('blob:same-url'), false)

    // Updating key1 with different blobUrl
    cache.set('key1', { blobUrl: 'blob:new-url' })
    assert.equal(revokedUrls.includes('blob:same-url'), true)
    assert.equal(revokedUrls.includes('blob:new-url'), false)

    // Non-blob URL safety
    cache.set('key2', 'data:image/png;base64,123')
    cache.delete('key2')
    assert.equal(revokedUrls.includes('data:image/png;base64,123'), false)
  })
})
