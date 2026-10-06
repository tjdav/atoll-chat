import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createPublicKey } from 'node:crypto'
import { createSendLocalHandler } from '../../src/runtime/context/send-local.js'
import { createHttpClient } from '../../src/runtime/transport/http.js'
import {
  decrypt,
  keyObjectFromX25519Private
} from '../../src/runtime/crypto/command-result.js'
import { SendLocalFailedError, HttpRequestError } from '../../src/errors.js'

/** @type {Uint8Array} */
const OWNER_PRIVATE = Buffer.alloc(32, 0x44)
/** @type {Uint8Array} */
const OWNER_PUBLIC = new Uint8Array(
  createPublicKey(
    keyObjectFromX25519Private(OWNER_PRIVATE)
  ).export({ type: 'spki', format: 'der' }).subarray(12)
)

/**
 * @param {import('node:http').RequestListener} handler - HTTP request handler.
 * @returns {Promise<{ server: import('node:http').Server, url: string }>} Server instance and URL.
 */
function startServer (handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        server,
        url: `http://127.0.0.1:${port}`
      })
    })
  })
}

/**
 * @param {Array<{ level: string, msg: string, meta: any }>} logs - Log array collector.
 * @returns {import('../../src/runtime/diagnostics/logger.js').Logger} Mock logger instance.
 */
function createMockLogger (logs) {
  return {
    level: () => 'debug',
    log: () => {},
    info: () => {},
    debug: (msg, meta) => {
      logs.push({
        level: 'debug',
        msg,
        meta
      })
    },
    warn: (msg, meta) => {
      logs.push({
        level: 'warn',
        msg,
        meta
      })
    },
    error: (msg, meta) => {
      logs.push({
        level: 'error',
        msg,
        meta
      })
    }
  }
}

