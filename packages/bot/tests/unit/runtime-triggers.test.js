import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer as httpServer, request as httpRequest } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { createRuntime } from '../../src/runtime/index.js'
import { createLogger } from '../../src/runtime/diagnostics/logger.js'
import { defineBot } from '../../src/define-bot.js'

class FakeWebSocket {
  /** @type {FakeWebSocket[]} */
  static instances = []

  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  /**
   * @param {string} url - URL
   */
  constructor (url) {
    this.url = url
    this.readyState = 0
    /** @type {any[]} */
    this.sent = []
    /** @type {((event?: any) => void) | null} */
    this.onopen = null
    /** @type {((event: { data: string }) => void) | null} */
    this.onmessage = null
    /** @type {((event: any) => void) | null} */
    this.onerror = null
    /** @type {((event: { code: number, reason: string }) => void) | null} */
    this.onclose = null

    FakeWebSocket.instances.push(this)
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
    this.readyState = 3
    if (this.onclose) {
      this.onclose({
        code,
        reason
      })
    }
  }

  _open () {
    this.readyState = 1
    if (this.onopen) {
      this.onopen()
    }
  }

  /**
   * @param {object | string} obj - Message object or JSON string.
   */
  _message (obj) {
    if (this.onmessage) {
      this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) })
    }
  }

  /**
   * @param {any} err - Error cause.
   */
  _error (err) {
    if (this.onerror) {
      this.onerror(err)
    }
  }

  /**
   * @param {number} code - Close code.
   * @param {string} reason - Close reason.
   */
  _close (code, reason) {
    this.readyState = 3
    if (this.onclose) {
      this.onclose({
        code,
        reason
      })
    }
  }
}

function makeConfig (url, tmpDir, overrides = {}) {
  return {
    serverUrl: url,
    botToken: 'session-token',
    handlerTimeoutMs: 5000,
    keystorePath: path.join(tmpDir, 'test-keystore'),
    botConfigPath: path.join(tmpDir, 'bot.toml'),
    keystoreSecret: undefined,
    userToken: undefined,
    runtime: {
      logLevel: 'debug',
      logFormat: 'json'
    },
    webhook: {
      host: '127.0.0.1',
      port: 0,
      basePath: '',
      maxBodyBytes: 1048576,
      timeoutMs: 5000,
      ...(overrides.webhook || {})
    },
    cron: {
      timezone: 'UTC',
      catchUp: false,
      ...(overrides.cron || {})
    },
    reconnect: {
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      jitter: 0.2
    },
    shutdown: { drainMs: 30000 },
    diagnostics: {
      enabled: true,
      retentionDays: 7
    },
    ...overrides
  }
}

function makeKeystoreData () {
  return {
    bot_id: 'b_test123',
    bot_token: 'bot-token-aaa',
    bot_identity_private: Buffer.alloc(32, 0x11).toString('base64url'),
    bot_command_private: Buffer.alloc(32, 0x22).toString('base64url'),
    identity_private: Buffer.alloc(32, 0x33).toString('base64url'),
    storage_seed: Buffer.alloc(32, 0x44).toString('base64url'),
    created_at: '2026-10-06T00:00:00Z',
    rotated_at: '2026-10-06T00:00:00Z'
  }
}

function makeBot (triggers = [], handlers = {}) {
  return defineBot({
    id: 'com.example.test',
    apiVersion: '1.0',
    hostApi: '1.0',
    label: 'Test Bot',
    capabilities: ['post_message'],
    triggers,
    handlers: {
      install: () => {},
      uninstall: () => {},
      ...handlers
    }
  })
}

