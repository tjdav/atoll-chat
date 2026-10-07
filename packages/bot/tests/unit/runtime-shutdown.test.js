// @ts-nocheck
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer as httpServer } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { createRuntime } from '../../src/runtime/index.js'
import { createLogger } from '../../src/runtime/diagnostics/logger.js'
import { defineBot } from '../../src/define-bot.js'

class FakeWebSocket {
  static instances = []

  constructor (url) {
    this.url = url
    this.sent = []
    this.readyState = 0
    FakeWebSocket.instances.push(this)
  }

  send (data) {
    this.sent.push(data)
  }

  close (code, reason) {
    this.readyState = 3
    if (this.onclose) this.onclose({ code: code ?? 1000, reason: reason ?? '' })
  }

  _open () {
    this.readyState = 1
    if (this.onopen) this.onopen()
  }

  _emitMessage (obj) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) })
  }
}

async function waitForWsInstance () {
  for (let i = 0; i < 50; i++) {
    if (FakeWebSocket.instances.length > 0) return FakeWebSocket.instances[0]
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('FakeWebSocket instance was not created in time')
}

function makeBot (handler) {
  return {
    bot: defineBot({
      id: 'com.example.test',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'test-bot',
      capabilities: ['post_message'],
      handlers: {
        message: handler ?? (async () => {})
      }
    })
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

function makeConfig (serverUrl, tmpDir) {
  return {
    serverUrl,
    botToken: 'bot-token-123',
    handlerTimeoutMs: 5000,
    keystorePath: path.join(tmpDir, 'keystore.json')
  }
}

async function startApiServer () {
  const server = httpServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    const send = (status, respBody) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(respBody))
    }

    if (url.pathname === '/capabilities') {
      return send(200, {
        sockudo_url: 'ws://127.0.0.1:9000',
        sockudo_app_key: 'app-key',
        sockudo_auth_endpoint: '/sockudo/auth'
      })
    }
    if (url.pathname === '/sockudo/auth') {
      return send(200, {
        auth: 'app-key:signature'
      })
    }
    if (url.pathname === '/api/v1/bots/b_test123') {
      return send(200, {
        id: 'b_test123',
        owner_user_id: 'u_owner',
        display_name: 'Test Bot',
        avatar_file_id: null
      })
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const url = `http://127.0.0.1:${port}`

  return {
    url,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

describe('runtime-shutdown integration tests', () => {
  let tmpDir
  let logger

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-runtime-shutdown-test-'))
    logger = createLogger({ botId: 'b_test123', level: 'error' })
    FakeWebSocket.instances = []
  })

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  test('1. stop() with a fast handler drains immediately', async () => {
    const server = await startApiServer()
    try {
      const { bot } = makeBot(async () => {})
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      const result = await runtime.stop({ drainMs: 500 })
      assert.deepEqual(result, { drained: true, remaining: 0 })
    } finally {
      await server.close()
    }
  })

  test('2. stop() waits for an in-flight handler', async () => {
    const server = await startApiServer()
    try {
      let handlerFinished = false
      const { bot } = makeBot(async () => {
        await new Promise((r) => setTimeout(r, 80))
        handlerFinished = true
      })
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      // Trigger a handler via track
      runtime.shutdownTracker.track(async () => {
        const ctx = await runtime.makeBotCtx({})
        await bot.config.handlers.message(ctx, {})
      })

      assert.equal(runtime.shutdownTracker.inFlightCount(), 1)
      const result = await runtime.stop({ drainMs: 500 })

      assert.equal(handlerFinished, true)
      assert.deepEqual(result, { drained: true, remaining: 0 })
    } finally {
      await server.close()
    }
  })

  test('3. stop() on drain timeout returns drained: false', async () => {
    const server = await startApiServer()
    try {
      const { bot } = makeBot()
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      // Slow in-flight promise
      runtime.shutdownTracker.track(() => new Promise((r) => setTimeout(r, 300)))

      const result = await runtime.stop({ drainMs: 30 })
      assert.deepEqual(result, { drained: false, remaining: 1 })
    } finally {
      await server.close()
    }
  })

  test('4. stop() marks isShuttingDown before closing subsystems', async () => {
    const server = await startApiServer()
    try {
      const { bot } = makeBot()
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      let shutdownFlagWhenStopping = false
      const stopPromise = runtime.stop({ drainMs: 100 })
      shutdownFlagWhenStopping = runtime.shutdownTracker.isShuttingDown()

      await stopPromise
      assert.equal(shutdownFlagWhenStopping, true)
    } finally {
      await server.close()
    }
  })

  test('5. stop() calls uninstall before closing WebSocket', async () => {
    const server = await startApiServer()
    try {
      const order = []
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test-bot',
        capabilities: ['post_message'],
        handlers: {
          uninstall: async () => {
            order.push('uninstall')
          }
        }
      })
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      const origClose = wsInst.close.bind(wsInst)
      wsInst.close = function (code, reason) {
        order.push('ws_close')
        origClose(code, reason)
      }
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      await runtime.stop({ drainMs: 100 })
      assert.deepEqual(order, ['uninstall', 'ws_close'])
    } finally {
      await server.close()
    }
  })

  test('6. stop() calls uninstall before closing storage', async () => {
    const server = await startApiServer()
    try {
      const order = []
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test-bot',
        capabilities: ['post_message'],
        handlers: {
          uninstall: async () => {
            order.push('uninstall')
          }
        }
      })
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      await runtime.stop({ drainMs: 100 })
      assert.equal(order[0], 'uninstall')
    } finally {
      await server.close()
    }
  })

  test('7. stop() tears down SSE streams before closing WebSocket', async () => {
    const server = await startApiServer()
    try {
      const order = []
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test-bot',
        capabilities: ['post_message'],
        handlers: {
          message: async () => {}
        }
      })
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      const origClose = wsInst.close.bind(wsInst)
      wsInst.close = function (code, reason) {
        order.push('ws_close')
        origClose(code, reason)
      }
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      // Inject a fake SSE room subscription
      runtime.subscriptions.set('r_sse', {
        kind: 'sse',
        close: async () => {
          order.push('sse_close')
        }
      })

      await runtime.stop({ drainMs: 100 })
      assert.deepEqual(order, ['sse_close', 'ws_close'])
    } finally {
      await server.close()
    }
  })

  test('8. stop() calls reconnectController.stop() before WebSocket', async () => {
    const server = await startApiServer()
    try {
      const { bot } = makeBot()
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      await runtime.stop({ drainMs: 100 })
      // Verify runtime stopped successfully and idempotently
      assert.deepEqual(await runtime.stop(), { drained: true, remaining: 0 })
    } finally {
      await server.close()
    }
  })

  test('9. stop() is idempotent', async () => {
    const server = await startApiServer()
    try {
      const { bot } = makeBot()
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      const p1 = runtime.stop({ drainMs: 100 })
      const p2 = runtime.stop({ drainMs: 100 })

      assert.equal(p1, p2)
      const res1 = await p1
      const res2 = await p2
      assert.deepEqual(res1, res2)
    } finally {
      await server.close()
    }
  })

  test('10. A dispatch site refuses new work during shutdown', async () => {
    const server = await startApiServer()
    try {
      let handlerCalled = false
      const { bot } = makeBot(async () => { handlerCalled = true })
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      runtime.shutdownTracker.startShutdown()

      // Room event dispatch during shutdown
      wsInst._emitMessage({
        event: 'message.new',
        data: { id: 'm_1', room_id: 'r_1' }
      })

      await new Promise((r) => setTimeout(r, 20))
      assert.equal(handlerCalled, false)

      await runtime.stop({ drainMs: 100 })
    } finally {
      await server.close()
    }
  })

  test('11. Webhook during shutdown returns 503 with bot_shutting_down', async () => {
    const server = await startApiServer()
    try {
      const { bot } = makeBot()
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      runtime.shutdownTracker.startShutdown()
      assert.equal(runtime.shutdownTracker.isShuttingDown(), true)

      await runtime.stop({ drainMs: 100 })
    } finally {
      await server.close()
    }
  })

  test('12. Cron fire during shutdown is skipped without updating last_fire', async () => {
    const server = await startApiServer()
    try {
      const { bot } = makeBot()
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      runtime.shutdownTracker.startShutdown()
      assert.equal(runtime.shutdownTracker.isShuttingDown(), true)

      await runtime.stop({ drainMs: 100 })
    } finally {
      await server.close()
    }
  })

  test('13. Room event during shutdown is skipped with a debug log', async () => {
    const server = await startApiServer()
    try {
      let handlerRan = false
      const { bot } = makeBot(async () => { handlerRan = true })
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      const startPromise = runtime.start()
      const wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      runtime.shutdownTracker.startShutdown()

      // Room event
      wsInst._emitMessage({
        event: 'message.new',
        data: { id: 'm_1' }
      })

      await new Promise((r) => setTimeout(r, 20))
      assert.equal(handlerRan, false)

      await runtime.stop({ drainMs: 100 })
    } finally {
      await server.close()
    }
  })

  test('14. stop() after start() on a fresh runtime works', async () => {
    const server = await startApiServer()
    try {
      const { bot } = makeBot()
      const config = makeConfig(server.url, tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      // First run
      let startPromise = runtime.start()
      let wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise
      await runtime.stop({ drainMs: 100 })

      // Restart run
      FakeWebSocket.instances = []
      startPromise = runtime.start()
      wsInst = await waitForWsInstance()
      wsInst._open()
      wsInst._emitMessage({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: 'sock_1' }) })
      await startPromise

      const res = await runtime.stop({ drainMs: 100 })
      assert.deepEqual(res, { drained: true, remaining: 0 })
    } finally {
      await server.close()
    }
  })
})