test('ctx.sendLocal unit tests', async (t) => {
  await t.test('1. Happy path', async () => {
    /** @type {Array<{ method: string | undefined, url: string | undefined, body: any }>} */
    const requests = []
    const { server, url } = await startServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        requests.push({
          method: req.method,
          url: req.url,
          body: JSON.parse(body)
        })
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({
          status: 'ok'
        }))
      })
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await assert.doesNotReject(sendLocal({
        text: 'Hello owner'
      }))
      assert.equal(requests.length, 1)
    } finally {
      server.close()
    }
  })

  await t.test('2. Request path is POST /bots/me/messages', async () => {
    /** @type {any} */
    let recordedReq = null
    const { server, url } = await startServer((req, res) => {
      recordedReq = {
        method: req.method,
        url: req.url
      }
      res.writeHead(200, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({}))
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await sendLocal({
        text: 'Path check'
      })
      assert.notEqual(recordedReq, null)
      if (recordedReq !== null) {
        assert.equal(recordedReq.method, 'POST')
        assert.equal(recordedReq.url, '/bots/me/messages')
      }
    } finally {
      server.close()
    }
  })

  await t.test('3. Request body shape', async () => {
    /** @type {any} */
    let recordedBody = null
    const { server, url } = await startServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        recordedBody = JSON.parse(body)
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({}))
      })
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await sendLocal({
        text: 'Body shape'
      })
      assert.equal(recordedBody.target, 'owner')
      assert.equal(recordedBody.result_type, 'local_message')
      assert.ok(typeof recordedBody.ciphertext === 'string')
      assert.ok(typeof recordedBody.bot_result_pubkey === 'string')
      assert.ok(typeof recordedBody.request_id === 'string' && recordedBody.request_id.length > 0)

      const keys = Object.keys(recordedBody).sort()
      assert.deepEqual(keys, [
        'bot_result_pubkey',
        'ciphertext',
        'request_id',
        'result_type',
        'target'
      ])
    } finally {
      server.close()
    }
  })

  await t.test('4. Ciphertext decodes to the correct plaintext', async () => {
    /** @type {any} */
    let recordedBody = null
    const { server, url } = await startServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        recordedBody = JSON.parse(body)
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({}))
      })
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await sendLocal({
        text: 'Secret message for owner'
      })

      const ciphertext = new Uint8Array(Buffer.from(recordedBody.ciphertext, 'base64url'))
      const peerPublicKey = new Uint8Array(Buffer.from(recordedBody.bot_result_pubkey, 'base64url'))

      const decryptedBytes = decrypt({
        privateKey: OWNER_PRIVATE,
        peerPublicKey,
        info: 'bot-command-result-v1',
        ciphertext
      })

      const decryptedText = Buffer.from(decryptedBytes).toString('utf8')
      const parsed = JSON.parse(decryptedText)
      assert.deepEqual(parsed, {
        text: 'Secret message for owner',
        format: 'text'
      })
    } finally {
      server.close()
    }
  })

  await t.test("5. format: 'markdown' propagates", async () => {
    /** @type {any} */
    let recordedBody = null
    const { server, url } = await startServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        recordedBody = JSON.parse(body)
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({}))
      })
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await sendLocal({
        text: '**Bold** markdown',
        format: 'markdown'
      })

      const ciphertext = new Uint8Array(Buffer.from(recordedBody.ciphertext, 'base64url'))
      const peerPublicKey = new Uint8Array(Buffer.from(recordedBody.bot_result_pubkey, 'base64url'))

      const decryptedBytes = decrypt({
        privateKey: OWNER_PRIVATE,
        peerPublicKey,
        info: 'bot-command-result-v1',
        ciphertext
      })

      const parsed = JSON.parse(Buffer.from(decryptedBytes).toString('utf8'))
      assert.deepEqual(parsed, {
        text: '**Bold** markdown',
        format: 'markdown'
      })
    } finally {
      server.close()
    }
  })

  await t.test('6. Missing opts.text throws SendLocalFailedError', async () => {
    const http = createHttpClient({
      serverUrl: 'http://127.0.0.1:1',
      botToken: 'token'
    })
    const sendLocal = createSendLocalHandler({
      http,
      getOwnerPubkey: async () => OWNER_PUBLIC
    })

    await assert.rejects(
      async () => {
        // @ts-expect-error - testing invalid args
        await sendLocal({})
      },
      (err) => {
        assert.ok(err instanceof SendLocalFailedError)
        assert.equal(err.code, 'send_local_failed')
        return true
      }
    )
  })

  await t.test('7. Non-string opts.text throws', async () => {
    const http = createHttpClient({
      serverUrl: 'http://127.0.0.1:1',
      botToken: 'token'
    })
    const sendLocal = createSendLocalHandler({
      http,
      getOwnerPubkey: async () => OWNER_PUBLIC
    })

    await assert.rejects(
      async () => {
        await sendLocal({
          // @ts-expect-error - testing invalid args
          text: 42
        })
      },
      (err) => {
        assert.ok(err instanceof SendLocalFailedError)
        assert.equal(err.code, 'send_local_failed')
        return true
      }
    )
  })

  await t.test('8. opts undefined throws', async () => {
    const http = createHttpClient({
      serverUrl: 'http://127.0.0.1:1',
      botToken: 'token'
    })
    const sendLocal = createSendLocalHandler({
      http,
      getOwnerPubkey: async () => OWNER_PUBLIC
    })

    await assert.rejects(
      async () => {
        // @ts-expect-error - testing invalid args
        await sendLocal()
      },
      (err) => {
        assert.ok(err instanceof SendLocalFailedError)
        assert.equal(err.code, 'send_local_failed')
        return true
      }
    )
  })

  await t.test('9. Invalid opts.format throws', async () => {
    const http = createHttpClient({
      serverUrl: 'http://127.0.0.1:1',
      botToken: 'token'
    })
    const sendLocal = createSendLocalHandler({
      http,
      getOwnerPubkey: async () => OWNER_PUBLIC
    })

    await assert.rejects(
      async () => {
        await sendLocal({
          text: 'x',
          // @ts-expect-error - testing invalid args
          format: 'html'
        })
      },
      (err) => {
        assert.ok(err instanceof SendLocalFailedError)
        assert.equal(err.code, 'send_local_failed')
        return true
      }
    )
  })

  await t.test('10. getOwnerPubkey rejection is wrapped', async () => {
    const http = createHttpClient({
      serverUrl: 'http://127.0.0.1:1',
      botToken: 'token'
    })
    const originalErr = new Error('key store unavailable')
    const sendLocal = createSendLocalHandler({
      http,
      getOwnerPubkey: async () => {
        throw originalErr
      }
    })

    await assert.rejects(
      async () => {
        await sendLocal({
          text: 'test'
        })
      },
      (err) => {
        assert.ok(err instanceof SendLocalFailedError)
        assert.equal(err.code, 'send_local_failed')
        assert.equal(err.cause, originalErr)
        return true
      }
    )
  })

  await t.test('11. getOwnerPubkey returning wrong-length key throws', async () => {
    const http = createHttpClient({
      serverUrl: 'http://127.0.0.1:1',
      botToken: 'token'
    })
    const sendLocal = createSendLocalHandler({
      http,
      getOwnerPubkey: async () => new Uint8Array(31)
    })

    await assert.rejects(
      async () => {
        await sendLocal({
          text: 'test'
        })
      },
      (err) => {
        assert.ok(err instanceof SendLocalFailedError)
        assert.equal(err.code, 'send_local_failed')
        assert.match(err.message, /32 bytes/)
        return true
      }
    )
  })

  await t.test('12. getOwnerPubkey returning non-Uint8Array throws', async () => {
    const http = createHttpClient({
      serverUrl: 'http://127.0.0.1:1',
      botToken: 'token'
    })
    const sendLocal = createSendLocalHandler({
      http,
      // @ts-expect-error - testing invalid return type
      getOwnerPubkey: async () => 'not-a-uint8array'
    })

    await assert.rejects(
      async () => {
        await sendLocal({
          text: 'test'
        })
      },
      (err) => {
        assert.ok(err instanceof SendLocalFailedError)
        assert.equal(err.code, 'send_local_failed')
        assert.match(err.message, /32 bytes/)
        return true
      }
    )
  })

  await t.test('13. HTTP 400 throws SendLocalFailedError with cause set', async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(400, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({
        error: 'bad_request'
      }))
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await assert.rejects(
        async () => {
          await sendLocal({
            text: 'test'
          })
        },
        (err) => {
          assert.ok(err instanceof SendLocalFailedError)
          assert.equal(err.code, 'send_local_failed')
          assert.ok(err.cause instanceof HttpRequestError)
          assert.equal(err.cause.status, 400)
          return true
        }
      )
    } finally {
      server.close()
    }
  })

  await t.test('14. HTTP 500 does not retry', async () => {
    let count = 0
    const { server, url } = await startServer((req, res) => {
      count++
      res.writeHead(500, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({
        error: 'internal_error'
      }))
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await assert.rejects(
        async () => {
          await sendLocal({
            text: 'test'
          })
        },
        SendLocalFailedError
      )
      assert.equal(count, 1)
    } finally {
      server.close()
    }
  })

  await t.test('15. HTTP 429 retries', async () => {
    let count = 0
    const { server, url } = await startServer((req, res) => {
      count++
      if (count === 1) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '0'
        })
        res.end(JSON.stringify({
          error: 'rate_limited'
        }))
      } else {
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({
          status: 'ok'
        }))
      }
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await sendLocal({
        text: 'test 429 retry'
      })
      assert.equal(count, 2)
    } finally {
      server.close()
    }
  })

  await t.test('16. Network failure throws SendLocalFailedError', async () => {
    const http = createHttpClient({
      serverUrl: 'http://127.0.0.1:1',
      botToken: 'test-token'
    })
    const sendLocal = createSendLocalHandler({
      http,
      getOwnerPubkey: async () => OWNER_PUBLIC
    })

    await assert.rejects(
      async () => {
        await sendLocal({
          text: 'test'
        })
      },
      (err) => {
        assert.ok(err instanceof SendLocalFailedError)
        assert.equal(err.code, 'send_local_failed')
        assert.ok(err.cause instanceof HttpRequestError)
        assert.equal(err.cause.status, 0)
        return true
      }
    )
  })

  await t.test('17. request_id is fresh per call', async () => {
    /** @type {any[]} */
    const bodies = []
    const { server, url } = await startServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        bodies.push(JSON.parse(body))
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({}))
      })
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await sendLocal({
        text: 'Msg 1'
      })
      await sendLocal({
        text: 'Msg 2'
      })

      assert.equal(bodies.length, 2)
      assert.notEqual(bodies[0].request_id, bodies[1].request_id)
    } finally {
      server.close()
    }
  })

  await t.test('18. Ephemeral public key is fresh per call', async () => {
    /** @type {any[]} */
    const bodies = []
    const { server, url } = await startServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        bodies.push(JSON.parse(body))
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({}))
      })
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await sendLocal({
        text: 'Msg 1'
      })
      await sendLocal({
        text: 'Msg 2'
      })

      assert.equal(bodies.length, 2)
      assert.notEqual(bodies[0].bot_result_pubkey, bodies[1].bot_result_pubkey)
    } finally {
      server.close()
    }
  })

  await t.test('19. Empty text is accepted', async () => {
    /** @type {any} */
    let recordedBody = null
    const { server, url } = await startServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        recordedBody = JSON.parse(body)
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({}))
      })
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await sendLocal({
        text: ''
      })

      const ciphertext = new Uint8Array(Buffer.from(recordedBody.ciphertext, 'base64url'))
      const peerPublicKey = new Uint8Array(Buffer.from(recordedBody.bot_result_pubkey, 'base64url'))

      const decryptedBytes = decrypt({
        privateKey: OWNER_PRIVATE,
        peerPublicKey,
        info: 'bot-command-result-v1',
        ciphertext
      })

      const parsed = JSON.parse(Buffer.from(decryptedBytes).toString('utf8'))
      assert.deepEqual(parsed, {
        text: '',
        format: 'text'
      })
    } finally {
      server.close()
    }
  })

  await t.test('20. Unicode text round-trips', async () => {
    const unicodeText = 'Hello 🚀 World! 🐙 日本語, Português, Español 🎉'
    /** @type {any} */
    let recordedBody = null
    const { server, url } = await startServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        recordedBody = JSON.parse(body)
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({}))
      })
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await sendLocal({
        text: unicodeText
      })

      const ciphertext = new Uint8Array(Buffer.from(recordedBody.ciphertext, 'base64url'))
      const peerPublicKey = new Uint8Array(Buffer.from(recordedBody.bot_result_pubkey, 'base64url'))

      const decryptedBytes = decrypt({
        privateKey: OWNER_PRIVATE,
        peerPublicKey,
        info: 'bot-command-result-v1',
        ciphertext
      })

      const parsed = JSON.parse(Buffer.from(decryptedBytes).toString('utf8'))
      assert.equal(parsed.text, unicodeText)
    } finally {
      server.close()
    }
  })

  await t.test('21. Long text round-trips', async () => {
    const longText = 'x'.repeat(10 * 1024)
    /** @type {any} */
    let recordedBody = null
    const { server, url } = await startServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        recordedBody = JSON.parse(body)
        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify({}))
      })
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      await sendLocal({
        text: longText
      })

      const ciphertext = new Uint8Array(Buffer.from(recordedBody.ciphertext, 'base64url'))
      const peerPublicKey = new Uint8Array(Buffer.from(recordedBody.bot_result_pubkey, 'base64url'))

      const decryptedBytes = decrypt({
        privateKey: OWNER_PRIVATE,
        peerPublicKey,
        info: 'bot-command-result-v1',
        ciphertext
      })

      const parsed = JSON.parse(Buffer.from(decryptedBytes).toString('utf8'))
      assert.equal(parsed.text, longText)
    } finally {
      server.close()
    }
  })

  await t.test('22. Logger emits entry and success lines', async () => {
    /** @type {Array<{ level: string, msg: string, meta: any }>} */
    const logs = []
    const logger = createMockLogger(logs)

    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({}))
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC,
        logger
      })

      const secretText = 'Top Secret Payload'
      await sendLocal({
        text: secretText,
        format: 'markdown'
      })

      assert.equal(logs.length, 2)
      const log0 = logs[0]
      const log1 = logs[1]
      assert.notEqual(log0, undefined)
      assert.notEqual(log1, undefined)
      if (log0 && log1) {
        assert.equal(log0.level, 'debug')
        assert.equal(log0.msg, 'ctx.sendLocal started')
        assert.equal(log0.meta.format, 'markdown')
        assert.equal(log0.meta.text_length, secretText.length)

        assert.equal(log1.level, 'debug')
        assert.equal(log1.msg, 'ctx.sendLocal succeeded')
        assert.ok(typeof log1.meta.duration_ms === 'number')
      }

      const fullLogString = JSON.stringify(logs)
      assert.equal(fullLogString.includes(secretText), false)
    } finally {
      server.close()
    }
  })

  await t.test('23. Logger emits warn on validation failure', async () => {
    /** @type {Array<{ level: string, msg: string, meta: any }>} */
    const logs = []
    const logger = createMockLogger(logs)

    const http = createHttpClient({
      serverUrl: 'http://127.0.0.1:1',
      botToken: 'test-token'
    })
    const sendLocal = createSendLocalHandler({
      http,
      getOwnerPubkey: async () => OWNER_PUBLIC,
      logger
    })

    await assert.rejects(
      async () => {
        await sendLocal({
          text: 'hi',
          // @ts-expect-error - testing invalid args
          format: 'invalid-format'
        })
      },
      SendLocalFailedError
    )

    assert.equal(logs.length, 1)
    const log0 = logs[0]
    assert.notEqual(log0, undefined)
    if (log0) {
      assert.equal(log0.level, 'warn')
      assert.equal(log0.msg, 'ctx.sendLocal validation failed')
      assert.ok(typeof log0.meta.reason === 'string')
    }
  })

  await t.test('24. Logger emits error on transport failure', async () => {
    /** @type {Array<{ level: string, msg: string, meta: any }>} */
    const logs = []
    const logger = createMockLogger(logs)

    const { server, url } = await startServer((req, res) => {
      res.writeHead(500, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({
        error: 'server_error'
      }))
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC,
        logger
      })

      await assert.rejects(
        async () => {
          await sendLocal({
            text: 'test'
          })
        },
        SendLocalFailedError
      )

      const errorLogs = logs.filter((l) => l.level === 'error')
      assert.equal(errorLogs.length, 1)
      const err0 = errorLogs[0]
      assert.notEqual(err0, undefined)
      if (err0) {
        assert.equal(err0.msg, 'ctx.sendLocal transport failed')
        assert.equal(err0.meta.status, 500)
      }
    } finally {
      server.close()
    }
  })

  await t.test('25. No ctx parameter', async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json'
      })
      res.end(JSON.stringify({}))
    })

    try {
      const http = createHttpClient({
        serverUrl: url,
        botToken: 'test-token'
      })
      const sendLocal = createSendLocalHandler({
        http,
        getOwnerPubkey: async () => OWNER_PUBLIC
      })

      const result = await sendLocal({
        text: 'No ctx needed'
      })
      assert.equal(result, undefined)
    } finally {
      server.close()
    }
  })
})
