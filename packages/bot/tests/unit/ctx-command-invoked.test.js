import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createServer } from 'node:http'
import { describe, it } from 'node:test'
import { defineBot } from '../../src/define-bot.js'
import { COMMAND_INFO, createCommandInvocationHandler, dispatchCommandResult } from '../../src/runtime/context/command-invoked.js'
import { encrypt, generateEphemeralKeypair, keyObjectFromX25519Private } from '../../src/runtime/crypto/command-result.js'
import { createHttpClient } from '../../src/runtime/transport/http.js'

const BOT_COMMAND_PRIVATE = new Uint8Array(32)
BOT_COMMAND_PRIVATE.fill(0x55)
const privKo = keyObjectFromX25519Private(BOT_COMMAND_PRIVATE)
const pubKo = crypto.createPublicKey(privKo)
const spkiDer = pubKo.export({ type: 'spki', format: 'der' })
const BOT_COMMAND_PUBLIC = new Uint8Array(spkiDer.subarray(12))

/**
 * @param {(req: import('node:http').IncomingMessage & { body?: any }, res: import('node:http').ServerResponse) => void} [requestHandler]
 */
function startServer (requestHandler) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const chunks = []
      for await (const chunk of req) {
        chunks.push(chunk)
      }
      const bodyText = Buffer.concat(chunks).toString('utf8')
      let body = null
      if (bodyText) {
        try {
          body = JSON.parse(bodyText)
        } catch {
          body = bodyText
        }
      }
      /** @type {any} */ (req).body = body
      if (requestHandler) {
        requestHandler(/** @type {any} */ (req), res)
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const url = `http://127.0.0.1:${port}`
      resolve({
        url,
        close: () => new Promise((res) => server.close(res))
      })
    })
  })
}

/**
 * @param {object} params
 * @param {string} params.commandName
 * @param {Record<string, unknown>} params.args
 * @param {Uint8Array} [params.ephemeralResultPubkey]
 * @param {Uint8Array} [params.recipientPubkey]
 * @param {string} [params.info]
 */
function makeCommandCiphertext ({
  commandName,
  args,
  ephemeralResultPubkey = new Uint8Array(32).fill(0x66),
  recipientPubkey = BOT_COMMAND_PUBLIC,
  info = COMMAND_INFO
}) {
  const ephemeral = generateEphemeralKeypair()
  const plaintext = Buffer.from(JSON.stringify({
    command_name: commandName,
    args,
    ephemeral_result_pubkey: Buffer.from(ephemeralResultPubkey).toString('base64url')
  }), 'utf8')
  const inner = encrypt({
    privateKey: ephemeral.privateKey,
    peerPublicKey: recipientPubkey,
    info,
    plaintext
  })
  return Buffer.concat([ephemeral.publicKey, inner]).toString('base64url')
}

/**
 * Creates a mock logger for testing.
 * @param {object} [callbacks]
 * @param {(msg: string, meta?: any) => void} [callbacks.debug]
 * @param {(msg: string, meta?: any) => void} [callbacks.info]
 * @param {(msg: string, meta?: any) => void} [callbacks.warn]
 * @param {(msg: string, meta?: any) => void} [callbacks.error]
 * @returns {import('../../src/runtime/diagnostics/logger.js').Logger}
 */
function createMockLogger ({ debug, info, warn, error } = {}) {
  return {
    level () { return 'debug' },
    log () {},
    debug (msg, meta) { debug?.(msg, meta) },
    info (msg, meta) { info?.(msg, meta) },
    warn (msg, meta) { warn?.(msg, meta) },
    error (msg, meta) { error?.(msg, meta) }
  }
}

