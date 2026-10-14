import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test, describe } from 'node:test'
import { createRuntime } from '../../src/runtime/index.js'
import { createLogger } from '../../src/runtime/diagnostics/logger.js'
import { encrypt, generateEphemeralKeypair, keyObjectFromX25519Private } from '../../src/runtime/crypto/command-result.js'
import { COMMAND_INFO } from '../../src/runtime/context/command-invoked.js'

/**
 * Creates a base64url encoded 32-byte key.
 *
 * @param {number} byteVal - Byte fill value.
 * @returns {string} Base64url key.
 */
function makeKey (byteVal) {
  return Buffer.alloc(32, byteVal).toString('base64url')
}

/**
 * Minimal FakeWebSocket implementation for sync tests.
 */
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  /**
   * @param {string} url - WebSocket URL.
   */
  constructor (url) {
    this.url = url
    this.readyState = FakeWebSocket.CONNECTING
    this.listeners = new Map()
    this.sent = []
    FakeWebSocket.instances.push(this)

    setImmediate(() => {
      this.readyState = FakeWebSocket.OPEN
      this.emit('open')
      this.emit('message', JSON.stringify({
        event: 'pusher:connection_established',
        data: JSON.stringify({ socket_id: '123.456' })
      }))
    })
  }

  /** @type {FakeWebSocket[]} */
  static instances = []

  /**
   * @param {string} event - Event name.
   * @param {Function} cb - Listener callback.
   */
  addEventListener (event, cb) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    const list = this.listeners.get(event)
    if (list) {
      list.push(cb)
    }
  }

  /**
   * @param {string} event - Event name.
   * @param {Function} cb - Listener callback.
   */
  removeEventListener (event, cb) {
    const list = this.listeners.get(event)
    if (list) {
      const idx = list.indexOf(cb)
      if (idx !== -1) list.splice(idx, 1)
    }
  }

  /**
   * @param {string} event - Event name.
   * @param {any} [data] - Event payload.
   */
  emit (event, data) {
    const list = this.listeners.get(event) ?? []
    for (const cb of list) {
      cb({ data })
    }
    const propHandler =
      /** @type {any} */
      (this)[`on${event}`]
    if (typeof propHandler === 'function') {
      propHandler({ data })
    }
  }

  /**
   * @param {string} data - Payload string.
   */
  send (data) {
    this.sent.push(data)
  }

  /**
   * @param {number} [code=1000] - Close code.
   * @param {string} [reason=''] - Close reason.
   */
  close (code = 1000, reason = '') {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', { code, reason })
  }
}

/**
 * Sets up a test HTTP server with customizable endpoint behaviors.
 *
 * @param {object} [options]
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => boolean | undefined} [options.handleSync] - Custom sync handler.
 * @returns {Promise<{ server: http.Server, url: string, requests: Array<{ method: string, url: string, headers: http.IncomingHttpHeaders, body: any }>, close: () => Promise<void> }>}
 */
