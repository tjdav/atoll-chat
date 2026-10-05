import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

import { Storage } from '../../src/runtime/storage/index.js'
import { IdempotencyStore, STORAGE_PREFIX } from '../../src/runtime/idempotency/index.js'

describe('IdempotencyStore unit tests', () => {
  /** @type {string} */
  let tmpDir
  /** @type {Storage} */
  let storage
  /** @type {Uint8Array} */
  let seed
  /** @type {number} */
  let nowMs

  const botId = 'bot_test_123'
  const clock = () => nowMs

  beforeEach(async () => {
    nowMs = 1_000_000
    seed = crypto.randomBytes(32)
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-idempotency-test-'))
    const filePath = path.join(tmpDir, 'storage.json')

    storage = new Storage({ path: filePath, seed, botId })
    await storage.open()
  })

  afterEach(async () => {
    if (storage) {
      await storage.close()
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('1. check on unknown key returns false', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    const res = await store.check('key_unknown')
    assert.equal(res, false)
  })

  it('2. record then check returns true', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    await store.record('key_1')
    const res = await store.check('key_1')
    assert.equal(res, true)
  })

  it('3. checkAndRecord on a new key returns false and records it', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    const res1 = await store.checkAndRecord('key_new')
    assert.equal(res1, false)

    const res2 = await store.check('key_new')
    assert.equal(res2, true)
  })

  it('4. checkAndRecord on a recorded key returns true', async () => {
    const store = new IdempotencyStore({ storage, now: clock, ttlMs: 1000 })
    await store.record('key_recorded')

    nowMs += 500
    const res = await store.checkAndRecord('key_recorded')
    assert.equal(res, true)

    // Verify timestamp was not updated by checkAndRecord:
    // Original record was at t=1,000,000. TTL = 1000. Expire at t=1,001,000.
    nowMs = 1_001_000
    assert.equal(await store.check('key_recorded'), false)
  })

  it('5. TTL expiry', async () => {
    const store = new IdempotencyStore({ storage, now: clock, ttlMs: 5000 })
    await store.record('key_ttl')

    nowMs += 5001
    assert.equal(await store.check('key_ttl'), false)
  })

  it('6. TTL boundary', async () => {
    const store = new IdempotencyStore({ storage, now: clock, ttlMs: 5000 })
    await store.record('key_boundary')

    nowMs += 5000
    assert.equal(await store.check('key_boundary'), false)
  })

  it('7. Persistence across instances', async () => {
    const filePath = path.join(tmpDir, 'storage.json')
    const store1 = new IdempotencyStore({ storage, now: clock })
    await store1.record('key_persisted')

    await storage.close()

    const storage2 = new Storage({ path: filePath, seed, botId })
    await storage2.open()
    const store2 = new IdempotencyStore({ storage: storage2, now: clock })

    assert.equal(await store2.check('key_persisted'), true)
    await storage2.close()
  })

  it('8. Persistence across restart within TTL', async () => {
    const filePath = path.join(tmpDir, 'storage.json')
    const store1 = new IdempotencyStore({ storage, now: clock, ttlMs: 10000 })
    await store1.record('key_restart_live')

    await storage.close()

    nowMs += 9999

    const storage2 = new Storage({ path: filePath, seed, botId })
    await storage2.open()
    const store2 = new IdempotencyStore({ storage: storage2, now: clock, ttlMs: 10000 })

    assert.equal(await store2.check('key_restart_live'), true)
    await storage2.close()
  })

  it('9. Persistence across restart past TTL', async () => {
    const filePath = path.join(tmpDir, 'storage.json')
    const store1 = new IdempotencyStore({ storage, now: clock, ttlMs: 10000 })
    await store1.record('key_restart_expired')

    await storage.close()

    nowMs += 10001

    const storage2 = new Storage({ path: filePath, seed, botId })
    await storage2.open()
    const store2 = new IdempotencyStore({ storage: storage2, now: clock, ttlMs: 10000 })

    assert.equal(await store2.check('key_restart_expired'), false)
    await storage2.close()
  })

  it('10. remove deletes an entry', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    await store.record('key_rem')
    assert.equal(await store.check('key_rem'), true)

    await store.remove('key_rem')
    assert.equal(await store.check('key_rem'), false)
  })

  it('11. remove on unknown key is a no-op', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    await store.remove('key_missing')
    assert.equal(await store.check('key_missing'), false)
  })

  it('12. prune removes expired entries and returns the count', async () => {
    const store = new IdempotencyStore({ storage, now: clock, ttlMs: 5000 })
    await store.record('k1')
    await store.record('k2')

    nowMs += 5000
    const count = await store.prune()
    assert.equal(count, 2)
  })

  it('13. prune keeps live entries', async () => {
    const store = new IdempotencyStore({ storage, now: clock, ttlMs: 5000 })
    await store.record('k1')

    nowMs += 2000
    await store.record('k2')

    nowMs += 2000
    await store.record('k3')

    nowMs += 1500 // total +5500 for k1 (expired), +3500 for k2 (live), +1500 for k3 (live)
    const count = await store.prune()
    assert.equal(count, 1)

    assert.equal(await store.check('k1'), false)
    assert.equal(await store.check('k2'), true)
    assert.equal(await store.check('k3'), true)
  })

  it('14. prune removes corrupt entries', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    const corruptKey = `${STORAGE_PREFIX}corrupt123`
    await storage.set(corruptKey, 'not_a_number')

    const count = await store.prune()
    assert.equal(count, 1)
    assert.equal(await storage.get(corruptKey), undefined)
  })

  it('15. clear removes everything', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    await store.record('k1')
    await store.record('k2')
    await store.record('k3')

    const count = await store.clear()
    assert.equal(count, 3)

    assert.equal(await store.check('k1'), false)
    assert.equal(await store.check('k2'), false)
    assert.equal(await store.check('k3'), false)
  })

  it('16. Empty key is rejected', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    await assert.rejects(() => store.check(''), /Trigger key must not be empty/)
    await assert.rejects(() => store.record(''), /Trigger key must not be empty/)
    await assert.rejects(() => store.checkAndRecord(''), /Trigger key must not be empty/)
    await assert.rejects(() => store.remove(''), /Trigger key must not be empty/)
  })

  it('17. Non-string key is rejected', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    for (const badKey of [null, undefined, 42]) {
      // @ts-expect-error Testing runtime parameter validation with invalid types
      await assert.rejects(() => store.check(badKey), /Trigger key must be a string/)
      // @ts-expect-error Testing runtime parameter validation with invalid types
      await assert.rejects(() => store.record(badKey), /Trigger key must be a string/)
      // @ts-expect-error Testing runtime parameter validation with invalid types
      await assert.rejects(() => store.checkAndRecord(badKey), /Trigger key must be a string/)
      // @ts-expect-error Testing runtime parameter validation with invalid types
      await assert.rejects(() => store.remove(badKey), /Trigger key must be a string/)
    }
  })

  it('18. Runtime-prefixed key is rejected', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    const badKey = '_runtime:foo'
    await assert.rejects(() => store.check(badKey), /Trigger key must not start with "_runtime:"/)
    await assert.rejects(() => store.record(badKey), /Trigger key must not start with "_runtime:"/)
    await assert.rejects(() => store.checkAndRecord(badKey), /Trigger key must not start with "_runtime:"/)
    await assert.rejects(() => store.remove(badKey), /Trigger key must not start with "_runtime:"/)
  })

  it('19. Concurrent checkAndRecord on the same key', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    const results = await Promise.all([
      store.checkAndRecord('concurrent_key'),
      store.checkAndRecord('concurrent_key')
    ])

    const falseCount = results.filter((r) => r === false).length
    const trueCount = results.filter((r) => r === true).length

    assert.equal(falseCount, 1)
    assert.equal(trueCount, 1)
  })

  it('20. Sequential checkAndRecord on the same key', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    await store.record('seq_key')
    const res = await store.checkAndRecord('seq_key')
    assert.equal(res, true)
  })

  it('21. Different keys are independent', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    await store.record('a')
    assert.equal(await store.check('b'), false)
  })

  it('22. Storage key length is fixed', async () => {
    const store = new IdempotencyStore({ storage, now: clock })
    const shortKey = 'abc'
    const longKey = 'a'.repeat(5000)

    await store.record(shortKey)
    await store.record(longKey)

    const keys = storage.keys()
    assert.equal(keys.length, 2)

    for (const k of keys) {
      assert.ok(k.startsWith(STORAGE_PREFIX))
      const digestPart = k.substring(STORAGE_PREFIX.length)
      assert.equal(digestPart.length, 43)
    }
  })

  it('23. Opportunistic prune', async () => {
    const store = new IdempotencyStore({ storage, now: clock, pruneThreshold: 3, ttlMs: 1000 })
    await store.record('k1')
    await store.record('k2')

    nowMs += 2000 // k1 and k2 are now expired

    // The 3rd record hits pruneThreshold: 3
    await store.record('k3')

    // Wait for queued background prune to complete by enqueuing a no-op check
    await store.check('k3')

    const keys = storage.keys()
    assert.equal(keys.length, 1)
    assert.equal(await store.check('k1'), false)
    assert.equal(await store.check('k2'), false)
    assert.equal(await store.check('k3'), true)
  })

  it('24. pruneThreshold: 0 disables opportunistic prune', async () => {
    const store = new IdempotencyStore({ storage, now: clock, pruneThreshold: 0, ttlMs: 1000 })
    await store.record('k1')
    await store.record('k2')

    nowMs += 2000

    await store.record('k3')
    await store.check('k3')

    // Entries are expired on check, but still present in raw storage keys
    const keys = storage.keys()
    assert.equal(keys.length, 3)
  })

  it('25. Logger integration', async () => {
    /** @type {Array<{ level: string, msg: string, meta?: object }>} */
    const logs = []
    /** @type {import('../../src/runtime/diagnostics/logger.js').Logger} */
    const logger = {
      log: (level, msg, meta) => {
        logs.push({ level, msg, ...(meta !== undefined ? { meta } : {}) })
      },
      debug: (msg, meta) => {
        logs.push({ level: 'debug', msg, ...(meta !== undefined ? { meta } : {}) })
      },
      info: (msg, meta) => {
        logs.push({ level: 'info', msg, ...(meta !== undefined ? { meta } : {}) })
      },
      warn: (msg, meta) => {
        logs.push({ level: 'warn', msg, ...(meta !== undefined ? { meta } : {}) })
      },
      error: (msg, meta) => {
        logs.push({ level: 'error', msg, ...(meta !== undefined ? { meta } : {}) })
      },
      level: () => 'info'
    }

    const store = new IdempotencyStore({ storage, now: clock, ttlMs: 1000, logger })
    await store.record('k1')

    nowMs += 2000
    await store.prune()

    const pruneLog = logs.find((l) => l.msg === 'idempotency prune')
    assert.ok(pruneLog)
    assert.equal(pruneLog.level, 'info')
    assert.ok(pruneLog.meta && typeof pruneLog.meta === 'object')
    // @ts-expect-error Checking meta object property
    assert.ok(pruneLog.meta.removed >= 1)
  })
})
