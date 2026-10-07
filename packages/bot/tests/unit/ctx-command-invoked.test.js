import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createServer } from 'node:http'
import { describe, it } from 'node:test'
import { defineBot } from '../../src/define-bot.js'
import { COMMAND_INFO, createCommandInvocationHandler, dispatchCommandResult } from '../../src/runtime/context/command-invoked.js'
import { encrypt, generateEphemeralKeypair, keyObjectFromX25519Private } from '../../src/runtime/crypto/command-result.js'
import { createShutdownTracker } from '../../src/runtime/shutdown.js'
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
    /** @type {import('node:http').IncomingMessage[]} */
    const requests = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          /** @type {any} */ (req).body = JSON.parse(body)
        } catch {
          /** @type {any} */ (req).body = body
        }
        /** @type {any} */
        const reqWithBody = req
        requests.push(reqWithBody)
        if (requestHandler) {
          requestHandler(reqWithBody, res)
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok' }))
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        requests,
        close () {
          return new Promise((r) => server.close(r))
        }
      })
    })
  })
}

/**
 * Helper to build command ciphertext.
 */
function buildCiphertext (commandName, args = {}) {
  const invokerEph = generateEphemeralKeypair()
  const resultEph = generateEphemeralKeypair()
  const plaintext = Buffer.from(JSON.stringify({
    command_name: commandName,
    args,
    ephemeral_result_pubkey: Buffer.from(resultEph.publicKey).toString('base64url')
  }))
  const ct = encrypt({
    privateKey: invokerEph.privateKey,
    peerPublicKey: BOT_COMMAND_PUBLIC,
    info: COMMAND_INFO,
    plaintext
  })
  const wire = Buffer.concat([invokerEph.publicKey, ct])
  return {
    ciphertext: wire.toString('base64url'),
    resultPubkey: resultEph.publicKey
  }
}

