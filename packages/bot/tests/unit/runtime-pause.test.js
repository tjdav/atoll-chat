import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../../src/runtime/index.js'
import { createLogger } from '../../src/runtime/diagnostics/logger.js'

/**
 * Creates a base64url encoded 32-byte key.
 *
 * @param {number} byteVal
 * @returns {string}
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

  static instances = []

  addEventListener (event, cb) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(cb)
  }

  removeEventListener (event, cb) {
    const list = this.listeners.get(event)
    if (list) {
      const idx = list.indexOf(cb)
      if (idx !== -1) list.splice(idx, 1)
    }
  }

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

  send (data) {
    this.sent.push(data)
  }

  close (code = 1000, reason = '') {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', { code, reason })
  }
}

/**
 * Sets up a test HTTP server with default endpoints for capabilities, bot meta, auth, pause.
 */
async function setupServer () {
  const requests = []
  const server = http.createServer((req, res) => {
    let bodyChunks = []
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
        method: req.method,
        url: req.url,
        body: bodyObj
      })

      if (req.url === '/capabilities') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          sockudo_url: 'ws://localhost:9999',
          sockudo_app_key: 'test-app-key',
          sockudo_auth_endpoint: '/api/v1/broadcasting/auth'
        }))
        return
      }

      if (req.url === '/api/v1/bots/bot_123') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          owner_user_id: 'u_owner',
          display_name: 'Test Bot',
          avatar_file_id: null
        }))
        return
      }

      if (req.url === '/api/v1/broadcasting/auth') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ auth: 'test-app-key:signature' }))
        return
      }

      if (req.url === '/api/v1/bots/me/pause') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }

      if (req.url === '/api/v1/bots/me/messages') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message_id: 'm_res_123' }))
        return
      }

      if (req.url?.startsWith('/api/v1/bots/me/commands/') && req.url.endsWith('/ack')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }

      res.writeHead(404)
      res.end()
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  const serverUrl = `http://127.0.0.1:${port}`

  return {
    serverUrl,
    requests,
    async close () {
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

/**
 * Creates standard test runtime configurations and keystore.
 */
function makeTestDeps (serverUrl, tmpDir, botConfigOverrides = {}) {
  const bot = {
    config: {
      label: 'Pause Test Bot',
      handlers: {},
      ...botConfigOverrides
    }
  }

  const config = {
    botConfigPath: path.join(tmpDir, 'bot.toml'),
    keystorePath: path.join(tmpDir, 'bot.keystore'),
    keystoreSecret: 'secret',
    userToken: 'usr_token',
    serverUrl,
    botToken: 'bot_token_123',
    handlerTimeoutMs: 5000,
    webhook: {
      host: '127.0.0.1',
      port: 0,
      basePath: '/webhooks',
      maxBodyBytes: 1024,
      timeoutMs: 5000
    },
    cron: {
      timezone: 'UTC',
      catchUp: false
    },
    runtime: {
      logLevel: 'debug',
      logFormat: 'json',
      maxStorageBytes: 1048576,
      maxLogBytes: 1048576,
      devMode: true
    }
  }

  const keystoreData = {
    bot_token: 'bot_token_123',
    bot_id: 'bot_123',
    bot_identity_private: makeKey(1),
    bot_command_private: makeKey(2),
    storage_seed: makeKey(3)
  }

  const logger = createLogger({
    botId: 'bot_123',
    level: 'silent'
  })

  return { bot, config, keystoreData, logger }
}

test('1. Three consecutive handler failures pause the runtime', async () => {
  FakeWebSocket.instances = []
  const { serverUrl, close } = await setupServer()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-pause-1-'))

  try {
    let callCount = 0
    const { bot, config, keystoreData, logger } = makeTestDeps(serverUrl, tmpDir, {
      handlers: {
        message: async () => {
          callCount++
          throw new Error(`handler throw ${callCount}`)
        }
      }
    })

    const runtime = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime.start()

    const wsInst = FakeWebSocket.instances[0]
    wsInst.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    // Send 3 failures
    for (let i = 1; i <= 3; i++) {
      wsInst.emit('message', JSON.stringify({
        event: 'message.new',
        data: JSON.stringify({ id: `msg_${i}`, room_id: 'r_1' })
      }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    assert.equal(callCount, 3)

    // 4th dispatch should be skipped (callCount remains 3)
    wsInst.emit('message', JSON.stringify({
      event: 'message.new',
      data: JSON.stringify({ id: 'msg_4', room_id: 'r_1' })
    }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(callCount, 3)

    await runtime.stop()
  } finally {
    await close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('2. The pause is reported to the server', async () => {
  FakeWebSocket.instances = []
  const { serverUrl, requests, close } = await setupServer()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-pause-2-'))

  try {
    const { bot, config, keystoreData, logger } = makeTestDeps(serverUrl, tmpDir, {
      handlers: {
        message: async () => {
          throw new Error('fail')
        }
      }
    })

    const runtime = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime.start()

    const wsInst = FakeWebSocket.instances[0]
    wsInst.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    for (let i = 1; i <= 3; i++) {
      wsInst.emit('message', JSON.stringify({
        event: 'message.new',
        data: JSON.stringify({ id: `msg_${i}`, room_id: 'r_1' })
      }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    // Wait for pause report request
    await new Promise((resolve) => setTimeout(resolve, 50))

    const pauseReq = requests.find((r) => r.url === '/api/v1/bots/me/pause')
    assert.ok(pauseReq)
    assert.equal(pauseReq.method, 'POST')
    assert.equal(pauseReq.body.threshold, 3)
    assert.equal(pauseReq.body.window_ms, 60000)
    assert.ok(typeof pauseReq.body.first_failure_at === 'string')

    await runtime.stop()
  } finally {
    await close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('3. A command dispatched after pause produces a paused local_message', async () => {
  FakeWebSocket.instances = []
  const { serverUrl, requests, close } = await setupServer()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-pause-3-'))

  try {
    let commandExecuted = false
    const { bot, config, keystoreData, logger } = makeTestDeps(serverUrl, tmpDir, {
      commands: {
        ping: {
          handler: async () => {
            commandExecuted = true
            return { type: 'local_message', content: 'pong' }
          }
        }
      },
      handlers: {
        message: async () => {
          throw new Error('fail')
        }
      }
    })

    const runtime = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime.start()

    const wsInst = FakeWebSocket.instances[0]
    wsInst.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    // Fail 3 times via room events to enter pause state
    for (let i = 1; i <= 3; i++) {
      wsInst.emit('message', JSON.stringify({
        event: 'message.new',
        data: JSON.stringify({ id: `msg_${i}`, room_id: 'r_1' })
      }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    // Dispatch command when paused
    // Simulate raw command_invoked event by calling command handler or emitting event on bot channel
    // Construct fake ciphertext / wire call via websocket bot channel
    const ephemResultPub = Buffer.alloc(32, 9).toString('base64url')
    const plainJson = JSON.stringify({
      command_name: 'ping',
      args: {},
      ephemeral_result_pubkey: ephemResultPub
    })

    // Import crypto primitives to produce valid wire format for test
    const { encrypt, generateEphemeralKeypair } = await import('../../src/runtime/crypto/command-result.js')
    const ephem = generateEphemeralKeypair()
    const botCmdPriv = Buffer.from(keystoreData.bot_command_private, 'base64url')
    const ct = encrypt({
      privateKey: ephem.privateKey,
      peerPublicKey: botCmdPriv,
      info: 'bot-command-v1',
      plaintext: Buffer.from(plainJson, 'utf8')
    })
    const wireStr = Buffer.concat([ephem.publicKey, ct]).toString('base64url')

    wsInst.emit('message', JSON.stringify({
      event: 'bot.command_invoked',
      data: JSON.stringify({
        command_id: 'cmd_100',
        room_id: 'r_1',
        sender_user_id: 'u_invoker',
        sender_client_id: 'c_invoker',
        ciphertext: wireStr
      })
    }))

    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.equal(commandExecuted, false)

    // Verify messages call contained paused text
    const msgReq = requests.find((r) => r.url === '/api/v1/bots/me/messages')
    assert.ok(msgReq)
    assert.equal(msgReq.body.target, 'invoker')

    await runtime.stop()
  } finally {
    await close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('4. A room event dispatched after pause is skipped', async () => {
  FakeWebSocket.instances = []
  const { serverUrl, close } = await setupServer()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-pause-4-'))

  try {
    let roomEventsHandled = 0
    const { bot, config, keystoreData, logger } = makeTestDeps(serverUrl, tmpDir, {
      handlers: {
        message: async () => {
          roomEventsHandled++
          throw new Error('fail')
        }
      }
    })

    const runtime = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime.start()

    const wsInst = FakeWebSocket.instances[0]
    wsInst.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    for (let i = 1; i <= 3; i++) {
      wsInst.emit('message', JSON.stringify({
        event: 'message.new',
        data: JSON.stringify({ id: `msg_${i}`, room_id: 'r_1' })
      }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    assert.equal(roomEventsHandled, 3)

    // Dispatch 5th event
    wsInst.emit('message', JSON.stringify({
      event: 'message.new',
      data: JSON.stringify({ id: 'msg_5', room_id: 'r_1' })
    }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(roomEventsHandled, 3)

    await runtime.stop()
  } finally {
    await close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('5. A webhook after pause returns 503', async () => {
  FakeWebSocket.instances = []
  const { serverUrl, close } = await setupServer()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-pause-5-'))

  try {
    let webhookHandled = false
    const { bot, config, keystoreData, logger } = makeTestDeps(serverUrl, tmpDir, {
      triggers: [{ type: 'webhook', path: '/test' }],
      handlers: {
        message: async () => {
          throw new Error('fail')
        },
        webhook: async () => {
          webhookHandled = true
        }
      }
    })

    const runtime = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime.start()

    const wsInst = FakeWebSocket.instances[0]
    wsInst.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    for (let i = 1; i <= 3; i++) {
      wsInst.emit('message', JSON.stringify({
        event: 'message.new',
        data: JSON.stringify({ id: `msg_${i}`, room_id: 'r_1' })
      }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    // Call webhook via HTTP on the webhook server port
    // In makeTestDeps, config.webhook.port is set to 0. Retrieve the actual bound port from webhookServer.
    /** @type {any} */
    const runtimeUntyped = runtime
    const webhookPort = runtimeUntyped.webhookServer?.getBoundPort() ?? config.webhook.port

    const webhookRes = await fetch(`http://127.0.0.1:${webhookPort}/webhooks/test`, {
      method: 'POST',
      body: ''
    })
    assert.equal(webhookRes.status, 503)
    const body = await webhookRes.json()
    assert.equal(body.error, 'bot_paused')
    assert.equal(body.message, 'The bot is paused.')
    assert.equal(webhookHandled, false)

    await runtime.stop()
  } finally {
    await close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('6. A cron fire after pause is skipped', async () => {
  FakeWebSocket.instances = []
  const { serverUrl, close } = await setupServer()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-pause-6-'))

  try {
    let cronFired = false
    const { bot, config, keystoreData, logger } = makeTestDeps(serverUrl, tmpDir, {
      triggers: [{ type: 'schedule', name: 'daily', cron: '* * * * *' }],
      handlers: {
        message: async () => {
          throw new Error('fail')
        },
        schedule: async () => {
          cronFired = true
        }
      }
    })

    const runtime = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime.start()

    const wsInst = FakeWebSocket.instances[0]
    wsInst.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    for (let i = 1; i <= 3; i++) {
      wsInst.emit('message', JSON.stringify({
        event: 'message.new',
        data: JSON.stringify({ id: `msg_${i}`, room_id: 'r_1' })
      }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    await runtime.stop()
    assert.equal(cronFired, false)
  } finally {
    await close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('7. A failure count exceeding the threshold does not re-report', async () => {
  FakeWebSocket.instances = []
  const { serverUrl, requests, close } = await setupServer()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-pause-7-'))

  try {
    const { bot, config, keystoreData, logger } = makeTestDeps(serverUrl, tmpDir, {
      handlers: {
        message: async () => {
          throw new Error('fail')
        }
      }
    })

    const runtime = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime.start()

    const wsInst = FakeWebSocket.instances[0]
    wsInst.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    for (let i = 1; i <= 5; i++) {
      wsInst.emit('message', JSON.stringify({
        event: 'message.new',
        data: JSON.stringify({ id: `msg_${i}`, room_id: 'r_1' })
      }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    await new Promise((resolve) => setTimeout(resolve, 50))

    const pauseReqs = requests.filter((r) => r.url === '/api/v1/bots/me/pause')
    assert.equal(pauseReqs.length, 1)

    await runtime.stop()
  } finally {
    await close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('8. A success before the threshold resets', async () => {
  FakeWebSocket.instances = []
  const { serverUrl, requests, close } = await setupServer()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-pause-8-'))

  try {
    let count = 0
    const { bot, config, keystoreData, logger } = makeTestDeps(serverUrl, tmpDir, {
      handlers: {
        message: async () => {
          count++
          if (count === 3) return // 3rd invocation succeeds
          throw new Error(`fail ${count}`)
        }
      }
    })

    const runtime = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime.start()

    const wsInst = FakeWebSocket.instances[0]
    wsInst.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    // 2 failures
    wsInst.emit('message', JSON.stringify({ event: 'message.new', data: JSON.stringify({ id: 'm1', room_id: 'r_1' }) }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    wsInst.emit('message', JSON.stringify({ event: 'message.new', data: JSON.stringify({ id: 'm2', room_id: 'r_1' }) }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    // 1 success
    wsInst.emit('message', JSON.stringify({ event: 'message.new', data: JSON.stringify({ id: 'm3', room_id: 'r_1' }) }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    // 2 more failures
    wsInst.emit('message', JSON.stringify({ event: 'message.new', data: JSON.stringify({ id: 'm4', room_id: 'r_1' }) }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    wsInst.emit('message', JSON.stringify({ event: 'message.new', data: JSON.stringify({ id: 'm5', room_id: 'r_1' }) }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    const pauseReqs = requests.filter((r) => r.url === '/api/v1/bots/me/pause')
    assert.equal(pauseReqs.length, 0)

    await runtime.stop()
  } finally {
    await close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('9. The pause state survives dispatch of other event types', async () => {
  FakeWebSocket.instances = []
  const { serverUrl, close } = await setupServer()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-pause-9-'))

  try {
    let roomHandlerCalls = 0
    const { bot, config, keystoreData, logger } = makeTestDeps(serverUrl, tmpDir, {
      handlers: {
        message: async () => {
          throw new Error('fail')
        },
        room: async () => {
          roomHandlerCalls++
        }
      }
    })

    const runtime = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime.start()

    const wsInst = FakeWebSocket.instances[0]
    wsInst.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    // 3 message failures pause runtime
    for (let i = 1; i <= 3; i++) {
      wsInst.emit('message', JSON.stringify({
        event: 'message.new',
        data: JSON.stringify({ id: `msg_${i}`, room_id: 'r_1' })
      }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    // Attempt room event
    wsInst.emit('message', JSON.stringify({
      event: 'room.member_added',
      data: JSON.stringify({ id: 're_1', room_id: 'r_1' })
    }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(roomHandlerCalls, 0)

    await runtime.stop()
  } finally {
    await close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('10. stop() then start() on a fresh runtime is unpaused', async () => {
  FakeWebSocket.instances = []
  const { serverUrl, close } = await setupServer()
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atoll-pause-10-'))

  try {
    let callCount = 0
    const { bot, config, keystoreData, logger } = makeTestDeps(serverUrl, tmpDir, {
      handlers: {
        message: async () => {
          callCount++
          if (callCount <= 3) {
            throw new Error('fail')
          }
          return 'ok'
        }
      }
    })

    const runtime1 = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime1.start()

    const wsInst1 = FakeWebSocket.instances[0]
    wsInst1.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    for (let i = 1; i <= 3; i++) {
      wsInst1.emit('message', JSON.stringify({
        event: 'message.new',
        data: JSON.stringify({ id: `msg_${i}`, room_id: 'r_1' })
      }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    await runtime1.stop()

    // Create a new fresh runtime instance
    const runtime2 = createRuntime({
      bot,
      config,
      keystoreData,
      logger,
      WebSocketImpl: FakeWebSocket
    })

    await runtime2.start()

    const wsInst2 = FakeWebSocket.instances[1]
    wsInst2.emit('message', JSON.stringify({
      event: 'bot.grant_updated',
      data: JSON.stringify({ room_id: 'r_1', new_mode: 'member', scopes: [] })
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    wsInst2.emit('message', JSON.stringify({
      event: 'message.new',
      data: JSON.stringify({ id: 'msg_fresh', room_id: 'r_1' })
    }))
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(callCount, 4)

    await runtime2.stop()
  } finally {
    await close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})
