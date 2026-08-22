import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Storage Clear Unit Tests', () => {
  test('should calculate storage usage correctly', async () => {
    const { createWebStorageAdapter } = await import('../../../src/plugins/storage-adapter-web.js')
    const adapter = createWebStorageAdapter()

    // Test default initial usage when db is null / uninitialized
    const usageNull = await adapter.getStorageUsage()
    assert.deepEqual(usageNull, {
      mediaBytes: 0,
      mediaCount: 0,
      messagesBytes: 0,
      messagesCount: 0,
      totalBytes: 0
    })
  })
})
