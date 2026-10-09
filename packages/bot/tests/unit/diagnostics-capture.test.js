import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { createDiagnosticsCapture } from '../../src/runtime/diagnostics/capture.js'
import { createDiagFileWriter } from '../../src/runtime/diagnostics/diag-file-writer.js'

class FakeStorage {
  constructor () {
    /** @type {Map<string, any>} */
    this.data = new Map()
  }

  async get (key) {
    return this.data.get(key)
  }

  async set (key, value) {
    this.data.set(key, value)
  }

  async delete (key) {
    this.data.delete(key)
  }

  keys () {
    return Array.from(this.data.keys())
  }
}

describe('Diagnostics Capture Unit Tests', () => {
  let tmpDir
  let diagPath
  let diagFile
  let storage
  let logs
  let logger

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diag-capture-test-'))
    diagPath = path.join(tmpDir, 'test.diag.jsonl')
    logs = []
    logger = {
      warn: (msg, meta) => logs.push({ level: 'warn', msg, meta }),
      debug: (msg, meta) => logs.push({ level: 'debug', msg, meta }),
      info: () => {},
      error: () => {},
      log: () => {},
      level: () => 'debug'
    }
    diagFile = createDiagFileWriter({ path: diagPath, logger })
    storage = new FakeStorage()
  })

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('1. Writes to the diagnostic file', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({ foo: 'bar' }),
      botId: 'b_test1'
    })

    await capture.recordSnapshot('pause')
    await capture.close()

    const content = await fs.readFile(diagPath, 'utf8')
    const lines = content.trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(lines.length, 1)
    assert.equal(lines[0].type, 'snapshot')
    assert.equal(lines[0].reason, 'pause')
  })

  test('2. Writes to storage under _runtime:diagnostics:<at>', async () => {
    let mockTime = 1700000000000
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({ foo: 'bar' }),
      botId: 'b_test1',
      now: () => mockTime
    })

    await capture.recordSnapshot('pause')

    const storageKeys = storage.keys()
    const expectedAtISO = new Date(mockTime).toISOString()
    const expectedKey = `_runtime:diagnostics:${expectedAtISO}`

    assert.ok(storageKeys.includes(expectedKey))
    const stored = await storage.get(expectedKey)
    assert.equal(stored.reason, 'pause')
    assert.equal(stored.bot_id, 'b_test1')
  })

  test('3. The snapshot has type, at, reason, context, state, bot_id, uptime_ms', async () => {
    let mockTime = 1000
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({ stateVal: 42 }),
      botId: 'b_test_fields',
      now: () => {
        const t = mockTime
        mockTime += 500
        return t
      }
    })

    await capture.recordSnapshot('operator', { flag: true })

    const storedKey = storage.keys().find((k) => k.startsWith('_runtime:diagnostics:'))
    assert.ok(storedKey)
    const stored = await storage.get(storedKey)

    assert.equal(stored.type, 'snapshot')
    assert.ok(typeof stored.at === 'string')
    assert.equal(stored.reason, 'operator')
    assert.deepEqual(stored.context, { flag: true })
    assert.deepEqual(stored.state, { stateVal: 42 })
    assert.equal(stored.bot_id, 'b_test_fields')
    assert.equal(typeof stored.uptime_ms, 'number')
  })

  test('4. snapshotState() throw produces { error: "snapshot_state_failed" }', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => {
        throw new Error('state explosion')
      },
      botId: 'b_test_err'
    })

    await capture.recordSnapshot('keystore_warning')

    const storedKey = storage.keys().find((k) => k.startsWith('_runtime:diagnostics:'))
    assert.ok(storedKey)
    const stored = await storage.get(storedKey)

    assert.deepEqual(stored.state, { error: 'snapshot_state_failed' })
  })

  test('5. A caller-supplied context is included', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test_ctx'
    })

    await capture.recordSnapshot('pause', { custom_key: 'custom_value', num: 123 })

    const storedKey = storage.keys().find((k) => k.startsWith('_runtime:diagnostics:'))
    assert.ok(storedKey)
    const stored = await storage.get(storedKey)

    assert.deepEqual(stored.context, { custom_key: 'custom_value', num: 123 })
  })

  test('6. Two snapshots with different reasons produce two entries', async () => {
    let mockTime = 2000000000000
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test_multi',
      now: () => {
        mockTime += 1000
        return mockTime
      }
    })

    await capture.recordSnapshot('pause')
    await capture.recordSnapshot('reconnect_storm')

    const diagKeys = storage.keys().filter((k) => k.startsWith('_runtime:diagnostics:'))
    assert.equal(diagKeys.length, 2)

    const snap1 = await storage.get(diagKeys[0])
    const snap2 = await storage.get(diagKeys[1])

    assert.equal(snap1.reason, 'pause')
    assert.equal(snap2.reason, 'reconnect_storm')
  })

  test('7. recordLog writes a type: "log" line', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test'
    })

    capture.recordLog({ level: 'info', msg: 'hello' })
    await capture.close()

    const content = await fs.readFile(diagPath, 'utf8')
    const lines = content.trim().split('\n').map((l) => JSON.parse(l))

    assert.equal(lines.length, 1)
    assert.equal(lines[0].type, 'log')
    assert.equal(lines[0].level, 'info')
    assert.equal(lines[0].msg, 'hello')
    assert.ok(typeof lines[0].at === 'string')
  })

  test('8. recordLog does not write to storage', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test'
    })

    capture.recordLog({ level: 'warn', msg: 'test' })
    await capture.close()

    assert.equal(storage.keys().length, 0)
  })

  test('9. Non-object input to recordLog is silently dropped', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test'
    })

    // @ts-ignore
    capture.recordLog('not an object')
    // @ts-ignore
    capture.recordLog(null)
    // @ts-ignore
    capture.recordLog([1, 2, 3])

    await capture.close()

    const content = await fs.readFile(diagPath, 'utf8').catch((err) => (err.code === 'ENOENT' ? '' : Promise.reject(err)))
    assert.equal(content, '')
  })

  test('10. prune deletes entries older than the cutoff', async () => {
    const nowMs = 1000000000000
    const retentionDays = 7
    const oldMs = nowMs - (8 * 86400 * 1000) // 8 days old

    const oldAtISO = new Date(oldMs).toISOString()
    const oldKey = `_runtime:diagnostics:${oldAtISO}`

    await storage.set(oldKey, {
      type: 'snapshot',
      at: oldAtISO,
      reason: 'pause'
    })

    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test',
      retentionDays,
      now: () => nowMs
    })

    const removed = await capture.prune()
    assert.equal(removed, 1)
    assert.equal(await storage.get(oldKey), undefined)
  })

  test('11. prune keeps entries within the window', async () => {
    const nowMs = 1000000000000
    const retentionDays = 7
    const recentMs = nowMs - (3 * 86400 * 1000) // 3 days old

    const recentAtISO = new Date(recentMs).toISOString()
    const recentKey = `_runtime:diagnostics:${recentAtISO}`

    await storage.set(recentKey, {
      type: 'snapshot',
      at: recentAtISO,
      reason: 'pause'
    })

    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test',
      retentionDays,
      now: () => nowMs
    })

    const removed = await capture.prune()
    assert.equal(removed, 0)
    assert.notEqual(await storage.get(recentKey), undefined)
  })

  test('12. prune ignores non-_runtime:diagnostics: keys', async () => {
    await storage.set('author_key_1', { data: 'hello' })
    await storage.set('_runtime:other_prefix:foo', { data: 'bar' })

    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test'
    })

    const removed = await capture.prune()
    assert.equal(removed, 0)
    assert.notEqual(await storage.get('author_key_1'), undefined)
    assert.notEqual(await storage.get('_runtime:other_prefix:foo'), undefined)
  })

  test('13. prune returns the count removed', async () => {
    const nowMs = 1000000000000
    const oldMs1 = nowMs - (10 * 86400 * 1000)
    const oldMs2 = nowMs - (12 * 86400 * 1000)

    const key1 = `_runtime:diagnostics:${new Date(oldMs1).toISOString()}`
    const key2 = `_runtime:diagnostics:${new Date(oldMs2).toISOString()}`

    await storage.set(key1, { at: new Date(oldMs1).toISOString() })
    await storage.set(key2, { at: new Date(oldMs2).toISOString() })

    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test',
      now: () => nowMs
    })

    const removed = await capture.prune()
    assert.equal(removed, 2)
  })

  test('14. Malformed values are removed during prune', async () => {
    const keyNull = '_runtime:diagnostics:null_val'
    const keyNoAt = '_runtime:diagnostics:no_at_field'
    const keyBadAt = '_runtime:diagnostics:bad_at_date'

    await storage.set(keyNull, null)
    await storage.set(keyNoAt, { foo: 'bar' })
    await storage.set(keyBadAt, { at: 'not-a-valid-date' })

    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test'
    })

    const removed = await capture.prune()
    assert.equal(removed, 3)
  })

  test('15. notifyReconnectFailed increments the counter', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test',
      reconnectStormThreshold: 10
    })

    await capture.notifyReconnectFailed(1, new Error('err 1'))
    assert.equal(storage.keys().length, 0)
  })

  test('16. Nine failures do not trigger a snapshot', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test',
      reconnectStormThreshold: 10
    })

    for (let i = 1; i <= 9; i++) {
      await capture.notifyReconnectFailed(i, new Error(`err ${i}`))
    }

    assert.equal(storage.keys().length, 0)
  })

  test('17. Ten failures trigger a snapshot with reason: "reconnect_storm"', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test',
      reconnectStormThreshold: 10
    })

    for (let i = 1; i <= 10; i++) {
      await capture.notifyReconnectFailed(i, new Error(`failure ${i}`))
    }

    const storedKey = storage.keys().find((k) => k.startsWith('_runtime:diagnostics:'))
    assert.ok(storedKey)
    const stored = await storage.get(storedKey)

    assert.equal(stored.reason, 'reconnect_storm')
    assert.equal(stored.context.attempt, 10)
    assert.equal(stored.context.last_error, 'failure 10')
  })

  test('18. notifyReconnectSuccess resets the counter', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test',
      reconnectStormThreshold: 10
    })

    for (let i = 1; i <= 9; i++) {
      await capture.notifyReconnectFailed(i, new Error(`failure ${i}`))
    }

    capture.notifyReconnectSuccess()

    for (let i = 1; i <= 9; i++) {
      await capture.notifyReconnectFailed(i, new Error(`failure again ${i}`))
    }

    assert.equal(storage.keys().length, 0)
  })

  test('19. After a success, ten more failures trigger again', async () => {
    let mockTime = 3000000000000
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test',
      reconnectStormThreshold: 10,
      now: () => {
        mockTime += 1000
        return mockTime
      }
    })

    for (let i = 1; i <= 10; i++) {
      await capture.notifyReconnectFailed(i, new Error(`streak 1 err ${i}`))
    }
    assert.equal(storage.keys().length, 1)

    capture.notifyReconnectSuccess()

    for (let i = 1; i <= 10; i++) {
      await capture.notifyReconnectFailed(i, new Error(`streak 2 err ${i}`))
    }
    assert.equal(storage.keys().length, 2)
  })

  test('20. close drains pending writes', async () => {
    const capture = createDiagnosticsCapture({
      storage,
      diagFile,
      logger,
      snapshotState: () => ({}),
      botId: 'b_test'
    })

    capture.recordLog({ msg: 'pending 1' })
    capture.recordLog({ msg: 'pending 2' })

    await capture.close()

    const content = await fs.readFile(diagPath, 'utf8')
    const lines = content.trim().split('\n')
    assert.equal(lines.length, 2)
  })
})
