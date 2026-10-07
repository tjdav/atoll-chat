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
  /** @type {FakeWebSocket[]} */
  static instances = []

  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  constructor (url) {
    this.url = url
    /** @type {any[]} */
    this.sent = []
    this.readyState = 0
    /** @type {Function | null} */
    this.onopen = null
    /** @type {Function | null} */
    this.onmessage = null
    /** @type {Function | null} */
    this.onerror = null
    /** @type {Function | null} */
    this.onclose = null
    /** @type {Record<string, Function[]>} */
    this.listeners = {}
    FakeWebSocket.instances.push(this)
  }

  send (data) {
    this.sent.push(data)
  }

  close (code = 1000, reason = '') {
    this.readyState = 3
    if (this.onclose) {
      this.onclose({ code, reason })
    }
    const listenerList = this.listeners.close || []
    for (const listener of listenerList) {
      listener({ code, reason })
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
    if (this.onopen) {
      this.onopen()
    }
    const listenerList = this.listeners.open || []
    for (const listener of listenerList) {
      listener()
    }
  }

  _message (obj) {
    const payload = typeof obj === 'string' ? obj : JSON.stringify(obj)
    if (this.onmessage) {
      this.onmessage({ data: payload })
    }
    const listenerList = this.listeners.message || []
    for (const listener of listenerList) {
      listener({ data: payload })
    }
  }
}

/** @type {any} */
const WSImpl = FakeWebSocket

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

function makeBot (handlers = {}) {
  const effectiveHandlers = {
    install: () => {},
    ...handlers
  }
  return defineBot({
    id: 'com.example.test',
    apiVersion: '1.0',
    hostApi: '1.0',
    label: 'Test Bot',
    capabilities: ['post_message'],
    handlers: effectiveHandlers
  })
}

async function startApiServer (handlerOverrides = {}) {
  /** @type {Array<{ method: string, path: string, query: string, body?: any }>} */
  const requests = []
  /** @type {Record<string, any>} */
  const sseStreams = {}

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
      if (url.pathname === '/sockudo/auth' && req.method === 'POST') {
        return send(200, { auth: 'key:signature' })
      }

      if (url.pathname.endsWith('/observer-stream')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })
        res.flushHeaders()
        sseStreams[url.pathname] = {
          res,
          writeEvent: (event, data, id) => {
            if (id) res.write(`id: ${id}\n`)
            if (event) res.write(`event: ${event}\n`)
            res.write(`data: ${JSON.stringify(data)}\n\n`)
          },
          close: () => res.end()
        }
        return
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
    sseStreams,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

async function bootRuntime (runtime) {
  const startPromise = runtime.start()
  let wsInst = FakeWebSocket.instances[0]
  while (!wsInst) {
    await new Promise((r) => setTimeout(r, 5))
    wsInst = FakeWebSocket.instances[0]
  }
  wsInst._open()
  wsInst._message({
    event: 'pusher:connection_established',
    data: { socket_id: 's_1' }
  })
  await startPromise
  return wsInst
}

