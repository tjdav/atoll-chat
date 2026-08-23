import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

describe('Atoll Storage Clear Unit Tests', () => {
  test('should calculate storage usage correctly across 3 categories', async () => {
    const { createWebStorageAdapter } = await import('../../../src/plugins/storage-adapter-web.js')
    const adapter = createWebStorageAdapter()

    // Test default initial usage when db is null / uninitialized
    const usageNull = await adapter.getStorageUsage()
    assert.deepEqual(usageNull, {
      messagesBytes: 0,
      messagesCount: 0,
      voiceBytes: 0,
      voiceCount: 0,
      mediaBytes: 0,
      mediaCount: 0,
      totalBytes: 0
    })
  })
})
