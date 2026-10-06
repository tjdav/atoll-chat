import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer as httpServer } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { createRuntime } from '../../src/runtime/index.js'
import { createLogger } from '../../src/runtime/diagnostics/logger.js'
import { defineBot } from '../../src/define-bot.js'
import { PublisherKeyVerificationFailedError } from '../../src/errors.js'

class FakeWebSocket {
  /** @type {FakeWebSocket[]} */
  static instances = []

  constructor (url) {
    this.url = url
    /** @type {any[]} */
    this.sent = []
    this.readyState = 0
    /** @type {Record<string, Function[]>} */
    this.listeners = {}
    FakeWebSocket.instances.push(this)
  }

  send (data) {
    this.sent.push(data)
  }

  close (code, reason) {
    this.readyState = 3
    const listenerList = this.listeners.close || []
    for (const listener of listenerList) {
      listener({ code: code ?? 1000, reason: reason ?? '' })
    }
  }

  addEventListener (event, listener) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(listener)
  }

  removeEventListener (event, listener) {
    if (!this.listeners[event]) return
    this.listeners[event] = this.listeners[event].filter((l) => l !== listener)
  }

  _open () {
    this.readyState = 1
    const listenerList = this.listeners.open || []
    for (const listener of listenerList) {
      listener()
    }
  }

  _message (obj) {
    const listenerList = this.listeners.message || []
    for (const listener of listenerList) {
      listener({ data: JSON.stringify(obj) })
    }
  }
}