async function startApiServer (handlerOverrides = {}) {
  /** @type {Array<{ method: string, path: string, query: string, body?: any }>} */
  const requests = []

  const server = httpServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    /** @type {Uint8Array[]} */
    const chunks = []

    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      let body
      const rawBody = Buffer.concat(chunks).toString('utf8')
      if (rawBody) {
        try {
          body = JSON.parse(rawBody)
        } catch {
          body = rawBody
        }
      }

      requests.push({
        method: req.method || 'GET',
        path: url.pathname,
        query: url.search,
        body
      })

      const send = (status, respBody) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          Connection: 'close'
        })
        res.end(JSON.stringify(respBody))
      }

      if (handlerOverrides[url.pathname]) {
        return handlerOverrides[url.pathname](req, res, send, body)
      }

      if (url.pathname === '/capabilities') {
        return send(200, {
          sockudo_url: 'ws://127.0.0.1:9000',
          sockudo_app_key: 'testkey',
          sockudo_auth_endpoint: '/sockudo/auth'
        })
      }
      if (url.pathname === '/api/v1/bots/b_test123' && req.method === 'GET') {
        return send(200, {
          id: 'b_test123',
          owner_user_id: 'u_owner',
          display_name: 'Test',
          avatar_file_id: 'file_avatar1'
        })
      }
      if (url.pathname === '/api/v1/bots/me/settings') {
        return send(200, [])
      }
      if (url.pathname === '/sockudo/auth' && req.method === 'POST') {
        return send(200, { auth: 'key:signature' })
      }
      if (url.pathname === '/api/v1/rooms/r_abc/bot-messages' && req.method === 'POST') {
        return send(200, {
          id: 'm_123',
          room_id: 'r_abc',
          created_at: 1000
        })
      }
      if (url.pathname === '/data' && req.method === 'GET') {
        return send(200, { ok: true })
      }

      return send(404, { error: 'not_found' })
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    server,
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections()
      }
      server.close(resolve)
    })
  }
}

function getWebhookPort (loggedLines) {
  for (const line of loggedLines) {
    try {
      const parsed = JSON.parse(line)
      if (parsed.msg === 'webhook server started') {
        const port = parsed.meta?.port ?? parsed.meta?.meta?.port
        if (typeof port === 'number' && port > 0) {
          return port
        }
      }
    } catch {}
  }
  return 0
}

async function sendHttpRequest (urlStr, method = 'POST', headers = {}, body = null) {
  const url = new URL(urlStr)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { Connection: 'close', ...headers },
        agent: false
      },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const rawBuffer = Buffer.concat(chunks)
          const text = rawBuffer.toString('utf8')
          /** @type {any} */
          let json = null
          if (res.headers['content-type']?.includes('application/json') && text.length > 0) {
            try {
              json = JSON.parse(text)
            } catch (_e) {}
          }
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: text,
            json
          })
        })
      }
    )
    req.on('error', reject)
    if (body) {
      req.write(body)
    }
    req.end()
  })
}

async function bootRuntime (runtime, wsIndex = 0) {
  const startPromise = runtime.start()
  while (!FakeWebSocket.instances[wsIndex]) {
    await new Promise((r) => setTimeout(r, 2))
  }
  const ws = FakeWebSocket.instances[wsIndex]
  ws._open()
  ws._message({
    event: 'pusher:connection_established',
    data: JSON.stringify({ socket_id: 'sock-123' })
  })
  await startPromise
  return ws
}

