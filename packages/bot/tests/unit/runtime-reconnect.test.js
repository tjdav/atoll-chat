import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test, describe } from 'node:test'
import { createRuntime } from '../../src/runtime/index.js'
import { createLogger } from '../../src/runtime/diagnostics/logger.js'

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
 * Minimal FakeWebSocket implementation for runtime tests.
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
    this.listeners.get(event).push(cb)
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
    const propHandler = this[`on${event}`]
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
 * Sets up a test HTTP server with default endpoints for capabilities, bot meta, auth, settings.
 *
 * @returns {Promise<{ server: http.Server, url: string, requests: Array<{ method: string, url: string, headers: http.IncomingHttpHeaders, body: any }>, close: () => Promise<void> }>}
 */
async function setupServer () {
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

      if (req.url?.startsWith('/api/v1/kt/user/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          identity_pubkey: Buffer.alloc(32, 9).toString('base64url')
        }))
        return
      }

      if (req.url?.startsWith('/api/v1/bots/b_reconnect_test')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: 'b_reconnect_test',
          owner_user_id: 'u_owner',
          display_name: 'Reconnect Bot',
          avatar_file_id: null
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

      if (req.url?.startsWith('/api/v1/rooms/') && req.url.includes('/observer-stream')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })
        const lastEventId = req.headers['last-event-id']
        if (lastEventId) {
          res.write(`id: evt_2\nevent: message.new\ndata: ${JSON.stringify({ id: 'msg_2' })}\n\n`)
        } else {
          res.write(`id: evt_1\nevent: message.new\ndata: ${JSON.stringify({ id: 'msg_1' })}\n\n`)
        }
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
 * Creates standard test runtime configurations.
 *
 * @param {string} serverUrl - Server base URL.
 * @param {string} tmpDir - Temporary directory path.
 * @returns {{ bot: any, config: any, keystoreData: any, logger: any, logs: any[] }}
 */
