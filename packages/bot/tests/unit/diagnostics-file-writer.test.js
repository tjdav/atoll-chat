import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { createDiagFileWriter } from '../../src/runtime/diagnostics/diag-file-writer.js'

describe('Diagnostic File Writer Unit Tests', () => {
  let tmpDir
  let diagPath
  /** @type {Array<{ level: string, msg: string, meta?: any }>} */
  let logs
  let logger

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diag-writer-test-'))
    diagPath = path.join(tmpDir, 'test.diag.jsonl')
    logs = []
    logger = {
      warn: (msg, meta) => logs.push({ level: 'warn', msg, meta }),
      debug: () => {},
      info: () => {},
      error: () => {},
      log: () => {},
      level: () => 'debug'
    }
  })

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('1. append writes a JSON line', async () => {
    const writer = createDiagFileWriter({ path: diagPath, logger })
    await writer.append({ type: 'state', foo: 'bar' })
    await writer.close()

    const content = await fs.readFile(diagPath, 'utf8')
    const lines = content.trim().split('\n')
    assert.equal(lines.length, 1)

    const parsed = JSON.parse(lines[0])
    assert.equal(parsed.type, 'state')
    assert.equal(parsed.foo, 'bar')
  })

  test('2. Multiple appends produce multiple lines in order', async () => {
    const writer = createDiagFileWriter({ path: diagPath, logger })
    await writer.append({ seq: 1 })
    await writer.append({ seq: 2 })
    await writer.append({ seq: 3 })
    await writer.close()

    const content = await fs.readFile(diagPath, 'utf8')
    const lines = content.trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(lines.length, 3)
    assert.equal(lines[0].seq, 1)
    assert.equal(lines[1].seq, 2)
    assert.equal(lines[2].seq, 3)
  })

  test('3. A circular reference is logged and dropped', async () => {
    const writer = createDiagFileWriter({ path: diagPath, logger })
    await writer.append({ seq: 1 })

    /** @type {any} */
    const circularObj = { seq: 2 }
    circularObj.self = circularObj

    await writer.append(circularObj)
    await writer.close()

    const content = await fs.readFile(diagPath, 'utf8')
    const lines = content.trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(lines.length, 1)
    assert.equal(lines[0].seq, 1)

    assert.ok(logs.some((l) => l.msg.includes('serialization failed')))
  })

  test('4. A serialization error does not stop the queue', async () => {
    const writer = createDiagFileWriter({ path: diagPath, logger })
    await writer.append({ seq: 1 })

    /** @type {any} */
    const circularObj = { seq: 2 }
    circularObj.self = circularObj
    writer.append(circularObj) // intentionally not awaited immediately

    await writer.append({ seq: 3 })
    await writer.close()

    const content = await fs.readFile(diagPath, 'utf8')
    const lines = content.trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(lines.length, 2)
    assert.equal(lines[0].seq, 1)
    assert.equal(lines[1].seq, 3)
  })

  test('5. truncate empties the file', async () => {
    const writer = createDiagFileWriter({ path: diagPath, logger })
    await writer.append({ seq: 1 })
    await writer.truncate()
    await writer.close()

    const content = await fs.readFile(diagPath, 'utf8')
    assert.equal(content, '')
  })

  test('6. close drains the queue', async () => {
    const writer = createDiagFileWriter({ path: diagPath, logger })
    writer.append({ seq: 1 })
    writer.append({ seq: 2 })
    writer.append({ seq: 3 })

    await writer.close()

    const content = await fs.readFile(diagPath, 'utf8')
    const lines = content.trim().split('\n')
    assert.equal(lines.length, 3)
  })

  test('7. close is idempotent', async () => {
    const writer = createDiagFileWriter({ path: diagPath, logger })
    await writer.append({ seq: 1 })

    await writer.close()
    await writer.close()
    await writer.close()

    const content = await fs.readFile(diagPath, 'utf8')
    const lines = content.trim().split('\n')
    assert.equal(lines.length, 1)
  })

  test('8. Write failures are logged at warn', async () => {
    const dirAsFilePath = path.join(tmpDir, 'is_a_directory.diag.jsonl')
    await fs.mkdir(dirAsFilePath)

    const writer = createDiagFileWriter({ path: dirAsFilePath, logger })
    await writer.append({ seq: 1 })
    await writer.close()

    assert.ok(logs.some((l) => l.level === 'warn' && l.msg.includes('diagnostic file write failed')))
  })

  test('9. Write failures are throttled to once per minute', async () => {
    const dirAsFilePath = path.join(tmpDir, 'is_a_directory_2.diag.jsonl')
    await fs.mkdir(dirAsFilePath)

    let mockTime = 100000
    const writer = createDiagFileWriter({
      path: dirAsFilePath,
      logger,
      now: () => mockTime
    })

    await writer.append({ seq: 1 })
    mockTime += 1000 // 1 second later (within 60s)
    await writer.append({ seq: 2 })
    mockTime += 1000 // another 1s later
    await writer.append({ seq: 3 })
    await writer.close()

    const warnLogs = logs.filter((l) => l.level === 'warn' && l.msg.includes('diagnostic file write failed'))
    assert.equal(warnLogs.length, 1)

    // Now advance clock past 60s
    mockTime += 61000
    await writer.append({ seq: 4 })
    await writer.close()

    const warnLogsAfter = logs.filter((l) => l.level === 'warn' && l.msg.includes('diagnostic file write failed'))
    assert.equal(warnLogsAfter.length, 2)
  })
})
