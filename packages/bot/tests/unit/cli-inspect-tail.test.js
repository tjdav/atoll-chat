import assert from 'node:assert/strict'
import { rmSync, mkdirSync, writeFileSync, truncateSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { inspectCommand } from '../../src/cli/inspect.js'
import { tailCommand } from '../../src/cli/tail.js'
import { followDiagFile, readLatestState, resolveDiagPath } from '../../src/cli/diag-file.js'

/**
 * Helper to capture stream writes in memory.
 */
function createMockStream () {
  let content = ''
  return {
    write (chunk) {
      content += chunk
    },
    get content () {
      return content
    }
  }
}

describe('cli-inspect-tail unit tests', { concurrency: 1 }, () => {
  let tmpDir
  let stdout
  let stderr

  beforeEach(() => {
    tmpDir = join(tmpdir(), `bot-inspect-tail-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    stdout = createMockStream()
    stderr = createMockStream()
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  describe('diag-file helpers', () => {
    it('1. resolveDiagPath appends .diag.jsonl', () => {
      assert.equal(resolveDiagPath('/path/to/bot.keystore'), '/path/to/bot.keystore.diag.jsonl')
    })

    it('2. readLatestState returns null when file is missing', async () => {
      const res = await readLatestState(join(tmpDir, 'missing.diag.jsonl'))
      assert.equal(res, null)
    })

    it('3. readLatestState returns null when file has no state line', async () => {
      const filePath = join(tmpDir, 'test.diag.jsonl')
      writeFileSync(filePath, JSON.stringify({ type: 'log', msg: 'hello' }) + '\n')
      const res = await readLatestState(filePath)
      assert.equal(res, null)
    })

    it('4. readLatestState returns the last type: state line', async () => {
      const filePath = join(tmpDir, 'test.diag.jsonl')
      const lines = [
        JSON.stringify({ type: 'state', at: '2025-01-01T00:00:00Z', data: { v: 1 } }),
        JSON.stringify({ type: 'log', msg: 'log line 1' }),
        JSON.stringify({ type: 'state', at: '2025-01-01T00:01:00Z', data: { v: 2 } }),
        JSON.stringify({ type: 'log', msg: 'log line 2' })
      ]
      writeFileSync(filePath, lines.join('\n') + '\n')

      const res = await readLatestState(filePath)
      assert.notEqual(res, null)
      assert.equal(res.at, '2025-01-01T00:01:00Z')
      assert.equal(res.data.v, 2)
    })

    it('5. readLatestState skips malformed lines', async () => {
      const filePath = join(tmpDir, 'test.diag.jsonl')
      const content = [
        '{ malformed json line',
        JSON.stringify({ type: 'state', at: '2025-01-01T00:00:00Z', data: { ok: true } }),
        'another malformed line'
      ].join('\n') + '\n'
      writeFileSync(filePath, content)

      const res = await readLatestState(filePath)
      assert.notEqual(res, null)
      assert.equal(res.data.ok, true)
    })

    it('6. readLatestState handles a large file by reading from the end', async () => {
      const filePath = join(tmpDir, 'large.diag.jsonl')
      const lines = []
      for (let i = 0; i < 1000; i++) {
        lines.push(JSON.stringify({ type: 'log', index: i }))
      }
      lines.push(JSON.stringify({ type: 'state', at: '2025-01-01T00:02:00Z', data: { index: 1000 } }))
      writeFileSync(filePath, lines.join('\n') + '\n')

      const res = await readLatestState(filePath)
      assert.notEqual(res, null)
      assert.equal(res.data.index, 1000)
    })

    it('7. followDiagFile with fromStart: false delivers only new lines', async () => {
      const filePath = join(tmpDir, 'follow.diag.jsonl')
      writeFileSync(filePath, JSON.stringify({ type: 'log', msg: 'old line' }) + '\n')

      const delivered = []
      const stop = await followDiagFile({
        path: filePath,
        fromStart: false,
        onLine: (line) => delivered.push(line)
      })

      // Write new line
      writeFileSync(filePath, JSON.stringify({ type: 'log', msg: 'new line' }) + '\n', { flag: 'a' })
      await new Promise((resolve) => setTimeout(resolve, 150))

      stop()
      assert.equal(delivered.length, 1)
      assert.equal(delivered[0].msg, 'new line')
    })

    it('8 & 9. followDiagFile with fromStart: true delivers existing lines and parses JSON', async () => {
      const filePath = join(tmpDir, 'follow.diag.jsonl')
      writeFileSync(filePath, JSON.stringify({ type: 'log', msg: 'existing line' }) + '\n')

      const delivered = []
      const stop = await followDiagFile({
        path: filePath,
        fromStart: true,
        onLine: (line) => delivered.push(line)
      })

      await new Promise((resolve) => setTimeout(resolve, 50))
      stop()

      assert.equal(delivered.length, 1)
      assert.equal(delivered[0].msg, 'existing line')
    })

    it('10. followDiagFile calls onError for malformed lines', async () => {
      const filePath = join(tmpDir, 'follow.diag.jsonl')
      writeFileSync(filePath, 'invalid json\n')

      const errors = []
      const stop = await followDiagFile({
        path: filePath,
        fromStart: true,
        onLine: () => {},
        onError: (err) => errors.push(err)
      })

      await new Promise((resolve) => setTimeout(resolve, 50))
      stop()

      assert.ok(errors.length > 0)
    })

    it('11 & 12. Stop function stops delivery and is idempotent', async () => {
      const filePath = join(tmpDir, 'follow.diag.jsonl')
      writeFileSync(filePath, '')

      const delivered = []
      const stop = await followDiagFile({
        path: filePath,
        fromStart: false,
        onLine: (line) => delivered.push(line)
      })

      stop()
      stop() // Idempotent check

      writeFileSync(filePath, JSON.stringify({ type: 'log', msg: 'after stop' }) + '\n')
      await new Promise((resolve) => setTimeout(resolve, 150))

      assert.equal(delivered.length, 0)
    })

    it('13. Follower resets when the file is truncated', async () => {
      const filePath = join(tmpDir, 'follow.diag.jsonl')
      writeFileSync(filePath, JSON.stringify({ type: 'log', msg: 'line 1' }) + '\n')

      const delivered = []
      const stop = await followDiagFile({
        path: filePath,
        fromStart: true,
        onLine: (line) => delivered.push(line)
      })

      await new Promise((resolve) => setTimeout(resolve, 50))
      assert.equal(delivered.length, 1)

      // Truncate file and write line 2
      truncateSync(filePath, 0)
      writeFileSync(filePath, JSON.stringify({ type: 'log', msg: 'line 2 truncated' }) + '\n')
      await new Promise((resolve) => setTimeout(resolve, 150))

      stop()
      assert.equal(delivered.length, 2)
      assert.equal(delivered[1].msg, 'line 2 truncated')
    })
  })

  describe('inspectCommand', () => {
    it('14. Missing diagnostic file -> exit 1, diagnostic file not found', async () => {
      const env = { ATOL_BOT_KEYSTORE: join(tmpDir, 'missing.keystore') }
      await assert.rejects(
        async () => {
          await inspectCommand.run([], {}, { stdout, stderr, cwd: tmpDir, env })
        },
        (err) => err.name === 'UserError' && err.message.includes('diagnostic file not found')
      )
    })

    it('15. No state line -> exit 1, no state snapshot found', async () => {
      const keystorePath = join(tmpDir, 'bot.keystore')
      const diagPath = resolveDiagPath(keystorePath)
      writeFileSync(diagPath, JSON.stringify({ type: 'log', msg: 'only log' }) + '\n')

      const env = { ATOL_BOT_KEYSTORE: keystorePath }
      await assert.rejects(
        async () => {
          await inspectCommand.run([], {}, { stdout, stderr, cwd: tmpDir, env })
        },
        (err) => err.name === 'UserError' && err.message.includes('no state snapshot found')
      )
    })

    it('16, 19, 20. Prints state as JSON with Snapshot at header and returns exit code 0', async () => {
      const keystorePath = join(tmpDir, 'bot.keystore')
      const diagPath = resolveDiagPath(keystorePath)
      const stateLine = {
        type: 'state',
        at: '2025-01-01T12:00:00Z',
        data: { bot_id: 'b_inspect_1', mode: 'dev' }
      }
      writeFileSync(diagPath, JSON.stringify(stateLine) + '\n')

      const env = { ATOL_BOT_KEYSTORE: keystorePath }
      const code = await inspectCommand.run([], {}, { stdout, stderr, cwd: tmpDir, env })

      assert.equal(code, 0)
      assert.match(stdout.content, /Snapshot at 2025-01-01T12:00:00Z/)
      assert.match(stdout.content, /"bot_id": "b_inspect_1"/)
    })

    it('17 & 18. With room id, filters to that room; unknown room id -> exit 1', async () => {
      const keystorePath = join(tmpDir, 'bot.keystore')
      const diagPath = resolveDiagPath(keystorePath)
      const stateLine = {
        type: 'state',
        at: '2025-01-01T12:00:00Z',
        data: {
          bot_id: 'b_inspect_room',
          now: '2025-01-01T12:00:00Z',
          grants: {
            r_room_1: { mode: 'member' },
            r_room_2: { mode: 'observer' }
          },
          publisher_keys: {
            r_room_1: { keys: [] }
          }
        }
      }
      writeFileSync(diagPath, JSON.stringify(stateLine) + '\n')

      const env = { ATOL_BOT_KEYSTORE: keystorePath }

      // Filter by r_room_1
      const code = await inspectCommand.run(['r_room_1'], {}, { stdout, stderr, cwd: tmpDir, env })
      assert.equal(code, 0)
      assert.match(stdout.content, /r_room_1/)
      assert.equal(stdout.content.includes('r_room_2'), false)

      // Unknown room id
      await assert.rejects(
        async () => {
          await inspectCommand.run(['r_unknown'], {}, { stdout, stderr, cwd: tmpDir, env })
        },
        (err) => err.name === 'UserError' && err.message.includes('room r_unknown not found in the state snapshot')
      )
    })
  })

  describe('tailCommand', () => {
    it('21. Missing diagnostic file -> exit 1', async () => {
      const env = { ATOL_BOT_KEYSTORE: join(tmpDir, 'missing.keystore') }
      await assert.rejects(
        async () => {
          await tailCommand.run([], {}, { stdout, stderr, cwd: tmpDir, env })
        },
        (err) => err.name === 'UserError' && err.message.includes('diagnostic file not found')
      )
    })

    it('22, 23, 25, 27. Follows new lines, writes one JSON object per line, SIGINT stops follower', async () => {
      const keystorePath = join(tmpDir, 'bot.keystore')
      const diagPath = resolveDiagPath(keystorePath)
      writeFileSync(diagPath, '')

      const env = { ATOL_BOT_KEYSTORE: keystorePath }

      const runPromise = tailCommand.run([], {}, { stdout, stderr, cwd: tmpDir, env })

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Append new line
      writeFileSync(diagPath, JSON.stringify({ type: 'log', msg: 'tailed log 1' }) + '\n', { flag: 'a' })
      await new Promise((resolve) => setTimeout(resolve, 150))

      process.emit('SIGINT')
      const code = await runPromise

      assert.equal(code, 0)
      assert.match(stdout.content, /"msg":"tailed log 1"/)
    })

    it('24. --from-start delivers existing lines first', async () => {
      const keystorePath = join(tmpDir, 'bot.keystore')
      const diagPath = resolveDiagPath(keystorePath)
      writeFileSync(diagPath, JSON.stringify({ type: 'log', msg: 'old log line' }) + '\n')

      const env = { ATOL_BOT_KEYSTORE: keystorePath }

      const runPromise = tailCommand.run([], { 'from-start': true }, { stdout, stderr, cwd: tmpDir, env })

      await new Promise((resolve) => setTimeout(resolve, 100))

      process.emit('SIGINT')
      const code = await runPromise

      assert.equal(code, 0)
      assert.match(stdout.content, /"msg":"old log line"/)
    })

    it('26. A malformed line is skipped with a warning to stderr', async () => {
      const keystorePath = join(tmpDir, 'bot.keystore')
      const diagPath = resolveDiagPath(keystorePath)
      writeFileSync(diagPath, 'malformed line\n')

      const env = { ATOL_BOT_KEYSTORE: keystorePath }

      const runPromise = tailCommand.run([], { 'from-start': true }, { stdout, stderr, cwd: tmpDir, env })

      await new Promise((resolve) => setTimeout(resolve, 100))

      process.emit('SIGINT')
      await runPromise

      assert.match(stderr.content, /warning:/)
    })
  })
})