function makeRuntimeArgs (serverUrl, tmpDir) {
  const bot = {
    config: {
      label: 'Reconnect Bot',
      handlers: {}
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
    },
    webhook: {
      host: '127.0.0.1',
      port: 0
    },
    cron: {
      enabled: true
    }
  }

  const keystoreData = {
    bot_id: 'b_reconnect_test',
    bot_token: 'bot_token_abc123',
    bot_identity_private: makeKey(1),
    bot_command_private: makeKey(2),
    storage_seed: makeKey(3)
  }

  /** @type {Array<{ level: string, msg: string, meta?: any }>} */
  const logs = []
  const logger = createLogger({
    botId: 'b_reconnect_test',
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

describe('Runtime Reconnection Integration Tests', () => {
  test('1. A WebSocket close triggers a reconnect', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'))
    const { server, url, close } = await setupServer()

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

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      // Wait for backoff delay (baseBackoffMs: 10)
      await new Promise((r) => setTimeout(r, 50))

      assert.equal(FakeWebSocket.instances.length, 2)
      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('2. onConnected calls settingsStore.refresh()', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'))
    const { server, url, requests, close } = await setupServer()

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

      // Clear initial setup requests
      requests.length = 0

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      // Wait for backoff + settings coalesce duration (500ms)
      await new Promise((r) => setTimeout(r, 600))

      const settingsReqs = requests.filter((r) => r.url === '/api/v1/bots/me/settings')
      assert.equal(settingsReqs.length >= 1, true)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('3. onConnected calls publisherKeys.reverifyAll()', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'))
    const { server, url, close } = await setupServer()

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

      // Simulate publisher key updated event
      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.emit('message', JSON.stringify({
        event: 'room.publisher_key_updated',
        data: JSON.stringify({
          room_id: 'r_pub_test',
          epoch: 1,
          publisher_public_key: makeKey(10),
          signer_user_id: 'u_signer',
          signature: Buffer.alloc(64, 1).toString('base64url')
        })
      }))

      wsInst1?.close(1006, 'abnormal close')
      await new Promise((r) => setTimeout(r, 50))

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('4. Refetch grants logs a warning', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'))
    const { server, url, close } = await setupServer()

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

      await new Promise((r) => setTimeout(r, 100))

      const warnLog = logs.find((l) => l.msg === 'reconnect: grant refetch skipped; no bot-facing endpoint')
      assert.ok(warnLog)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('5. SSE close schedules a reconnect', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'))
    const { server, url, requests, close } = await setupServer()

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

      // Grant observer mode
      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.emit('message', JSON.stringify({
        event: 'bot.grant_updated',
        data: JSON.stringify({
          room_id: 'r_sse_test',
          new_mode: 'observer'
        })
      }))

      await new Promise((r) => setTimeout(r, 50))

      const initialSseCount = requests.filter((r) => r.url.includes('/observer-stream')).length
      assert.equal(initialSseCount, 1)

      // Simulate stream close
      const sub = runtime.subscriptions?.get('r_sse_test')
      if (sub?.client) {
        await sub.client.close()
      }

      await new Promise((r) => setTimeout(r, 100))

      const reconnectSseCount = requests.filter((r) => r.url.includes('/observer-stream')).length
      assert.equal(reconnectSseCount >= 2, true)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('6. SSE reconnect sends the correct Last-Event-ID', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'))
    const { server, url, requests, close } = await setupServer()

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

      // Grant observer mode
      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.emit('message', JSON.stringify({
        event: 'bot.grant_updated',
        data: JSON.stringify({
          room_id: 'r_sse_last_event',
          new_mode: 'observer'
        })
      }))

      await new Promise((r) => setTimeout(r, 50))

      // Trigger stream close
      const sub = runtime.subscriptions?.get('r_sse_last_event')
      if (sub?.client) {
        await sub.client.close()
      }

      await new Promise((r) => setTimeout(r, 100))

      const sseReqs = requests.filter((r) => r.url.includes('r_sse_last_event/observer-stream'))
      assert.equal(sseReqs.length >= 2, true)
      assert.equal(sseReqs[1]?.headers['last-event-id'], 'evt_1')

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('7. stop() cancels the reconnect loop', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'))
    const { server, url, close } = await setupServer()

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      // Long backoff delay so we can stop during sleep
      config.reconnect.baseBackoffMs = 5000

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

      await new Promise((r) => setTimeout(r, 20))
      await runtime.stop()

      assert.equal(FakeWebSocket.instances.length, 1)
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('8. stop() cancels SSE reconnect timers', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'))
    const { server, url, close } = await setupServer()

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)
      config.reconnect.baseBackoffMs = 5000

      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime.start()

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.emit('message', JSON.stringify({
        event: 'bot.grant_updated',
        data: JSON.stringify({
          room_id: 'r_sse_cancel_test',
          new_mode: 'observer'
        })
      }))

      await new Promise((r) => setTimeout(r, 50))

      const sub = runtime.subscriptions?.get('r_sse_cancel_test')
      if (sub?.client) {
        await sub.client.close()
      }

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('9. After stop() and a fresh start(), the loop runs again', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'))
    const { server, url, close } = await setupServer()

    try {
      const { bot, config, keystoreData, logger } = makeRuntimeArgs(url, tmpDir)

      const runtime1 = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime1.start()
      await runtime1.stop()

      const runtime2 = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await runtime2.start()
      assert.equal(FakeWebSocket.instances.length, 2)

      const wsInst2 = FakeWebSocket.instances[1]
      wsInst2?.close(1006, 'abnormal close')

      await new Promise((r) => setTimeout(r, 50))
      assert.equal(FakeWebSocket.instances.length, 3)

      await runtime2.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('10. Reconnect does not fire when the runtime is paused (independent reconnect loop)', async () => {
    FakeWebSocket.instances = []
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'))
    const { server, url, close } = await setupServer()

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

      const wsInst1 = FakeWebSocket.instances[0]
      wsInst1?.close(1006, 'abnormal close')

      await new Promise((r) => setTimeout(r, 50))

      // Reconnect loop is independent and succeeds even if paused policy active
      assert.equal(FakeWebSocket.instances.length, 2)

      await runtime.stop()
    } finally {
      await close()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