describe('Command Invocation Handler Unit Tests', () => {
  it('1. Decrypts command, runs handler, dispatches local_message, and acks', async () => {
    let handlerRan = false
    const srv = await startServer()
    try {
      const http = createHttpClient({ serverUrl: srv.url, botToken: 'test' })
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test',
        capabilities: ['post_message'],
        handlers: {
          install () {}
        },
        commands: {
          ping: {
            args: {},
            handler () {
              handlerRan = true
              return { type: 'local_message', content: 'pong' }
            }
          }
        }
      })
      const handler = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const { ciphertext } = buildCiphertext('ping')
      await handler({
        command_id: 'cmd1',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext
      })

      assert.equal(handlerRan, true)
      assert.equal(srv.requests.length, 2)
      assert.equal(srv.requests[0].url, '/bots/me/messages')
      assert.equal(srv.requests[0].body.target, 'invoker')
      assert.equal(srv.requests[0].body.result_type, 'local_message')
      assert.equal(srv.requests[1].url, '/bots/me/commands/cmd1/ack')
    } finally {
      await srv.close()
    }
  })

  it('2. Unknown command returns error local_message and acks', async () => {
    const srv = await startServer()
    try {
      const http = createHttpClient({ serverUrl: srv.url, botToken: 'test' })
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {}
      })
      const handler = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const { ciphertext } = buildCiphertext('unknown')
      await handler({
        command_id: 'cmd2',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext
      })

      assert.equal(srv.requests.length, 2)
      assert.equal(srv.requests[0].url, '/bots/me/messages')
      assert.equal(srv.requests[1].url, '/bots/me/commands/cmd2/ack')
    } finally {
      await srv.close()
    }
  })

  it('3. Invalid args returns error local_message and acks', async () => {
    const srv = await startServer()
    try {
      const http = createHttpClient({ serverUrl: srv.url, botToken: 'test' })
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test',
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
      const handler = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const { ciphertext } = buildCiphertext('greet', {})
      await handler({
        command_id: 'cmd3',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext
      })

      assert.equal(srv.requests.length, 2)
      assert.equal(srv.requests[0].url, '/bots/me/messages')
      assert.equal(srv.requests[1].url, '/bots/me/commands/cmd3/ack')
    } finally {
      await srv.close()
    }
  })

  it('4. Handler exception produces local_message error result and acks', async () => {
    const srv = await startServer()
    try {
      const http = createHttpClient({ serverUrl: srv.url, botToken: 'test' })
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          boom: {
            args: {},
            handler () { throw new Error('boom error') }
          }
        }
      })
      const handler = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const { ciphertext } = buildCiphertext('boom')
      await handler({
        command_id: 'cmd4',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext
      })

      assert.equal(srv.requests.length, 2)
      assert.equal(srv.requests[0].url, '/bots/me/messages')
      assert.equal(srv.requests[1].url, '/bots/me/commands/cmd4/ack')
    } finally {
      await srv.close()
    }
  })

  it('5. Handler timeout produces local_message timeout error and acks', async () => {
    const srv = await startServer()
    try {
      const http = createHttpClient({ serverUrl: srv.url, botToken: 'test' })
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          slow: {
            args: {},
            async handler () {
              await new Promise((r) => setTimeout(r, 200))
              return { type: 'none' }
            }
          }
        }
      })
      const handler = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({})),
        handlerTimeoutMs: 50
      })

      const { ciphertext } = buildCiphertext('slow')
      await handler({
        command_id: 'cmd5',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext
      })

      assert.equal(srv.requests.length, 2)
      assert.equal(srv.requests[0].url, '/bots/me/messages')
      assert.equal(srv.requests[1].url, '/bots/me/commands/cmd5/ack')
    } finally {
      await srv.close()
    }
  })

  it('6. Room message result routes via ctx.post', async () => {
    let postCalled = false
    const srv = await startServer()
    try {
      const http = createHttpClient({ serverUrl: srv.url, botToken: 'test' })
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          echo: {
            args: {},
            handler () {
              return { type: 'room_message', content: 'hello room' }
            }
          }
        }
      })
      const handler = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({
          post: async (opts) => {
            postCalled = true
            assert.equal(opts.roomId, 'r1')
            assert.equal(opts.text, 'hello room')
          }
        }))
      })

      const { ciphertext } = buildCiphertext('echo')
      await handler({
        command_id: 'cmd6',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext
      })

      assert.equal(postCalled, true)
      assert.equal(srv.requests.length, 1)
      assert.equal(srv.requests[0].url, '/bots/me/commands/cmd6/ack')
    } finally {
      await srv.close()
    }
  })

  it('7. Malformed ciphertext logs and acks without handler execution', async () => {
    const srv = await startServer()
    try {
      const http = createHttpClient({ serverUrl: srv.url, botToken: 'test' })
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {}
      })
      const handler = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      await handler({
        command_id: 'cmd7',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext: 'invalid_ciphertext'
      })

      assert.equal(srv.requests.length, 1)
      assert.equal(srv.requests[0].url, '/bots/me/commands/cmd7/ack')
    } finally {
      await srv.close()
    }
  })

  it('8. Shutdown state produces a local_message with the shutdown text', async () => {
    let handlerCalled = false
    const srv = await startServer()
    try {
      const http = createHttpClient({ serverUrl: srv.url, botToken: 'test' })
      const shutdownTracker = createShutdownTracker()
      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          ping: {
            args: {},
            handler () {
              handlerCalled = true
              return { type: 'none' }
            }
          }
        }
      })
      const handler = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        shutdownTracker,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      shutdownTracker.startShutdown()
      const { ciphertext } = buildCiphertext('ping')
      await handler({
        command_id: 'cmd8',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext
      })

      assert.equal(handlerCalled, false)
      assert.equal(srv.requests.length, 2)
      assert.equal(srv.requests[0].url, '/bots/me/messages')
      assert.equal(srv.requests[0].body.target, 'invoker')
      assert.equal(srv.requests[1].url, '/bots/me/commands/cmd8/ack')
    } finally {
      await srv.close()
    }
  })

  it('9. track wraps the handler invocation', async () => {
    let trackedCount = 0
    const srv = await startServer()
    try {
      const http = createHttpClient({ serverUrl: srv.url, botToken: 'test' })
      const shutdownTracker = createShutdownTracker()
      const origTrack = shutdownTracker.track.bind(shutdownTracker)
      shutdownTracker.track = function (fn) {
        trackedCount++
        return origTrack(fn)
      }

      const bot = defineBot({
        id: 'com.example.test',
        apiVersion: '1.0',
        hostApi: '1.0',
        label: 'test',
        capabilities: ['post_message'],
        handlers: { install () {} },
        commands: {
          ping: {
            args: {},
            handler () {
              return { type: 'none' }
            }
          }
        }
      })
      const handler = createCommandInvocationHandler({
        botCommandPrivateKey: BOT_COMMAND_PRIVATE,
        bot,
        http,
        shutdownTracker,
        makeBotCtx: async () => (/** @type {any} */ ({}))
      })

      const { ciphertext } = buildCiphertext('ping')
      await handler({
        command_id: 'cmd9',
        room_id: 'r1',
        sender_user_id: 'u1',
        sender_client_id: 'c1',
        ciphertext
      })

      assert.equal(trackedCount, 1)
    } finally {
      await srv.close()
    }
  })
})

describe('dispatchCommandResult Edge Cases', () => {
  it('Validates arguments and options', async () => {
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