describe('ctx.commandInvoked unit tests', () => {
  it('1. Happy path decrypts and executes command', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      let handlerRan = false
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: {
          install () {}
        },
        commands: {
          ping: {
            args: {},
            handler () {
              handlerRan = true
              return { type: 'none' }
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'ping', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_1',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(handlerRan, true)
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]?.url, '/bots/me/commands/cmd_1/ack')
    } finally {
      await server.close()
    }
  })

  it('2. Wrong botCommandPrivateKey fails decryption', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      /** @type {Array<{ msg: string, meta: any }>} */
      const warnings = []
      const logger = createMockLogger({
        warn (msg, meta) { warnings.push({ msg, meta }) }
      })

      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: { ping: { args: {}, handler () { return { type: 'none' } } } }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const wrongKey = new Uint8Array(32).fill(0x99)
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: wrongKey,
        bot,
        http,
        logger,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'ping', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_2',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(warnings.length, 1)
      assert.strictEqual(warnings[0]?.msg, 'command decryption failed')
      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]?.url, '/bots/me/commands/cmd_2/ack')
    } finally {
      await server.close()
    }
  })

  it('3. Malformed base64url', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      await onCommandInvoked({
        command_id: 'cmd_3',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext: '***invalid-base64url***'
      })

      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]?.url, '/bots/me/commands/cmd_3/ack')
    } finally {
      await server.close()
    }
  })

  it('4. Too-short wire', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const shortWire = Buffer.alloc(30).toString('base64url')
      await onCommandInvoked({
        command_id: 'cmd_4',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext: shortWire
      })

      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]?.url, '/bots/me/commands/cmd_4/ack')
    } finally {
      await server.close()
    }
  })

  it('5. Malformed plaintext (not JSON)', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} }
      })

      const ephemeral = generateEphemeralKeypair()
      const inner = encrypt({
        privateKey: ephemeral.privateKey,
        peerPublicKey: BOT_COMMAND_PUBLIC,
        info: COMMAND_INFO,
        plaintext: Buffer.from('not json', 'utf8')
      })
      const ciphertext = Buffer.concat([ephemeral.publicKey, inner]).toString('base64url')

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      await onCommandInvoked({
        command_id: 'cmd_5',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]?.url, '/bots/me/commands/cmd_5/ack')
    } finally {
      await server.close()
    }
  })

  it('6. Missing command_name in plaintext', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} }
      })

      const ephemeral = generateEphemeralKeypair()
      const plaintext = Buffer.from(JSON.stringify({
        args: {},
        ephemeral_result_pubkey: Buffer.alloc(32).toString('base64url')
      }), 'utf8')
      const inner = encrypt({
        privateKey: ephemeral.privateKey,
        peerPublicKey: BOT_COMMAND_PUBLIC,
        info: COMMAND_INFO,
        plaintext
      })
      const ciphertext = Buffer.concat([ephemeral.publicKey, inner]).toString('base64url')

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      await onCommandInvoked({
        command_id: 'cmd_6',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })
    } finally {
      await server.close()
    }
  })

  it('7. Missing args in plaintext', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} }
      })

      const ephemeral = generateEphemeralKeypair()
      const plaintext = Buffer.from(JSON.stringify({
        command_name: 'ping',
        ephemeral_result_pubkey: Buffer.alloc(32).toString('base64url')
      }), 'utf8')
      const inner = encrypt({
        privateKey: ephemeral.privateKey,
        peerPublicKey: BOT_COMMAND_PUBLIC,
        info: COMMAND_INFO,
        plaintext
      })
      const ciphertext = Buffer.concat([ephemeral.publicKey, inner]).toString('base64url')

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      await onCommandInvoked({
        command_id: 'cmd_7',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })
    } finally {
      await server.close()
    }
  })

  it('8. Missing ephemeral_result_pubkey in plaintext', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} }
      })

      const ephemeral = generateEphemeralKeypair()
      const plaintext = Buffer.from(JSON.stringify({
        command_name: 'ping',
        args: {}
      }), 'utf8')
      const inner = encrypt({
        privateKey: ephemeral.privateKey,
        peerPublicKey: BOT_COMMAND_PUBLIC,
        info: COMMAND_INFO,
        plaintext
      })
      const ciphertext = Buffer.concat([ephemeral.publicKey, inner]).toString('base64url')

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      await onCommandInvoked({
        command_id: 'cmd_8',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })
    } finally {
      await server.close()
    }
  })

  it('9. Wrong-length ephemeral_result_pubkey in plaintext', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} }
      })

      const ephemeral = generateEphemeralKeypair()
      const plaintext = Buffer.from(JSON.stringify({
        command_name: 'ping',
        args: {},
        ephemeral_result_pubkey: Buffer.alloc(16).toString('base64url')
      }), 'utf8')
      const inner = encrypt({
        privateKey: ephemeral.privateKey,
        peerPublicKey: BOT_COMMAND_PUBLIC,
        info: COMMAND_INFO,
        plaintext
      })
      const ciphertext = Buffer.concat([ephemeral.publicKey, inner]).toString('base64url')

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      await onCommandInvoked({
        command_id: 'cmd_9',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })
    } finally {
      await server.close()
    }
  })

  it('10. Unknown command produces a local_message to invoker', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {}
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'unknown_cmd', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_10',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]?.url, '/bots/me/messages')
      assert.strictEqual(requests[0]?.body.target, 'invoker')
      assert.strictEqual(requests[0]?.body.result_type, 'local_message')
      assert.strictEqual(requests[1]?.url, '/bots/me/commands/cmd_10/ack')
    } finally {
      await server.close()
    }
  })

  it('11. Known command runs the handler', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      let ran = false
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          test: {
            args: {},
            handler () {
              ran = true
              return { type: 'none' }
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'test', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_11',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(ran, true)
    } finally {
      await server.close()
    }
  })

  it('12. Missing required arg produces a local_message', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          greet: {
            args: {
              name: { type: 'string', required: true }
            },
            handler () { return { type: 'none' } }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'greet', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_12',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]?.url, '/bots/me/messages')
      assert.strictEqual(requests[0]?.body.result_type, 'local_message')
    } finally {
      await server.close()
    }
  })

  it('13. Wrong-type arg produces a local_message', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          calc: {
            args: {
              count: { type: 'number', required: true }
            },
            handler () { return { type: 'none' } }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'calc', args: { count: 'not-a-number' } })
      await onCommandInvoked({
        command_id: 'cmd_13',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]?.body.result_type, 'local_message')
    } finally {
      await server.close()
    }
  })

  it('14. Extra arg rejected', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          ping: {
            args: {},
            handler () { return { type: 'none' } }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'ping', args: { extra: 'arg' } })
      await onCommandInvoked({
        command_id: 'cmd_14',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]?.body.result_type, 'local_message')
    } finally {
      await server.close()
    }
  })

  it('15. Select arg must be in options', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          choose: {
            args: {
              color: { type: 'select', options: ['red', 'blue'] }
            },
            handler () { return { type: 'none' } }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'choose', args: { color: 'green' } })
      await onCommandInvoked({
        command_id: 'cmd_15',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]?.body.result_type, 'local_message')
    } finally {
      await server.close()
    }
  })

  it('16. All valid args flow through to the handler', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      let receivedArgs = null
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          test: {
            args: {
              str: { type: 'string' },
              num: { type: 'number' },
              bool: { type: 'boolean' },
              sel: { type: 'select', options: ['a', 'b'] }
            },
            handler (_ctx, args) {
              receivedArgs = {
                str: args.get('str'),
                num: args.get('num'),
                bool: args.get('bool'),
                sel: args.get('sel')
              }
              return { type: 'none' }
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({
        commandName: 'test',
        args: { str: 'hello', num: 42, bool: true, sel: 'a' }
      })
      await onCommandInvoked({
        command_id: 'cmd_16',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.deepStrictEqual(receivedArgs, { str: 'hello', num: 42, bool: true, sel: 'a' })
    } finally {
      await server.close()
    }
  })

  it('17. Handler receives a BotCtx and ArgsReader', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      let passedCtx = null
      /** @type {any} */
      let passedArgs = null

      const syntheticCtx = { mockBotCtx: true }
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          inspect: {
            args: { x: { type: 'string' } },
            handler (ctx, args) {
              passedCtx = ctx
              passedArgs = args
              return { type: 'none' }
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ (syntheticCtx))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'inspect', args: { x: 'val' } })
      await onCommandInvoked({
        command_id: 'cmd_17',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(passedCtx, syntheticCtx)
      assert.ok(passedArgs)
      assert.strictEqual(typeof passedArgs.get, 'function')
      assert.strictEqual(passedArgs.get('x'), 'val')
    } finally {
      await server.close()
    }
  })

  it('18. Handler throws -> local_message result', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          fail: {
            args: {},
            handler () {
              throw new Error('boom')
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'fail', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_18',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]?.body.result_type, 'local_message')
    } finally {
      await server.close()
    }
  })

  it('19. Handler times out -> local_message result', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          slow: {
            args: {},
            handler () {
              return new Promise((resolve) => setTimeout(() => resolve({ type: 'none' }), 100))
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        handlerTimeoutMs: 20,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'slow', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_19',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]?.body.result_type, 'local_message')
    } finally {
      await server.close()
    }
  })

  it('20. local_message result routes to /bots/me/messages', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          msg: {
            args: {},
            handler () {
              return { type: 'local_message', content: 'hello local' }
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'msg', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_20',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]?.url, '/bots/me/messages')
      assert.strictEqual(requests[0]?.body.target, 'invoker')
      assert.strictEqual(requests[0]?.body.result_type, 'local_message')
    } finally {
      await server.close()
    }
  })

  it('21. toast routes with result_type: toast', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          t: {
            args: {},
            handler () {
              return { type: 'toast', content: 'hello toast' }
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 't', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_21',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]?.body.result_type, 'toast')
    } finally {
      await server.close()
    }
  })

  it('22. panel routes with result_type: panel', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          p: {
            args: {},
            handler () {
              return { type: 'panel', content: 'hello panel' }
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'p', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_22',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[0]?.body.result_type, 'panel')
    } finally {
      await server.close()
    }
  })

  it('23. room_message calls ctx.post with correct arguments', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      let postedOpts = null
      const syntheticCtx = {
        /** @param {any} opts */
        post: async (opts) => {
          postedOpts = opts
          return { id: 'm_1', roomId: opts.roomId, createdAt: new Date().toISOString() }
        }
      }

      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          rm: {
            args: {},
            handler () {
              return {
                type: 'room_message',
                content: 'room text',
                attachments: [{ fileId: 'f_1', size: 10, contentType: 'image/png' }],
                replyTo: 'm_0'
              }
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ (syntheticCtx))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'rm', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_23',
        room_id: 'room_xyz',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.deepStrictEqual(postedOpts, {
        roomId: 'room_xyz',
        text: 'room text',
        attachments: [{ fileId: 'f_1', size: 10, contentType: 'image/png' }],
        replyTo: 'm_0'
      })
    } finally {
      await server.close()
    }
  })

  it('24. none sends nothing', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url, body: req.body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          noop: {
            args: {},
            handler () {
              return { type: 'none' }
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'noop', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_24',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]?.url, '/bots/me/commands/cmd_24/ack')
    } finally {
      await server.close()
    }
  })

  it('25. Ack is sent after dispatch', async () => {
    /** @type {Array<string | undefined>} */
    const events = []
    const server = await startServer((req, res) => {
      events.push(req.url)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          cmd: {
            args: {},
            handler () {
              return { type: 'toast', content: 'done' }
            }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'cmd', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_25',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.deepStrictEqual(events, [
        '/bots/me/messages',
        '/bots/me/commands/cmd_25/ack'
      ])
    } finally {
      await server.close()
    }
  })

  it('26. Ack is sent after decryption failure', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: new Uint8Array(32).fill(0x00),
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'ping', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_26',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 1)
      assert.strictEqual(requests[0]?.url, '/bots/me/commands/cmd_26/ack')
    } finally {
      await server.close()
    }
  })

  it('27. Ack is sent after handler failure', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined }>} */
    const requests = []
    const server = await startServer((req, res) => {
      requests.push({ method: req.method, url: req.url })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          bad: {
            args: {},
            handler () { throw new Error('handler failure') }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'bad', args: {} })
      await onCommandInvoked({
        command_id: 'cmd_27',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      assert.strictEqual(requests.length, 2)
      assert.strictEqual(requests[1]?.url, '/bots/me/commands/cmd_27/ack')
    } finally {
      await server.close()
    }
  })

  it('28. Ack failure does not throw', async () => {
    const server = await startServer((req, res) => {
      if (req.url?.endsWith('/ack')) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'server error' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          ping: {
            args: {},
            handler () { return { type: 'none' } }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'ping', args: {} })
      await assert.doesNotReject(async () => {
        await onCommandInvoked({
          command_id: 'cmd_28',
          room_id: 'room_1',
          sender_user_id: 'u_1',
          sender_client_id: 'c_1',
          ciphertext
        })
      })
    } finally {
      await server.close()
    }
  })

  it('29. Handler never throws on any failure path', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          err: {
            args: { req: { type: 'string', required: true } },
            handler () { throw new Error('err') }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })

      // Path 1: Decryption failure
      const handler1 = createCommandInvocationHandler({
        botCommandPrivateKey: new Uint8Array(32).fill(0x00),
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })
      await assert.doesNotReject(async () => {
        await handler1({ command_id: 'c1', room_id: 'r1', sender_user_id: 'u1', sender_client_id: 'c1', ciphertext: makeCommandCiphertext({ commandName: 'err', args: {} }) })
      })

      // Path 2: Unknown command
      const handler2 = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })
      await assert.doesNotReject(async () => {
        await handler2({ command_id: 'c2', room_id: 'r1', sender_user_id: 'u1', sender_client_id: 'c1', ciphertext: makeCommandCiphertext({ commandName: 'unknown', args: {} }) })
      })

      // Path 3: Invalid args
      await assert.doesNotReject(async () => {
        await handler2({ command_id: 'c3', room_id: 'r1', sender_user_id: 'u1', sender_client_id: 'c1', ciphertext: makeCommandCiphertext({ commandName: 'err', args: {} }) })
      })

      // Path 4: makeBotCtx failure
      const handler4 = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => { throw new Error('makeBotCtx error') }
      })
      await assert.doesNotReject(async () => {
        await handler4({ command_id: 'c4', room_id: 'r1', sender_user_id: 'u1', sender_client_id: 'c1', ciphertext: makeCommandCiphertext({ commandName: 'err', args: { req: 'val' } }) })
      })

      // Path 5: Handler exception
      await assert.doesNotReject(async () => {
        await handler2({ command_id: 'c5', room_id: 'r1', sender_user_id: 'u1', sender_client_id: 'c1', ciphertext: makeCommandCiphertext({ commandName: 'err', args: { req: 'val' } }) })
      })
    } finally {
      await server.close()
    }
  })

  it('30. Logger emits warnings on the failure paths', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      /** @type {Array<{ msg: string, meta: any }>} */
      const warnings = []
      const logger = createMockLogger({
        warn (msg, meta) { warnings.push({ msg, meta }) }
      })

      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          test: {
            args: { x: { type: 'number', required: true } },
            handler () { return { type: 'none' } }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })

      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        logger,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      // Trigger unknown command
      await onCommandInvoked({
        command_id: 'c_warn_1',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext: makeCommandCiphertext({ commandName: 'unknown', args: {} })
      })

      // Trigger args validation failure
      await onCommandInvoked({
        command_id: 'c_warn_2',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext: makeCommandCiphertext({ commandName: 'test', args: {} })
      })

      assert.ok(warnings.some((w) => w.msg === 'unknown command invoked'))
      assert.ok(warnings.some((w) => w.msg === 'command args validation failed'))
    } finally {
      await server.close()
    }
  })

  it('31. Logger does not log command plaintext or args values', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    try {
      /** @type {string[]} */
      const logs = []
      const logger = createMockLogger({
        debug (msg, meta) { logs.push(JSON.stringify({ msg, meta })) },
        info (msg, meta) { logs.push(JSON.stringify({ msg, meta })) },
        warn (msg, meta) { logs.push(JSON.stringify({ msg, meta })) },
        error (msg, meta) { logs.push(JSON.stringify({ msg, meta })) }
      })

      const SENTINEL = 'SUPER_SECRET_SENTINEL_VALUE_999'
      const bot = defineBot({
        id: 'test.bot',
        apiVersion: '1.0.0',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          'secret-cmd': {
            args: { secretArg: { type: 'string' } },
            handler () { return { type: 'none' } }
          }
        }
      })

      const http = createHttpClient({ serverUrl: server.url, botToken: 'test-token' })
      const onCommandInvoked = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        logger,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const ciphertext = makeCommandCiphertext({ commandName: 'secret-cmd', args: { secretArg: SENTINEL } })
      await onCommandInvoked({
        command_id: 'cmd_31',
        room_id: 'room_1',
        sender_user_id: 'u_1',
        sender_client_id: 'c_1',
        ciphertext
      })

      for (const logLine of logs) {
        assert.strictEqual(logLine.includes(SENTINEL), false, `Sentinel leaked in log line: ${logLine}`)
      }
    } finally {
      await server.close()
    }
  })

  it('dispatchCommandResult standalone checks', async () => {
    await assert.rejects(
      async () => dispatchCommandResult(/** @type {any} */ (undefined)),
      /result must be an object/
    )

    await assert.rejects(
      async () => dispatchCommandResult({
        result: { type: 'room_message', content: 'test' },
        ephemeralResultPubkey: new Uint8Array(32),
        roomId: 'r1',
        http: /** @type {any} */ ({})
      }),
      /ctx.post is required/
    )

    await assert.rejects(
      async () => dispatchCommandResult({
        result: /** @type {any} */ ({ type: 'invalid_type' }),
        ephemeralResultPubkey: new Uint8Array(32),
        roomId: 'r1',
        http: /** @type {any} */ ({})
      }),
      /Unknown result type/
    )
  })
})