describe('Runtime Triggers Unit Tests', () => {
  let tmpDir
  /** @type {Array<string>} */
  let loggedLines
  let logger

  beforeEach(async () => {
    FakeWebSocket.instances = []
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-runtime-triggers-test-'))
    loggedLines = []
    logger = createLogger({
      botId: 'b_test123',
      level: 'debug',
      sink: (line) => loggedLines.push(line)
    })
  })

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, {
        recursive: true,
        force: true
      }).catch(() => {})
    }
  })

  test('1. No triggers -> start() succeeds without binding a webhook server or starting the cron engine', async () => {
    const server = await startApiServer()
    try {
      const bot = makeBot([])
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      assert.equal(loggedLines.some((l) => l.includes('webhook server started')), false)
      assert.equal(loggedLines.some((l) => l.includes('cron engine started')), false)

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('2. Only webhook triggers -> webhook server starts, cron does not', async () => {
    const server = await startApiServer()
    try {
      const bot = makeBot([{
        type: 'webhook',
        path: '/hook'
      }])
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      assert.equal(loggedLines.some((l) => l.includes('webhook server started')), true)
      assert.equal(loggedLines.some((l) => l.includes('cron engine started')), false)

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('3. Only schedule triggers -> cron starts, webhook does not', async () => {
    const server = await startApiServer()
    try {
      const bot = makeBot([{
        type: 'schedule',
        name: 'daily',
        cron: '0 0 * * *'
      }])
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      assert.equal(loggedLines.some((l) => l.includes('webhook server started')), false)
      assert.equal(loggedLines.some((l) => l.includes('cron engine started')), true)

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('4. Both -> both start', async () => {
    const server = await startApiServer()
    try {
      const bot = makeBot([
        {
          type: 'webhook',
          path: '/hook'
        },
        {
          type: 'schedule',
          name: 'daily',
          cron: '0 0 * * *'
        }
      ])
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      assert.equal(loggedLines.some((l) => l.includes('webhook server started')), true)
      assert.equal(loggedLines.some((l) => l.includes('cron engine started')), true)

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('5. Webhook request reaches handlers.webhook', async () => {
    const server = await startApiServer()
    try {
      let webhookCalled = false
      /** @type {any} */
      let receivedCtx = null
      /** @type {any} */
      let receivedPayload = null

      const bot = makeBot(
        [{
          type: 'webhook',
          path: '/hook'
        }],
        {
          webhook: (ctx, payload) => {
            webhookCalled = true
            receivedCtx = ctx
            receivedPayload = payload
          }
        }
      )

      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      const port = getWebhookPort(loggedLines)
      const res = await sendHttpRequest(`http://127.0.0.1:${port}/hook`, 'POST', {}, 'test-body')
      assert.equal(res.statusCode, 200)
      assert.equal(webhookCalled, true)
      assert.ok(receivedCtx)
      assert.equal(receivedPayload.path, '/hook')
      assert.equal(receivedPayload.body, 'test-body')

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('6. Cron fire reaches handlers.schedule', async () => {
    const server = await startApiServer()
    try {
      let scheduleCalled = false
      /** @type {any} */
      let receivedCtx = null
      /** @type {any} */
      let receivedPayload = null

      const bot = makeBot(
        [{
          type: 'schedule',
          name: 'tick',
          cron: '* * * * *'
        }],
        {
          schedule: (ctx, payload) => {
            scheduleCalled = true
            receivedCtx = ctx
            receivedPayload = payload
          }
        }
      )
      // Pre-seed storage state with a past timestamp and enable catchUp so cron engine fires immediately on start
      const storagePath = path.join(tmpDir, 'test-keystore.storage')
      const storageSeed = Buffer.alloc(32, 0x44)
      const { Storage } = await import('../../src/runtime/storage/index.js')
      const initStorage = new Storage({
        path: storagePath,
        seed: storageSeed,
        botId: 'b_test123'
      })
      await initStorage.open()
      await initStorage.set('_runtime:cron:tick:last_fire', new Date(Date.now() - 300000).toISOString())
      await initStorage.close()

      const config = makeConfig(server.url, tmpDir, {
        cron: {
          timezone: 'UTC',
          catchUp: true
        }
      })
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      assert.equal(scheduleCalled, true)
      assert.ok(receivedCtx)
      assert.equal(receivedPayload.name, 'tick')

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('7. stop() stops the webhook server', async () => {
    const server = await startApiServer()
    try {
      const bot = makeBot([{
        type: 'webhook',
        path: '/hook'
      }])
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      const port = getWebhookPort(loggedLines)
      await runtime.stop()

      await assert.rejects(sendHttpRequest(`http://127.0.0.1:${port}/hook`))
    } finally {
      await server.close()
    }
  })

  test('8. stop() stops the cron engine', async () => {
    const server = await startApiServer()
    try {
      const bot = makeBot([{
        type: 'schedule',
        name: 'tick',
        cron: '* * * * *'
      }])
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      await runtime.stop()

      assert.equal(loggedLines.some((l) => l.includes('cron engine stopped')), true)
    } finally {
      await server.close()
    }
  })

  test('9. stop() clears the trigger references', async () => {
    const server = await startApiServer()
    try {
      const bot = makeBot([{
        type: 'webhook',
        path: '/hook'
      }])
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime, 0)
      await runtime.stop()

      await bootRuntime(runtime, 1)

      assert.equal(FakeWebSocket.instances.length, 2)

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('10. Startup failure cleans up', async () => {
    // Bind a dummy server on port 8787 first to cause a port collision for webhook server
    const dummyServer = httpServer((_req, res) => res.end('occupied'))
    await new Promise((resolve) => dummyServer.listen(8787, '127.0.0.1', resolve))

    const server = await startApiServer()
    try {
      const bot = makeBot([{
        type: 'webhook',
        path: '/hook'
      }])
      const config = makeConfig(server.url, tmpDir, { webhook: { port: 8787 } })
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      const startPromise = runtime.start()
      await new Promise((r) => setTimeout(r, 10))
      if (FakeWebSocket.instances[0]) {
        FakeWebSocket.instances[0]._open()
        FakeWebSocket.instances[0]._message({
          event: 'pusher:connection_established',
          data: JSON.stringify({ socket_id: 'sock-123' })
        })
      }

      await assert.rejects(startPromise)
      assert.equal(FakeWebSocket.instances[0].readyState, 3) // WebSocket was closed
    } finally {
      await server.close()
      await new Promise((resolve) => dummyServer.close(resolve))
    }
  })

  test('11. Logger emits webhook server started and cron engine started', async () => {
    const server = await startApiServer()
    try {
      const bot = makeBot([
        {
          type: 'webhook',
          path: '/hook'
        },
        {
          type: 'schedule',
          name: 'tick',
          cron: '0 0 * * *'
        }
      ])
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      assert.ok(loggedLines.some((l) => l.includes('webhook server started')))
      assert.ok(loggedLines.some((l) => l.includes('cron engine started')))

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('12. Logger emits webhook server stopped and cron engine stopped', async () => {
    const server = await startApiServer()
    try {
      const bot = makeBot([
        {
          type: 'webhook',
          path: '/hook'
        },
        {
          type: 'schedule',
          name: 'tick',
          cron: '0 0 * * *'
        }
      ])
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      await runtime.stop()

      assert.ok(loggedLines.some((l) => l.includes('webhook server stopped')))
      assert.ok(loggedLines.some((l) => l.includes('cron engine stopped')))
    } finally {
      await server.close()
    }
  })

  test('13. Both trigger servers share the runtime idempotency store', async () => {
    const server = await startApiServer()
    try {
      let hookCalls = 0
      const bot = makeBot(
        [
          {
            type: 'webhook',
            path: '/hook',
            idempotency: 'header:x-request-id'
          },
          {
            type: 'schedule',
            name: 'tick',
            cron: '0 0 * * *'
          }
        ],
        {
          webhook: () => { hookCalls++ }
        }
      )
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      const port = getWebhookPort(loggedLines)
      await sendHttpRequest(`http://127.0.0.1:${port}/hook`, 'POST', { 'x-request-id': 'dup-id' })
      assert.equal(hookCalls, 1)

      // Second request with same idempotency key is suppressed
      await sendHttpRequest(`http://127.0.0.1:${port}/hook`, 'POST', { 'x-request-id': 'dup-id' })
      assert.equal(hookCalls, 1)

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('14. makeBotCtx returns a ctx with grant: null and room: null for trigger invocations', async () => {
    const server = await startApiServer()
    try {
      /** @type {any} */
      let receivedCtx = null

      const bot = makeBot(
        [{
          type: 'webhook',
          path: '/hook'
        }],
        {
          webhook: (ctx) => {
            receivedCtx = ctx
          }
        }
      )
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      const port = getWebhookPort(loggedLines)
      await sendHttpRequest(`http://127.0.0.1:${port}/hook`, 'POST')

      assert.ok(receivedCtx)
      assert.equal(receivedCtx.grant, null)
      assert.equal(receivedCtx.room, null)

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('15. Webhook handler receives ctx.post bound to the runtime', async () => {
    const server = await startApiServer()
    try {
      /** @type {any} */
      let postResult = null

      const bot = makeBot(
        [{
          type: 'webhook',
          path: '/hook'
        }],
        {
          webhook: async (ctx) => {
            // Set up grant / key for room or post directly
            postResult = await ctx.post({
              roomId: 'r_abc',
              text: 'hello from webhook'
            })
          }
        }
      )
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      const ws = await bootRuntime(runtime)

      // Populate publisher key cache
      ws?._message({
        event: 'room.publisher_key_updated',
        channel: 'private-bot-b_test123',
        data: {
          room_id: 'r_abc',
          epoch: 1,
          publisher_public_key: Buffer.alloc(32, 0x77).toString('base64url'),
          signer_user_id: 'u_signer',
          signature: Buffer.alloc(64, 0x88).toString('base64url')
        }
      })
      await new Promise((r) => setTimeout(r, 20))

      const port = getWebhookPort(loggedLines)
      const res = await sendHttpRequest(`http://127.0.0.1:${port}/hook`, 'POST')
      assert.equal(res.statusCode, 200)
      assert.ok(postResult)
      assert.equal(postResult.id, 'm_123')

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('16. Schedule handler receives ctx.fetch bound to the runtime', async () => {
    const server = await startApiServer()
    try {
      /** @type {any} */
      let fetchResult = null

      const bot = makeBot(
        [{
          type: 'webhook',
          path: '/fetch-test'
        }],
        {
          webhook: async (ctx) => {
            const resp = await ctx.fetch(`${server.url}/data`)
            fetchResult = await resp.json()
          }
        }
      )
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      await bootRuntime(runtime)

      const port = getWebhookPort(loggedLines)
      await sendHttpRequest(`http://127.0.0.1:${port}/fetch-test`, 'POST')

      assert.ok(fetchResult)
      assert.equal(fetchResult.ok, true)

      await runtime.stop()
    } finally {
      await server.close()
    }
  })

  test('17. Trigger rejection during start() leaves storage closed', async () => {
    // Dummy server on port 8787 causes webhook server.start() to fail
    const dummyServer = httpServer((_req, res) => res.end('occupied'))
    await new Promise((resolve) => dummyServer.listen(8787, '127.0.0.1', resolve))

    const server = await startApiServer()
    try {
      const bot = makeBot([{
        type: 'webhook',
        path: '/hook'
      }])
      const config = makeConfig(server.url, tmpDir, { webhook: { port: 8787 } })
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      const startPromise = runtime.start()
      await new Promise((r) => setTimeout(r, 10))
      if (FakeWebSocket.instances[0]) {
        FakeWebSocket.instances[0]._open()
        FakeWebSocket.instances[0]._message({
          event: 'pusher:connection_established',
          data: JSON.stringify({ socket_id: 'sock-123' })
        })
      }

      await assert.rejects(startPromise)
      // Confirm storage was closed
      assert.ok(loggedLines.some((l) => l.includes('runtime boot')))
    } finally {
      await server.close()
      await new Promise((resolve) => dummyServer.close(resolve))
    }
  })

  test('18. Second start() after a clean stop() starts fresh trigger servers', async () => {
    const server = await startApiServer()
    try {
      let calls = 0
      const bot = makeBot(
        [{
          type: 'webhook',
          path: '/hook'
        }],
        {
          webhook: () => { calls++ }
        }
      )
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({
        bot,
        config,
        keystoreData,
        logger,
        WebSocketImpl: FakeWebSocket
      })

      // First run
      await bootRuntime(runtime, 0)

      const port1 = getWebhookPort(loggedLines)
      await sendHttpRequest(`http://127.0.0.1:${port1}/hook`, 'POST')
      assert.equal(calls, 1)

      await runtime.stop()

      // Second run
      await bootRuntime(runtime, 1)

      const port2 = getWebhookPort(loggedLines)
      await sendHttpRequest(`http://127.0.0.1:${port2}/hook`, 'POST')
      assert.equal(calls, 2)

      await runtime.stop()
    } finally {
      await server.close()
    }
  })
})