describe('Runtime Room Subscriptions Unit Tests', () => {
  let tmpDir
  /** @type {Array<string>} */
  let loggedLines
  let logger

  beforeEach(async () => {
    FakeWebSocket.instances = []
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-runtime-rooms-test-'))
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

  // Subscription lifecycle (1-8)
  describe('Subscription Lifecycle', () => {
    test('1. Grant to member mode opens a WebSocket room channel', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })

        await new Promise((r) => setTimeout(r, 20))

        assert.ok(wsInst.sent.some((m) => {
          const parsed = JSON.parse(m)
          return parsed.event === 'pusher:subscribe' && parsed.data?.channel === 'private-room-r_abc'
        }))

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('2. Grant to observer mode opens an SSE stream', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })

        await new Promise((r) => setTimeout(r, 30))

        assert.ok(server.requests.some((r) => r.path === '/api/v1/rooms/r_abc/observer-stream'))

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('3. Grant to write_only opens no subscription', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'write_only', scopes: ['post_message'] }
        })

        await new Promise((r) => setTimeout(r, 20))

        assert.equal(runtime.subscriptions.has('r_abc'), false)
        assert.ok(!server.requests.some((r) => r.path === '/api/v1/rooms/r_abc/observer-stream'))

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('4. Grant from member to observer closes the WebSocket channel and opens an SSE stream', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        assert.ok(wsInst.sent.some((m) => {
          const parsed = JSON.parse(m)
          return parsed.event === 'pusher:unsubscribe' && parsed.data?.channel === 'private-room-r_abc'
        }))
        assert.equal(runtime.subscriptions.get('r_abc')?.kind, 'sse')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('5. Grant from member to write_only closes the WebSocket channel', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'write_only', scopes: ['post_message'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.equal(runtime.subscriptions.has('r_abc'), false)

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('6. Grant from observer to member closes the SSE stream and opens a WebSocket channel', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        assert.equal(runtime.subscriptions.get('r_abc')?.kind, 'websocket')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('7. Same-mode grant update is a no-op', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        const countSubscribesBefore = wsInst.sent.filter((m) => JSON.parse(m).event === 'pusher:subscribe' && JSON.parse(m).data?.channel === 'private-room-r_abc').length

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages', 'post_message'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        const countSubscribesAfter = wsInst.sent.filter((m) => JSON.parse(m).event === 'pusher:subscribe' && JSON.parse(m).data?.channel === 'private-room-r_abc').length
        assert.equal(countSubscribesBefore, countSubscribesAfter)

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('8. bot.revoked tears down the subscription', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'bot.revoked',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.equal(runtime.subscriptions.has('r_abc'), false)

        await runtime.stop()
      } finally {
        await server.close()
      }
    })
  })

  // Message dispatch — member mode (9-13)
  describe('Message Dispatch — Member Mode', () => {
    test('9. A message.new event dispatches to handlers.message', async () => {
      const server = await startApiServer()
      try {
        let receivedCtx, receivedEvt
        const bot = makeBot({
          message: (ctx, evt) => {
            receivedCtx = ctx
            receivedEvt = evt
          }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'message.new',
          channel: 'private-room-r_abc',
          data: { id: 'm_1', room_id: 'r_abc', sender_id: 'u_user1', sender_client_id: 'c_client1', created_at: '2026-10-06T12:00:00Z' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.ok(receivedEvt)
        assert.equal(receivedEvt.type, 'message.new')
        assert.equal(receivedEvt.roomId, 'r_abc')
        assert.equal(receivedCtx.grant?.mode, 'member')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('10. Member-mode data has plaintext: null and attachments: []', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          message: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'message.new',
          channel: 'private-room-r_abc',
          data: { id: 'm_1', room_id: 'r_abc' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.equal(receivedEvt.data.plaintext, null)
        assert.deepEqual(receivedEvt.data.attachments, [])

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('11. Member-mode data carries senderUserId, senderClientId, createdAt, replyTo from raw payload', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          message: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'message.new',
          channel: 'private-room-r_abc',
          data: {
            id: 'm_1',
            room_id: 'r_abc',
            sender_id: 'u_user1',
            sender_client_id: 'c_client1',
            created_at: '2026-10-06T12:00:00Z',
            reply_to: 'm_0'
          }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.equal(receivedEvt.data.senderUserId, 'u_user1')
        assert.equal(receivedEvt.data.senderClientId, 'c_client1')
        assert.equal(receivedEvt.data.createdAt, '2026-10-06T12:00:00Z')
        assert.equal(receivedEvt.data.replyTo, 'm_0')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('12. A message.edited event dispatches with type === message.edited', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          message: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'message.edited',
          channel: 'private-room-r_abc',
          data: { id: 'm_edit1', edit_of: 'm_orig1', room_id: 'r_abc' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.equal(receivedEvt.type, 'message.edited')
        assert.equal(receivedEvt.data.id, 'm_edit1')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('13. A message.deleted event dispatches with type === message.deleted and data.id set', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          message: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'message.deleted',
          channel: 'private-room-r_abc',
          data: { id: 'm_del1', room_id: 'r_abc' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.equal(receivedEvt.type, 'message.deleted')
        assert.equal(receivedEvt.data.id, 'm_del1')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })
  })

  // Message dispatch — observer mode (14-17)
  describe('Message Dispatch — Observer Mode', () => {
    test('14. An SSE message.new event dispatches to handlers.message', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          message: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        const stream = server.sseStreams['/api/v1/rooms/r_abc/observer-stream']
        assert.ok(stream)
        stream.writeEvent('message.new', { id: 'm_sse1', sender_user_id: 'u_obs1', size_bytes: 100 })

        await new Promise((r) => setTimeout(r, 30))

        assert.ok(receivedEvt)
        assert.equal(receivedEvt.type, 'message.new')
        assert.equal(receivedEvt.roomId, 'r_abc')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('15. Observer-mode data has sizeBytes and no plaintext', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          message: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        const stream = server.sseStreams['/api/v1/rooms/r_abc/observer-stream']
        stream.writeEvent('message.new', { id: 'm_sse1', size_bytes: 250 })

        await new Promise((r) => setTimeout(r, 30))

        assert.equal(receivedEvt.data.sizeBytes, 250)
        assert.equal(receivedEvt.data.plaintext, undefined)

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('16. Observer-mode data carries senderUserId, senderClientId, createdAt from SSE payload', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          message: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        const stream = server.sseStreams['/api/v1/rooms/r_abc/observer-stream']
        stream.writeEvent('message.new', {
          id: 'm_sse1',
          sender_user_id: 'u_user1',
          sender_client_id: 'c_client1',
          created_at: '2026-10-06T12:00:00Z',
          size_bytes: 250
        })

        await new Promise((r) => setTimeout(r, 30))

        assert.equal(receivedEvt.data.senderUserId, 'u_user1')
        assert.equal(receivedEvt.data.senderClientId, 'c_client1')
        assert.equal(receivedEvt.data.createdAt, '2026-10-06T12:00:00Z')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('17. The MessageEvent carries the correct roomId', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          message: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        const stream = server.sseStreams['/api/v1/rooms/r_abc/observer-stream']
        stream.writeEvent('message.new', { id: 'm_sse1' })

        await new Promise((r) => setTimeout(r, 30))

        assert.equal(receivedEvt.roomId, 'r_abc')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })
  })

  // Room event dispatch (18-21)
  describe('Room Event Dispatch', () => {
    test('18. A room.member_added event on the WebSocket dispatches to handlers.room', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          room: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'room.member_added',
          channel: 'private-room-r_abc',
          data: { room_id: 'r_abc', user_id: 'u_new' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.ok(receivedEvt)
        assert.equal(receivedEvt.type, 'room.member_added')
        assert.equal(receivedEvt.data.user_id, 'u_new')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('19. A room.updated event on the WebSocket dispatches with raw data', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          room: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'room.updated',
          channel: 'private-room-r_abc',
          data: { room_id: 'r_abc', name: 'New Name' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.equal(receivedEvt.type, 'room.updated')
        assert.equal(receivedEvt.data.name, 'New Name')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('20. A room.member_removed event on the SSE stream dispatches to handlers.room', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          room: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        const stream = server.sseStreams['/api/v1/rooms/r_abc/observer-stream']
        stream.writeEvent('room.member_removed', { room_id: 'r_abc', user_id: 'u_left' })

        await new Promise((r) => setTimeout(r, 30))

        assert.ok(receivedEvt)
        assert.equal(receivedEvt.type, 'room.member_removed')
        assert.equal(receivedEvt.data.user_id, 'u_left')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('21. A room.updated event on the SSE stream dispatches with raw data', async () => {
      const server = await startApiServer()
      try {
        let receivedEvt
        const bot = makeBot({
          room: (_ctx, evt) => { receivedEvt = evt }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        const stream = server.sseStreams['/api/v1/rooms/r_abc/observer-stream']
        stream.writeEvent('room.updated', { room_id: 'r_abc', topic: 'New Topic' })

        await new Promise((r) => setTimeout(r, 30))

        assert.equal(receivedEvt.type, 'room.updated')
        assert.equal(receivedEvt.data.topic, 'New Topic')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })
  })

  // Handler errors & missing handlers (22-23)
  describe('Handler Errors & Edge Cases', () => {
    test('22. A handler throw does not propagate', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot({
          message: () => {
            throw new Error('Handler crash!')
          }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'message.new',
          channel: 'private-room-r_abc',
          data: { id: 'm_1' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.ok(loggedLines.some((l) => l.includes('room event dispatch failed')))

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('23. A missing handler is a no-op', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot() // No message handler defined
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'message.new',
          channel: 'private-room-r_abc',
          data: { id: 'm_1' }
        })
        await new Promise((r) => setTimeout(r, 20))

        // No throw, no crash

        await runtime.stop()
      } finally {
        await server.close()
      }
    })
  })

  // makeBotCtx assertions (24-26)
  describe('makeBotCtx Integration', () => {
    test('24. The ctx for a room event has the correct grant', async () => {
      const server = await startApiServer()
      try {
        let receivedCtx
        const bot = makeBot({
          message: (ctx) => { receivedCtx = ctx }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'message.new',
          channel: 'private-room-r_abc',
          data: { id: 'm_1' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.equal(receivedCtx.grant?.mode, 'member')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('25. The ctx has the correct room id in event.roomId', async () => {
      const server = await startApiServer()
      try {
        let receivedCtx
        const bot = makeBot({
          message: (ctx) => { receivedCtx = ctx }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'message.new',
          channel: 'private-room-r_abc',
          data: { id: 'm_1' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.equal(receivedCtx.event?.roomId, 'r_abc')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('26. The ctx has the correct event.type', async () => {
      const server = await startApiServer()
      try {
        let receivedCtx
        const bot = makeBot({
          message: (ctx) => { receivedCtx = ctx }
        })
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        wsInst._message({
          event: 'message.new',
          channel: 'private-room-r_abc',
          data: { id: 'm_1' }
        })
        await new Promise((r) => setTimeout(r, 20))

        assert.equal(receivedCtx.event?.type, 'message.new')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })
  })

  // Teardown (27-29)
  describe('Teardown Order & Cleanup', () => {
    test('27. stop() closes every SSE stream', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        assert.equal(runtime.subscriptions.size, 1)

        await runtime.stop()

        assert.equal(runtime.subscriptions.size, 0)
      } finally {
        await server.close()
      }
    })

    test('28. stop() unsubscribes every WebSocket room channel', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        await runtime.stop()

        assert.ok(wsInst.sent.some((m) => {
          const parsed = JSON.parse(m)
          return parsed.event === 'pusher:unsubscribe' && parsed.data?.channel === 'private-room-r_abc'
        }))
      } finally {
        await server.close()
      }
    })

    test('29. stop() order is SSE first, then WebSocket', async () => {
      const server = await startApiServer()
      try {
        const order = []
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_obs', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        const sseClient = runtime.subscriptions.get('r_obs')?.client
        if (sseClient) {
          const originalClose = sseClient.close
          sseClient.close = async () => {
            order.push('sse_close')
            return originalClose.call(sseClient)
          }
        }

        const originalWsClose = wsInst.close
        wsInst.close = (code, reason) => {
          order.push('ws_close')
          return originalWsClose.call(wsInst, code, reason)
        }

        await runtime.stop()

        assert.deepEqual(order, ['sse_close', 'ws_close'])
      } finally {
        await server.close()
      }
    })
  })

  // Reconnect-adjacent (30-31)
  describe('Registry Inspector Properties for Reconnect Task', () => {
    test('30. The SSE client is stored in the registry with kind: sse', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'observer', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 30))

        const sub = runtime.subscriptions.get('r_abc')
        assert.ok(sub)
        assert.equal(sub.kind, 'sse')
        assert.ok(sub.client)
        assert.equal(typeof sub.client.getLastEventId, 'function')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })

    test('31. The WebSocket client subscription is stored with kind: websocket', async () => {
      const server = await startApiServer()
      try {
        const bot = makeBot()
        const config = makeConfig(server.url, tmpDir)
        const keystoreData = makeKeystoreData()
        const runtime = createRuntime({ bot, config, keystoreData, logger, WebSocketImpl: WSImpl })

        const wsInst = await bootRuntime(runtime)

        wsInst._message({
          event: 'bot.grant_updated',
          channel: 'private-bot-b_test123',
          data: { room_id: 'r_abc', new_mode: 'member', scopes: ['read_messages'] }
        })
        await new Promise((r) => setTimeout(r, 20))

        const sub = runtime.subscriptions.get('r_abc')
        assert.ok(sub)
        assert.equal(sub.kind, 'websocket')

        await runtime.stop()
      } finally {
        await server.close()
      }
    })
  })
})