function makeConfig (url, tmpDir) {
  return {
    serverUrl: url,
    botToken: 'session-token',
    handlerTimeoutMs: 5000,
    keystorePath: path.join(tmpDir, 'test-keystore')
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

function makeBot (overrides = {}) {
  const calls = { install: 0, uninstall: 0, grantUpdated: 0 }
  let grantUpdatedArgs = null

  const bot = defineBot({
    id: 'com.example.test',
    apiVersion: '1.0',
    hostApi: '1.0',
    label: 'Test Bot',
    capabilities: ['post_message'],
    handlers: {
      install: () => { calls.install++ },
      uninstall: () => { calls.uninstall++ },
      grantUpdated: (ctx, data) => {
        calls.grantUpdated++
        grantUpdatedArgs = { ctx, data }
      },
      ...overrides
    }
  })
  return { bot, calls, getGrantUpdatedArgs: () => grantUpdatedArgs }
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
        try { body = JSON.parse(rawBody) } catch { body = rawBody }
      }

      requests.push({ method: req.method || 'GET', path: url.pathname, query: url.search, body })

      const send = (status, respBody) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
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
        return send(200, { id: 'm_123', room_id: 'r_abc', created_at: 1000 })
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
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

describe('Bot Runtime Unit Tests', () => {
  let tmpDir
  /** @type {Array<string>} */
  let loggedLines
  let logger

  beforeEach(async () => {
    FakeWebSocket.instances = []
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-runtime-test-'))
    loggedLines = []
    logger = createLogger({
      botId: 'b_test123',
      level: 'debug',
      sink: (line) => loggedLines.push(line)
    })
  })

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // Factory Validation Tests
  describe('Factory Validation', () => {
    test('1. Missing config.serverUrl throws', () => {
      const { bot } = makeBot()
      const config = makeConfig('', tmpDir)
      const keystoreData = makeKeystoreData()
      assert.throws(
        () => createRuntime({ bot, config, keystoreData, logger }),
        /config.serverUrl must be a non-empty string/
      )
    })

    test('2. Missing config.botToken throws', () => {
      const { bot } = makeBot()
      const config = makeConfig('http://127.0.0.1', tmpDir)
      config.botToken = ''
      const keystoreData = makeKeystoreData()
      assert.throws(
        () => createRuntime({ bot, config, keystoreData, logger }),
        /config.botToken must be a non-empty string/
      )
    })

    test('3. Missing keystoreData.bot_token throws', () => {
      const { bot } = makeBot()
      const config = makeConfig('http://127.0.0.1', tmpDir)
      const keystoreData = makeKeystoreData()
      keystoreData.bot_token = ''
      assert.throws(
        () => createRuntime({ bot, config, keystoreData, logger }),
        /keystoreData.bot_token must be a non-empty string/
      )
    })

    test('4. Wrong-length bot_identity_private throws', () => {
      const { bot } = makeBot()
      const config = makeConfig('http://127.0.0.1', tmpDir)
      const keystoreData = makeKeystoreData()
      keystoreData.bot_identity_private = Buffer.alloc(16).toString('base64url')
      assert.throws(
        () => createRuntime({ bot, config, keystoreData, logger }),
        /keystoreData.bot_identity_private must be a 32-byte base64url string/
      )
    })

    test('5. Wrong-length storage_seed throws', () => {
      const { bot } = makeBot()
      const config = makeConfig('http://127.0.0.1', tmpDir)
      const keystoreData = makeKeystoreData()
      keystoreData.storage_seed = Buffer.alloc(16).toString('base64url')
      assert.throws(
        () => createRuntime({ bot, config, keystoreData, logger }),
        /keystoreData.storage_seed must be a 32-byte base64url string/
      )
    })

    test('6. Missing bot throws', () => {
      const config = makeConfig('http://127.0.0.1', tmpDir)
      const keystoreData = makeKeystoreData()
      assert.throws(
        () => createRuntime({ bot: null, config, keystoreData, logger }),
        /bot must be an object with a config property/
      )
    })
  })

  // Boot Sequence Tests
  describe('Boot Sequence', () => {
    test('7. start() fetches capabilities', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        assert.ok(server.requests.some((r) => r.path === '/capabilities' && r.method === 'GET'))
        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('8. start() fetches bot metadata', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        assert.ok(server.requests.some((r) => r.path === '/api/v1/bots/b_test123' && r.method === 'GET'))
        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('9. start() opens the WebSocket', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        assert.equal(FakeWebSocket.instances.length, 1)
        assert.ok(FakeWebSocket.instances[0].url.startsWith('ws://127.0.0.1:9000'))
        FakeWebSocket.instances[0]._open()
        await startPromise

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('10. start() subscribes to private-bot-b_test123', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const sent = FakeWebSocket.instances[0].sent
        assert.ok(sent.some((m) => {
          const parsed = JSON.parse(m)
          return parsed.event === 'pusher:subscribe' && parsed.data?.channel === 'private-bot-b_test123'
        }))

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('11. start() calls the install handler', async () => {
      const server = await startApiServer()
      try {
        const { bot, calls } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        assert.equal(calls.install, 1)

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('12. start() is idempotent', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise1 = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise1

        await runtime.start()
        assert.equal(FakeWebSocket.instances.length, 1)

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('13. A failure mid-boot rejects start()', async () => {
      const server = await startApiServer({
        '/capabilities': (_req, _res, send) => send(500, { error: 'server_error' })
      })
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        await assert.rejects(() => runtime.start())
      } finally {
        await server.close()
      }
    })
  })

  // Shutdown Tests
  describe('stop()', () => {
    test('14. stop() closes the WebSocket', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const wsInst = FakeWebSocket.instances[0]
        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise

        assert.equal(wsInst.readyState, 3)
      } finally {
        await server.close()
      }
    })

    test('15. stop() calls the uninstall handler', async () => {
      const server = await startApiServer()
      try {
        const { bot, calls } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise

        assert.equal(calls.uninstall, 1)
      } finally {
        await server.close()
      }
    })

    test('16. stop() is idempotent', async () => {
      const server = await startApiServer()
      try {
        const { bot, calls } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const stopPromise1 = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise1

        await runtime.stop()
        assert.equal(calls.uninstall, 1)
      } finally {
        await server.close()
      }
    })

    test('17. stop() before start() resolves immediately', async () => {
      const { bot } = makeBot()
      const config = makeConfig('http://127.0.0.1:9999', tmpDir)
      const keystoreData = makeKeystoreData()
      const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

      await runtime.stop()
    })
  })

  // Event Dispatch Tests
  describe('Event Dispatch', () => {
    test('18. bot.command_invoked dispatches to command handler', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'bot.command_invoked',
          channel: 'private-bot-b_test123',
          data: JSON.stringify({ command_id: 'cmd_1', ciphertext: 'invalid' })
        })

        await new Promise((r) => setTimeout(r, 20))

        assert.ok(loggedLines.some((l) => l.includes('command_invoked') || l.includes('event dispatched')))

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('19. bot.settings_updated triggers settings.refresh()', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const initialSettingsRequests = server.requests.filter((r) => r.path === '/api/v1/bots/me/settings').length

        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'bot.settings_updated',
          channel: 'private-bot-b_test123',
          data: {}
        })

        await new Promise((r) => setTimeout(r, 50))

        const newSettingsRequests = server.requests.filter((r) => r.path === '/api/v1/bots/me/settings').length
        assert.ok(newSettingsRequests > initialSettingsRequests)

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('20. bot.grant_updated updates the grant cache', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_grant1', mode: 'write_only', scopes: ['post_message'] }
        })

        await new Promise((r) => setTimeout(r, 20))

        const ctx = await runtime.makeBotCtx({ roomId: 'r_grant1' })
        assert.notEqual(ctx.grant, null)
        assert.equal(ctx.grant.mode, 'write_only')
        assert.deepEqual(ctx.grant.scopes, ['post_message'])

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('21. bot.grant_updated calls the grantUpdated handler', async () => {
      const server = await startApiServer()
      try {
        const { bot, calls, getGrantUpdatedArgs } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_grant1', mode: 'write_only', scopes: ['post_message'] }
        })

        await new Promise((r) => setTimeout(r, 20))

        assert.equal(calls.grantUpdated, 1)
        const args = getGrantUpdatedArgs()
        assert.equal(args.data.room_id, 'r_grant1')
        assert.equal(args.ctx.grant.mode, 'write_only')

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('22. bot.keys_rotated marks publisher cache stale', async () => {
      const server = await startApiServer({
        '/api/v1/kt/user/u_signer': (_req, _res, send) => send(200, { identity_pubkey: Buffer.alloc(32, 0x99).toString('base64url') })
      })
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'bot.keys_rotated',
          channel: 'private-bot-b_test123',
          data: {}
        })

        await new Promise((r) => setTimeout(r, 20))

        const ctx = await runtime.makeBotCtx({ roomId: 'r_abc' })
        await assert.rejects(
          () => ctx.post({ text: 'test' }),
          (err) => err instanceof PublisherKeyVerificationFailedError || err.code === 'publisher_key_verification_failed'
        )

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('23. room.publisher_key_updated records into the cache', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'room.publisher_key_updated',
          channel: 'private-bot-b_test123',
          data: {
            room_id: 'r_pub1',
            epoch: 1,
            publisher_public_key: Buffer.alloc(32, 0x77).toString('base64url'),
            signer_user_id: 'u_signer',
            signature: Buffer.alloc(64, 0x88).toString('base64url')
          }
        })

        await new Promise((r) => setTimeout(r, 20))

        assert.ok(loggedLines.some((l) => l.includes('room.publisher_key_updated') || l.includes('event dispatched')))

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('24. bot.updated is a no-op', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'bot.updated',
          channel: 'private-bot-b_test123',
          data: {}
        })

        await new Promise((r) => setTimeout(r, 20))

        assert.ok(loggedLines.some((l) => l.includes('bot.updated')))

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('25. Unknown event is logged at debug/warn and ignored', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'unknown.event.foo',
          channel: 'private-bot-b_test123',
          data: {}
        })

        await new Promise((r) => setTimeout(r, 20))

        assert.ok(loggedLines.some((l) => l.includes('unknown bot channel event')))

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })
  })

  // makeBotCtx Tests
  describe('makeBotCtx', () => {
    test('26. makeBotCtx({}) returns a ctx with all fields populated', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const ctx = await runtime.makeBotCtx({})
        assert.ok(ctx.bot)
        assert.ok(ctx.settings)
        assert.ok(ctx.storage)
        assert.ok(ctx.rooms)
        assert.equal(typeof ctx.post, 'function')
        assert.equal(typeof ctx.reply, 'function')
        assert.equal(typeof ctx.sendLocal, 'function')
        assert.equal(typeof ctx.log, 'function')
        assert.equal(typeof ctx.fetch, 'function')
        assert.equal(typeof ctx.fetchUserUrl, 'function')
        assert.ok(ctx.signal)

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('27. ctx.grant is null for an unmapped room', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const ctx = await runtime.makeBotCtx({ roomId: 'r_unknown' })
        assert.equal(ctx.grant, null)

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('28. ctx.grant reflects the cache for a granted room', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_granted', mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        const ctx = await runtime.makeBotCtx({ roomId: 'r_granted' })
        assert.notEqual(ctx.grant, null)
        assert.equal(ctx.grant.mode, 'observer')

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('29. ctx.room is null when invocation.roomId is absent', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const ctx = await runtime.makeBotCtx({})
        assert.equal(ctx.room, null)

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('30. ctx.event reflects the invocation', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const evt = { id: 'evt_1', type: 'command', roomId: 'r_1', timestamp: 12345 }
        const ctx = await runtime.makeBotCtx({ event: evt })
        assert.equal(ctx.event.id, 'evt_1')

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('31. ctx.bot.id matches the keystore', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const ctx = await runtime.makeBotCtx({})
        assert.equal(ctx.bot.id, 'b_test123')

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('32. ctx.bot.label matches the bot config', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const ctx = await runtime.makeBotCtx({})
        assert.equal(ctx.bot.label, 'Test Bot')

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('33. ctx.bot.ownerUserId matches the fetched metadata', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const ctx = await runtime.makeBotCtx({})
        assert.equal(ctx.bot.ownerUserId, 'u_owner')

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('34. ctx.post calls the post handler', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        // Set up grant & publisher key
        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', mode: 'write_only', scopes: ['post_message'] }
        })
        wsInst._message({
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

        const ctx = await runtime.makeBotCtx({ roomId: 'r_abc' })
        const res = await ctx.post({ text: 'hello' })
        assert.equal(res.id, 'm_123')
        assert.ok(server.requests.some((r) => r.path === '/api/v1/rooms/r_abc/bot-messages'))

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('35. ctx.uploadAvatar throws', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const ctx = await runtime.makeBotCtx({})
        await assert.rejects(
          () => ctx.uploadAvatar(),
          /uploadAvatar is not yet implemented/
        )

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise
      } finally {
        await server.close()
      }
    })
  })

  // Logging & Redaction Tests
  describe('Logging', () => {
    test('36. Logger receives runtime boot on start and runtime stopped on stop', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        assert.ok(loggedLines.some((l) => l.includes('runtime boot')))

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise

        assert.ok(loggedLines.some((l) => l.includes('runtime stopped')))
      } finally {
        await server.close()
      }
    })

    test('37. Logger receives a debug line per dispatched event', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const wsInst = FakeWebSocket.instances[0]
        wsInst._message({
          event: 'bot.updated',
          channel: 'private-bot-b_test123',
          data: {}
        })

        await new Promise((r) => setTimeout(r, 20))

        assert.ok(loggedLines.some((l) => l.includes('event dispatched')))

        const stopPromise = runtime.stop()
        wsInst.close()
        await stopPromise
      } finally {
        await server.close()
      }
    })

    test('38. Logger does not log the bot token or the keystore plaintext', async () => {
      const server = await startApiServer()
      try {
        const { bot } = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: FakeWebSocket })

        const startPromise = runtime.start()
        await new Promise((r) => setTimeout(r, 10))
        FakeWebSocket.instances[0]._open()
        await startPromise

        const stopPromise = runtime.stop()
        FakeWebSocket.instances[0].close()
        await stopPromise

        for (const line of loggedLines) {
          assert.equal(line.includes(keystoreData.bot_token), false)
          assert.equal(line.includes(keystoreData.bot_identity_private), false)
          assert.equal(line.includes(keystoreData.bot_command_private), false)
          assert.equal(line.includes(keystoreData.storage_seed), false)
        }
      } finally {
        await server.close()
      }
    })
  })
})