async function setupServer (options = {}) {
  /** @type {Array<{ method: string, url: string, headers: http.IncomingHttpHeaders, body: any }>} */
  const requests = []

  const server = http.createServer((req, res) => {
    /** @type {Buffer[]} */
    const bodyChunks = []
    req.on('data', (c) => bodyChunks.push(c))
    req.on('end', () => {
      const bodyStr = Buffer.concat(bodyChunks).toString('utf8')
      let bodyObj = null
      try {
        bodyObj = JSON.parse(bodyStr)
      } catch {
        bodyObj = bodyStr
      }

      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body: bodyObj
      })

      if (req.url === '/capabilities') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          sockudo_url: 'ws://127.0.0.1:6001',
          sockudo_app_key: 'testappkey',
          sockudo_auth_endpoint: '/api/v1/sockudo/auth'
        }))
        return
      }

      if (req.url?.startsWith('/api/v1/bots/b_sync_test')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: 'b_sync_test',
          owner_user_id: 'u_owner',
          display_name: 'Sync Bot',
          avatar_file_id: null
        }))
        return
      }

      if (req.url?.startsWith('/api/v1/bots/me/sync')) {
        if (options.handleSync) {
          const handled = options.handleSync(req, res)
          if (handled !== false) {
            return
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          events: [],
          max_bot_seq: 0,
          full_resync_required: false
        }))
        return
      }

      if (req.url === '/api/v1/sockudo/auth') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ auth: 'testappkey:signature' }))
        return
      }

      if (req.url === '/api/v1/bots/me/settings') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([]))
        return
      }

      if (req.url?.startsWith('/api/v1/bots/me/commands/') && req.url.endsWith('/ack')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      if (req.url === '/api/v1/bots/me/pause') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  const url = `http://127.0.0.1:${port}`

  return {
    server,
    url,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

/**
 * Creates standard test runtime arguments.
 *
 * @param {string} serverUrl - Server base URL.
 * @param {string} tmpDir - Temporary directory path.
 * @param {object} [botHandlers] - Bot handlers.
 * @param {Record<string, any>} [botCommands] - Bot commands.
 * @returns {{ bot: any, config: any, keystoreData: any, logger: any, logs: any[] }}
 */
function makeRuntimeArgs (serverUrl, tmpDir, botHandlers = {}, botCommands = {}) {
  const bot = {
    config: {
      label: 'Sync Bot',
      handlers: botHandlers,
      commands: botCommands
    }
  }

  const config = {
    serverUrl,
    botToken: 'bot_token_abc123',
    keystorePath: path.join(tmpDir, 'test.keystore'),
    handlerTimeoutMs: 5000,
    reconnect: {
      baseBackoffMs: 10,
      maxBackoffMs: 50,
      jitter: 0
    }
  }

  const keystoreData = {
    bot_id: 'b_sync_test',
    bot_token: 'bot_token_abc123',
    bot_identity_private: makeKey(1),
    bot_command_private: makeKey(2),
    storage_seed: makeKey(3)
  }

  /** @type {Array<{ level: string, msg: string, meta?: any }>} */
  const logs = []
  const logger = createLogger({
    botId: 'b_sync_test',
    level: 'debug',
    sink: (line) => {
      try {
        logs.push(JSON.parse(line))
      } catch {
        // Ignore unparseable
      }
    }
  })

  return { bot, config, keystoreData, logger, logs }
}

describe('Bot Channel Sync Integration Tests', () => {
  test('1. Boot calls /bots/me/sync?since_bot_seq=0', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
    const { url, requests, close } = await setupServer()

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()

      const syncReqs = requests.filter((r) => r.url.includes('/bots/me/sync'))
      assert.equal(syncReqs.length, 1)
      assert.equal(syncReqs[0]?.url, '/api/v1/bots/me/sync?since_bot_seq=0')

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('2. Boot dispatches returned events in order', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          events: [
            {
              event_type: 'bot.updated',
              payload: { bot_seq: 1, name: 'first' }
            },
            {
              event_type: 'bot.updated',
              payload: { bot_seq: 2, name: 'second' }
            },
            {
              event_type: 'bot.updated',
              payload: { bot_seq: 3, name: 'third' }
            }
          ],
          max_bot_seq: 3,
          full_resync_required: false
        }))
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger, logs } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()

      const eventLogs = logs.filter((l) => l.msg === 'event dispatched')
      assert.equal(eventLogs.length, 3)
      assert.equal(runtime.getBotSeq?.(), 3)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('3. Boot advances the cursor to max_bot_seq', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          events: [],
          max_bot_seq: 15,
          full_resync_required: false
        }))
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(runtime.getBotSeq?.(), 15)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('4. Boot proceeds to WebSocket connection after sync', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
    const { url, close } = await setupServer()

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(FakeWebSocket.instances.length, 1)
      assert.equal(FakeWebSocket.instances[0]?.readyState, FakeWebSocket.OPEN)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('5. Sync failure does not block boot', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_request' }))
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger, logs } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(FakeWebSocket.instances.length, 1)

      const warnLog = logs.find((l) => l.msg === 'initial bot channel sync failed')
      assert.ok(warnLog)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('6. Reconnect calls sync with the current cursor', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))

    const { url, requests, close } = await setupServer({
      handleSync: (req, res) => {
        const u = new URL(req.url ?? '/', 'http://127.0.0.1')
        const since = u.searchParams.get('since_bot_seq')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          events: [],
          max_bot_seq: since === '0' ? 5 : Number(since),
          full_resync_required: false
        }))
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(runtime.getBotSeq?.(), 5)

      // Trigger WebSocket close to prompt reconnect
      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      await new Promise((r) => setTimeout(r, 60))

      const syncReqs = requests.filter((r) => r.url.includes('/bots/me/sync'))
      assert.equal(syncReqs.length >= 2, true)
      assert.equal(syncReqs[1]?.url, '/api/v1/bots/me/sync?since_bot_seq=5')

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('7. Reconnect dispatches the replayed events', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
    let syncCallCount = 0

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        syncCallCount++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (syncCallCount === 1) {
          res.end(JSON.stringify({ events: [], max_bot_seq: 0, full_resync_required: false }))
        } else {
          res.end(JSON.stringify({
            events: [
              { event_type: 'bot.updated', payload: { bot_seq: 1, replayed: true } }
            ],
            max_bot_seq: 1,
            full_resync_required: false
          }))
        }
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger, logs } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      const initialLogsCount = logs.filter((l) => l.msg === 'event dispatched').length
      assert.equal(initialLogsCount, 0)

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      await new Promise((r) => setTimeout(r, 60))

      const replayedLogsCount = logs.filter((l) => l.msg === 'event dispatched').length
      assert.equal(replayedLogsCount, 1)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('8. Reconnect advances the cursor', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
    let syncCallCount = 0

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        syncCallCount++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (syncCallCount === 1) {
          res.end(JSON.stringify({ events: [], max_bot_seq: 2, full_resync_required: false }))
        } else {
          res.end(JSON.stringify({ events: [], max_bot_seq: 10, full_resync_required: false }))
        }
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(runtime.getBotSeq?.(), 2)

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      await new Promise((r) => setTimeout(r, 60))
      assert.equal(runtime.getBotSeq?.(), 10)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('9. Reconnect orders sync before settings refresh', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))

    const { url, requests, close } = await setupServer()

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      requests.length = 0

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      await new Promise((r) => setTimeout(r, 600))

      const syncIdx = requests.findIndex((r) => r.url.includes('/bots/me/sync'))
      const settingsIdx = requests.findIndex((r) => r.url === '/api/v1/bots/me/settings')

      assert.ok(syncIdx >= 0)
      assert.ok(settingsIdx >= 0)
      assert.ok(syncIdx < settingsIdx)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('10. Reconnect on a fresh runtime uses cursor 0', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))

    const { url, requests, close } = await setupServer()

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(runtime.getBotSeq?.(), 0)

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      await new Promise((r) => setTimeout(r, 60))

      const syncReqs = requests.filter((r) => r.url.includes('/bots/me/sync'))
      assert.equal(syncReqs.length >= 2, true)
      assert.equal(syncReqs[0]?.url, '/api/v1/bots/me/sync?since_bot_seq=0')
      assert.equal(syncReqs[1]?.url, '/api/v1/bots/me/sync?since_bot_seq=0')

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('11. A full_resync_required response triggers a second call with since_bot_seq=0', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
    let syncCallCount = 0

    const { url, requests, close } = await setupServer({
      handleSync: (req, res) => {
        syncCallCount++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (syncCallCount === 1) {
          res.end(JSON.stringify({ events: [], max_bot_seq: 10, full_resync_required: false }))
        } else if (syncCallCount === 2) {
          res.end(JSON.stringify({ events: [], max_bot_seq: 10, full_resync_required: true }))
        } else {
          res.end(JSON.stringify({ events: [], max_bot_seq: 20, full_resync_required: false }))
        }
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(runtime.getBotSeq?.(), 10)

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      await new Promise((r) => setTimeout(r, 60))

      const syncReqs = requests.filter((r) => r.url.includes('/bots/me/sync'))
      assert.equal(syncReqs.length, 3)
      assert.equal(syncReqs[1]?.url, '/api/v1/bots/me/sync?since_bot_seq=10')
      assert.equal(syncReqs[2]?.url, '/api/v1/bots/me/sync?since_bot_seq=0')

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('12. The second call\'s events are dispatched', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
    let syncCallCount = 0

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        syncCallCount++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (syncCallCount === 1) {
          res.end(JSON.stringify({ events: [], max_bot_seq: 5, full_resync_required: false }))
        } else if (syncCallCount === 2) {
          res.end(JSON.stringify({ events: [], max_bot_seq: 5, full_resync_required: true }))
        } else {
          res.end(JSON.stringify({
            events: [{ event_type: 'bot.updated', payload: { bot_seq: 1, full_resync_event: true } }],
            max_bot_seq: 1,
            full_resync_required: false
          }))
        }
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger, logs } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      await new Promise((r) => setTimeout(r, 60))

      const eventLogs = logs.filter((l) => l.msg === 'event dispatched')
      assert.equal(eventLogs.length, 1)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('13. The cursor is reset before the second call', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
    let syncCallCount = 0

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        syncCallCount++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (syncCallCount === 1) {
          res.end(JSON.stringify({ events: [], max_bot_seq: 10, full_resync_required: false }))
        } else if (syncCallCount === 2) {
          res.end(JSON.stringify({ events: [], max_bot_seq: 10, full_resync_required: true }))
        } else {
          res.end(JSON.stringify({ events: [], max_bot_seq: 2, full_resync_required: false }))
        }
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(runtime.getBotSeq?.(), 10)

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      await new Promise((r) => setTimeout(r, 60))
      assert.equal(runtime.getBotSeq?.(), 2)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('14. full_resync_required at since_bot_seq=0 is a no-op', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))

    const { url, requests, close } = await setupServer({
      handleSync: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          events: [{ event_type: 'bot.updated', payload: { bot_seq: 1 } }],
          max_bot_seq: 1,
          full_resync_required: true
        }))
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()

      const syncReqs = requests.filter((r) => r.url.includes('/bots/me/sync'))
      assert.equal(syncReqs.length, 1)
      assert.equal(runtime.getBotSeq?.(), 1)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('15. A live event with bot_seq updates the cursor', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
    const { url, close } = await setupServer()

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(runtime.getBotSeq?.(), 0)

      const wsInst = FakeWebSocket.instances[0]
      wsInst?.emit('message', JSON.stringify({
        event: 'bot.updated',
        data: JSON.stringify({ bot_seq: 7 })
      }))

      await new Promise((r) => setTimeout(r, 20))
      assert.equal(runtime.getBotSeq?.(), 7)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('16. A live event without bot_seq does not change the cursor', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
    const { url, close } = await setupServer()

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()

      const wsInst = FakeWebSocket.instances[0]
      wsInst?.emit('message', JSON.stringify({
        event: 'bot.updated',
        data: JSON.stringify({ name: 'no_bot_seq' })
      }))

      await new Promise((r) => setTimeout(r, 20))
      assert.equal(runtime.getBotSeq?.(), 0)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('17. Live and sync events interleave correctly', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))
    let syncCallCount = 0

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        syncCallCount++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (syncCallCount === 1) {
          res.end(JSON.stringify({ events: [], max_bot_seq: 3, full_resync_required: false }))
        } else {
          res.end(JSON.stringify({
            events: [
              { event_type: 'bot.updated', payload: { bot_seq: 5 } }
            ],
            max_bot_seq: 6,
            full_resync_required: false
          }))
        }
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(runtime.getBotSeq?.(), 3)

      const wsInst = FakeWebSocket.instances[0]
      wsInst?.emit('message', JSON.stringify({
        event: 'bot.updated',
        data: JSON.stringify({ bot_seq: 4 })
      }))

      await new Promise((r) => setTimeout(r, 20))
      assert.equal(runtime.getBotSeq?.(), 4)

      wsInst?.close(1006, 'abnormal close')
      await new Promise((r) => setTimeout(r, 60))

      assert.equal(runtime.getBotSeq?.(), 6)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('18. A duplicate command event delivered twice by the sync is dispatched once', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          events: [
            {
              event_type: 'bot.command_invoked',
              payload: {
                command_id: 'cmd_dup_123',
                room_id: 'r_1',
                sender_user_id: 'u_1',
                sender_client_id: 'c_1',
                ciphertext: 'invalid_ct_for_fast_fail',
                bot_seq: 1
              }
            },
            {
              event_type: 'bot.command_invoked',
              payload: {
                command_id: 'cmd_dup_123',
                room_id: 'r_1',
                sender_user_id: 'u_1',
                sender_client_id: 'c_1',
                ciphertext: 'invalid_ct_for_fast_fail',
                bot_seq: 2
              }
            }
          ],
          max_bot_seq: 2,
          full_resync_required: false
        }))
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger, logs } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()

      const dupLogs = logs.filter((l) => l.msg === 'command_invoked duplicate skipped')
      assert.equal(dupLogs.length, 1)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('19. An unknown event type in the sync response is logged and skipped', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          events: [
            { event_type: 'bot.unknown_custom_event', payload: { bot_seq: 4 } }
          ],
          max_bot_seq: 4,
          full_resync_required: false
        }))
        return true
      }
    })

    try {
      const { bot, config, keystoreData, logger, logs } = makeRuntimeArgs(url, tmpDir)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()

      const warnLog = logs.find((l) => l.msg === 'unknown bot channel event')
      assert.ok(warnLog)
      assert.equal(runtime.getBotSeq?.(), 4)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('20. The snapshot state includes the current bot_seq', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-test-'))

    const { url, close } = await setupServer({
      handleSync: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          events: [],
          max_bot_seq: 42,
          full_resync_required: false
        }))
        return true
      }
    })

    try {
      const botCommands = {
        failcmd: {
          args: {},
          handler: () => {
            throw new Error('deliberate_failure')
          }
        }
      }

      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir, {}, botCommands)
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()
      assert.equal(runtime.getBotSeq?.(), 42)

      // Derive the bot's X25519 public key from bot_command_private scalar
      const botCmdPrivKey = Buffer.from(keystoreData.bot_command_private, 'base64url')
      const botCmdPubKeyKo = crypto.createPublicKey(keyObjectFromX25519Private(botCmdPrivKey))
      const botCmdPubKeyDer = botCmdPubKeyKo.export({ format: 'der', type: 'spki' })
      const botCmdPubKey = new Uint8Array(botCmdPubKeyDer.subarray(12))

      const invokerEphemeral = generateEphemeralKeypair()

      for (let i = 0; i < 3; i++) {
        const plaintext = Buffer.from(JSON.stringify({
          command_name: 'failcmd',
          args: {},
          ephemeral_result_pubkey: Buffer.from(invokerEphemeral.publicKey).toString('base64url')
        }), 'utf8')

        const ciphertextBytes = encrypt({
          privateKey: invokerEphemeral.privateKey,
          peerPublicKey: botCmdPubKey,
          info: COMMAND_INFO,
          plaintext
        })

        const wireCt = Buffer.concat([invokerEphemeral.publicKey, ciphertextBytes]).toString('base64url')

        const wsInst = FakeWebSocket.instances[0]
        wsInst?.emit('message', JSON.stringify({
          event: 'bot.command_invoked',
          data: JSON.stringify({
            command_id: `cmd_fail_${i}`,
            room_id: 'r_1',
            sender_user_id: 'u_1',
            sender_client_id: 'c_1',
            ciphertext: wireCt
          })
        }))
      }

      await new Promise((r) => setTimeout(r, 200))

      const diagFile = `${config.keystorePath}.diag.jsonl`
      const diagContent = await fs.readFile(diagFile, 'utf8')
      const lines = diagContent.trim().split('\n').map((l) => JSON.parse(l))
      const snapshotLine = lines.find((l) => l.type === 'snapshot')

      assert.ok(snapshotLine)
      assert.equal(snapshotLine.state?.bot_seq, 42)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
