import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { createHmac, randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { createWebhookServer } from '../../src/runtime/triggers/webhook.js'
import { IdempotencyStore } from '../../src/runtime/idempotency/index.js'
import { Storage } from '../../src/runtime/storage/index.js'

/**
 * @param {string} secret
 * @param {string} body
 * @returns {string}
 */
function hmacSha256Hex (secret, body) {
  return createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * @param {string} urlStr
 * @param {{ method?: string, headers?: Record<string, string | string[]>, body?: string | Buffer | null }} [opts]
 * @returns {Promise<{ statusCode: number, headers: import('node:http').IncomingHttpHeaders, body: string, json: any }>}
 */
async function sendRequest (urlStr, { method = 'POST', headers = {}, body } = {}) {
  const url = new URL(urlStr)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers
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
    if (body !== undefined && body !== null) {
      if (Buffer.isBuffer(body) || typeof body === 'string') {
        req.write(body)
      }
    }
    req.end()
  })
}

/**
 * @param {object} opts
 * @param {WebhookTrigger[]} opts.triggers
 * @param {Record<string, string>} [opts.secrets]
 * @param {(ctx: any, payload: any, invocation: any) => Promise<void> | void} [opts.handler]
 * @param {Partial<{ host: string, port: number, basePath: string, maxBodyBytes: number, timeoutMs: number }>} [opts.config]
 * @param {(invocation: any) => Promise<any>} [opts.makeBotCtxOverride]
 * @param {any} [opts.logger]
 */
async function startWebhookServer ({
  triggers,
  secrets = {},
  handler,
  config = {},
  makeBotCtxOverride,
  logger
}) {
  const tmpPath = `/tmp/wh-test-${randomUUID()}.json`
  const storage = new Storage({
    path: tmpPath,
    seed: Buffer.alloc(32, 0x01),
    botId: 'b_test'
  })
  await storage.open()
  const idempotency = new IdempotencyStore({ storage })

  const makeBotCtx = makeBotCtxOverride ?? (async (invocation) => {
    return /** @type {any} */ ({
      webhook: handler ? (/** @type {any} */ ctx, /** @type {any} */ payload) => handler(ctx, payload, invocation) : undefined
    })
  })

  const server = createWebhookServer({
    config: {
      host: '127.0.0.1',
      port: 0,
      basePath: '',
      maxBodyBytes: 1024 * 1024,
      timeoutMs: 5000,
      ...config
    },
    triggers,
    makeBotCtx,
    idempotency,
    env: secrets,
    logger
  })

  await server.start()
  const port = server.getBoundPort()

  async function cleanup () {
    await server.stop()
    await storage.clear()
    try {
      await unlink(tmpPath)
    } catch (_e) {}
  }

  return {
    server,
    port,
    url: port ? `http://127.0.0.1:${port}` : null,
    storage,
    idempotency,
    cleanup
  }
}

describe('Webhook Server Unit Tests', () => {
  // Lifecycle
  test('1. Zero webhook triggers -> start() is a no-op', async () => {
    const { server, cleanup } = await startWebhookServer({ triggers: [] })
    try {
      assert.equal(server.getBoundPort(), null)
    } finally {
      await cleanup()
    }
  })

  test('2. start() binds a server on the configured port', async () => {
    const { server, port, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }]
    })
    try {
      assert.ok(typeof port === 'number' && port > 0)
      assert.equal(server.getBoundPort(), port)
    } finally {
      await cleanup()
    }
  })

  test('3. start() is idempotent', async () => {
    const { server, port, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }]
    })
    try {
      await server.start()
      assert.equal(server.getBoundPort(), port)
    } finally {
      await cleanup()
    }
  })

  test('4. stop() closes the server', async () => {
    const { server, url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }]
    })
    assert.ok(url)
    await server.stop()
    assert.equal(server.getBoundPort(), null)
    await assert.rejects(sendRequest(`${url}/hook`))
    await cleanup()
  })

  test('5. stop() is idempotent', async () => {
    const { server, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }]
    })
    try {
      await server.stop()
      await server.stop()
      assert.equal(server.getBoundPort(), null)
    } finally {
      await cleanup()
    }
  })

  test('6. getBoundPort() returns null before start()', async () => {
    const storage = new Storage({
      path: `/tmp/wh-test-${randomUUID()}.json`,
      seed: Buffer.alloc(32, 0x01),
      botId: 'b_test'
    })
    await storage.open()
    const idempotency = new IdempotencyStore({ storage })
    const server = createWebhookServer({
      config: {
        host: '127.0.0.1',
        port: 0,
        basePath: '',
        maxBodyBytes: 1024 * 1024,
        timeoutMs: 5000
      },
      triggers: [{ type: 'webhook', path: '/hook' }],
      makeBotCtx: async () => /** @type {any} */ ({}),
      idempotency
    })
    assert.equal(server.getBoundPort(), null)
    await storage.clear()
  })

  // Matching
  test('7. POST to a declared path dispatches', async () => {
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.equal(res.statusCode, 200)
      assert.equal(res.body, '')
      assert.equal(called, 1)
    } finally {
      await cleanup()
    }
  })

  test('8. GET to a declared path with method POST -> 405', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', method: 'POST' }]
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'GET' })
      assert.equal(res.statusCode, 405)
      assert.equal(res.json?.error, 'method_not_allowed')
    } finally {
      await cleanup()
    }
  })

  test('9. POST to an undeclared path -> 404', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }]
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/other`, { method: 'POST' })
      assert.equal(res.statusCode, 404)
      assert.equal(res.json?.error, 'not_found')
    } finally {
      await cleanup()
    }
  })

  test('10. Declared path with method PUT dispatches when trigger declares method: PUT', async () => {
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', method: 'PUT' }],
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'PUT' })
      assert.equal(res.statusCode, 200)
      assert.equal(called, 1)
    } finally {
      await cleanup()
    }
  })

  test('11. basePath: /api requires the full path', async () => {
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      config: { basePath: '/api' },
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      const res404 = await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.equal(res404.statusCode, 404)

      const res200 = await sendRequest(`${url}/api/hook`, { method: 'POST' })
      assert.equal(res200.statusCode, 200)
      assert.equal(called, 1)
    } finally {
      await cleanup()
    }
  })

  test('12. Query string stripped from matching', async () => {
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook?x=1&y=2`, { method: 'POST' })
      assert.equal(res.statusCode, 200)
      assert.equal(called, 1)
    } finally {
      await cleanup()
    }
  })

  // Body
  test('13. Body is passed to the handler verbatim', async () => {
    /** @type {string | null} */
    let receivedBody = null
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async (_ctx, payload) => {
        receivedBody = payload.body
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST', body: 'hello' })
      assert.equal(res.statusCode, 200)
      assert.equal(receivedBody, 'hello')
    } finally {
      await cleanup()
    }
  })

  test('14. Large body within limit is accepted', async () => {
    const largeStr = 'a'.repeat(64 * 1024)
    /** @type {string | null} */
    let receivedBody = null
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async (_ctx, payload) => {
        receivedBody = payload.body
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST', body: largeStr })
      assert.equal(res.statusCode, 200)
      assert.equal(receivedBody, largeStr)
    } finally {
      await cleanup()
    }
  })

  test('15. Body over limit -> 413', async () => {
    const { url, cleanup } = await startWebhookServer({
      config: { maxBodyBytes: 100 },
      triggers: [{ type: 'webhook', path: '/hook' }]
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST', body: 'a'.repeat(200) })
      assert.equal(res.statusCode, 413)
      assert.equal(res.json?.error, 'request_too_large')
    } finally {
      await cleanup()
    }
  })

  test('16. Empty body is accepted', async () => {
    /** @type {string | null} */
    let receivedBody = null
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async (_ctx, payload) => {
        receivedBody = payload.body
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST', body: '' })
      assert.equal(res.statusCode, 200)
      assert.equal(receivedBody, '')
    } finally {
      await cleanup()
    }
  })

  // HMAC verification (_SECRET)
  test('17. Valid HMAC via x-hub-signature-256 succeeds', async () => {
    const secret = 'supersecret'
    const body = 'hello world'
    const sig = `sha256=${hmacSha256Hex(secret, body)}`
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_SECRET' }],
      secrets: { HOOK_SECRET: secret },
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'x-hub-signature-256': sig },
        body
      })
      assert.equal(res.statusCode, 200)
      assert.equal(called, 1)
    } finally {
      await cleanup()
    }
  })

  test('18. Valid HMAC via x-signature-256 succeeds', async () => {
    const secret = 'supersecret'
    const body = 'hello world'
    const sig = hmacSha256Hex(secret, body)
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_SECRET' }],
      secrets: { HOOK_SECRET: secret },
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'x-signature-256': sig },
        body
      })
      assert.equal(res.statusCode, 200)
      assert.equal(called, 1)
    } finally {
      await cleanup()
    }
  })

  test('19. Missing signature header -> 401', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_SECRET' }],
      secrets: { HOOK_SECRET: 'secret' }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST', body: 'hello' })
      assert.equal(res.statusCode, 401)
      assert.equal(res.json?.error, 'unauthorized')
      assert.equal(res.json?.message, 'Missing signature header')
    } finally {
      await cleanup()
    }
  })

  test('20. Malformed hex signature -> 401', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_SECRET' }],
      secrets: { HOOK_SECRET: 'secret' }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'x-signature-256': 'invalid-hex' },
        body: 'hello'
      })
      assert.equal(res.statusCode, 401)
      assert.equal(res.json?.error, 'unauthorized')
      assert.equal(res.json?.message, 'Malformed signature')
    } finally {
      await cleanup()
    }
  })

  test('21. Wrong signature -> 401', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_SECRET' }],
      secrets: { HOOK_SECRET: 'secret' }
    })
    try {
      assert.ok(url)
      const wrongSig = hmacSha256Hex('wrongsecret', 'hello')
      const res = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'x-signature-256': wrongSig },
        body: 'hello'
      })
      assert.equal(res.statusCode, 401)
      assert.equal(res.json?.error, 'unauthorized')
      assert.equal(res.json?.message, 'Invalid signature')
    } finally {
      await cleanup()
    }
  })

  test('22. Signature over a different body -> 401', async () => {
    const secret = 'secret'
    const sig = hmacSha256Hex(secret, 'original body')
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_SECRET' }],
      secrets: { HOOK_SECRET: secret }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'x-signature-256': sig },
        body: 'tampered body'
      })
      assert.equal(res.statusCode, 401)
      assert.equal(res.json?.error, 'unauthorized')
      assert.equal(res.json?.message, 'Invalid signature')
    } finally {
      await cleanup()
    }
  })

  test('23. Case sensitivity: X-Hub-Signature-256 header key is normalized', async () => {
    const secret = 'supersecret'
    const body = 'hello world'
    const sig = `sha256=${hmacSha256Hex(secret, body)}`
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_SECRET' }],
      secrets: { HOOK_SECRET: secret },
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'X-Hub-Signature-256': sig },
        body
      })
      assert.equal(res.statusCode, 200)
      assert.equal(called, 1)
    } finally {
      await cleanup()
    }
  })

  // Bearer verification (_TOKEN)
  test('24. Valid Bearer token succeeds', async () => {
    const token = 'my-secret-bearer-token'
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_TOKEN' }],
      secrets: { HOOK_TOKEN: token },
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      assert.equal(res.statusCode, 200)
      assert.equal(called, 1)
    } finally {
      await cleanup()
    }
  })

  test('25. Missing Authorization header -> 401', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_TOKEN' }],
      secrets: { HOOK_TOKEN: 'token' }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.equal(res.statusCode, 401)
      assert.equal(res.json?.error, 'unauthorized')
      assert.equal(res.json?.message, 'Missing authorization header')
    } finally {
      await cleanup()
    }
  })

  test('26. Wrong token -> 401', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_TOKEN' }],
      secrets: { HOOK_TOKEN: 'correct-token' }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' }
      })
      assert.equal(res.statusCode, 401)
      assert.equal(res.json?.error, 'unauthorized')
      assert.equal(res.json?.message, 'Invalid token')
    } finally {
      await cleanup()
    }
  })

  test('27. Wrong scheme (Basic <token>) -> 401', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_TOKEN' }],
      secrets: { HOOK_TOKEN: 'token' }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { Authorization: 'Basic token' }
      })
      assert.equal(res.statusCode, 401)
      assert.equal(res.json?.error, 'unauthorized')
      assert.equal(res.json?.message, 'Invalid authorization scheme')
    } finally {
      await cleanup()
    }
  })

  test('28. Bearer is case-insensitive', async () => {
    const token = 'my-token'
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_TOKEN' }],
      secrets: { HOOK_TOKEN: token },
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { authorization: `bearer ${token}` }
      })
      assert.equal(res.statusCode, 200)
      assert.equal(called, 1)
    } finally {
      await cleanup()
    }
  })

  // Unsupported suffix
  test('29. Env var name not ending in _SECRET or _TOKEN -> 500', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'PLAIN_NAME' }],
      secrets: { PLAIN_NAME: 'someval' }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.equal(res.statusCode, 500)
      assert.equal(res.json?.error, 'internal')
      assert.ok(res.json?.message.includes("Unsupported secret variable suffix 'PLAIN_NAME'"))
    } finally {
      await cleanup()
    }
  })

  // Idempotency
  test('30. First request dispatches; second with the same key is a hit', async () => {
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', idempotency: 'header:x-request-id' }],
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      const res1 = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'x-request-id': 'req-123' }
      })
      assert.equal(res1.statusCode, 200)
      assert.equal(called, 1)

      const res2 = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'x-request-id': 'req-123' }
      })
      assert.equal(res2.statusCode, 200)
      assert.equal(called, 1)
    } finally {
      await cleanup()
    }
  })

  test('31. Different keys both dispatch', async () => {
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', idempotency: 'header:x-request-id' }],
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      await sendRequest(`${url}/hook`, { method: 'POST', headers: { 'x-request-id': 'req-1' } })
      await sendRequest(`${url}/hook`, { method: 'POST', headers: { 'x-request-id': 'req-2' } })
      assert.equal(called, 2)
    } finally {
      await cleanup()
    }
  })

  test('32. No idempotency declaration generates a fresh UUID per request', async () => {
    let called = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async () => {
        called++
      }
    })
    try {
      assert.ok(url)
      await sendRequest(`${url}/hook`, { method: 'POST' })
      await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.equal(called, 2)
    } finally {
      await cleanup()
    }
  })

  test('33. Handler throw removes the idempotency key', async () => {
    let attempts = 0
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', idempotency: 'header:x-request-id' }],
      handler: async () => {
        attempts++
        if (attempts === 1) {
          throw new Error('first attempt failed')
        }
      }
    })
    try {
      assert.ok(url)
      const res1 = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'x-request-id': 'req-fail' }
      })
      assert.equal(res1.statusCode, 500)
      assert.equal(attempts, 1)

      const res2 = await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'x-request-id': 'req-fail' }
      })
      assert.equal(res2.statusCode, 200)
      assert.equal(attempts, 2)
    } finally {
      await cleanup()
    }
  })

  // Dispatch and response codes
  test('34. Handler resolves -> 200 empty body', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async () => {}
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.equal(res.statusCode, 200)
      assert.equal(res.body, '')
    } finally {
      await cleanup()
    }
  })

  test('35. Handler throws -> 500 with { error: handler_failed }', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async () => {
        throw new Error('something went wrong')
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.equal(res.statusCode, 500)
      assert.equal(res.json?.error, 'handler_failed')
      assert.equal(res.json?.message, 'something went wrong')
    } finally {
      await cleanup()
    }
  })

  test('36. Handler times out -> 504', async () => {
    const { url, cleanup } = await startWebhookServer({
      config: { timeoutMs: 30 },
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.equal(res.statusCode, 504)
      assert.equal(res.json?.error, 'handler_timeout')
    } finally {
      await cleanup()
    }
  })

  test('37. makeBotCtx rejects -> 500 with { error: internal }', async () => {
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      makeBotCtxOverride: async () => {
        throw new Error('ctx construct failed')
      }
    })
    try {
      assert.ok(url)
      const res = await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.equal(res.statusCode, 500)
      assert.equal(res.json?.error, 'internal')
      assert.equal(res.json?.message, 'ctx construct failed')
    } finally {
      await cleanup()
    }
  })

  // Headers normalization
  test('38. Headers passed to handler are lowercase', async () => {
    /** @type {Record<string, string> | null} */
    let receivedHeaders = null
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async (_ctx, payload) => {
        receivedHeaders = payload.headers
      }
    })
    try {
      assert.ok(url)
      await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'X-Request-ID': 'req-abc' }
      })
      assert.ok(receivedHeaders)
      /** @type {any} */
      const rh = receivedHeaders
      assert.equal(rh['x-request-id'], 'req-abc')
    } finally {
      await cleanup()
    }
  })

  test('39. Array-valued headers are joined with , ', async () => {
    /** @type {Record<string, string> | null} */
    let receivedHeaders = null
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async (_ctx, payload) => {
        receivedHeaders = payload.headers
      }
    })
    try {
      assert.ok(url)
      await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { Accept: ['text/html', 'application/json'] }
      })
      assert.ok(receivedHeaders)
      /** @type {any} */
      const rh = receivedHeaders
      assert.equal(rh.accept, 'text/html, application/json')
    } finally {
      await cleanup()
    }
  })

  // Logging
  test('40. Logger emits debug on receipt and success', async () => {
    /** @type {Array<{ level: string, msg: string, meta: any }>} */
    const logs = []
    const logger = {
      debug: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push({ level: 'debug', msg, meta }),
      info: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push({ level: 'info', msg, meta }),
      warn: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push({ level: 'warn', msg, meta }),
      error: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push({ level: 'error', msg, meta })
    }
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async () => {},
      logger
    })
    try {
      assert.ok(url)
      await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.ok(logs.some((l) => l.level === 'debug' && l.msg === 'webhook request received'))
      assert.ok(logs.some((l) => l.level === 'debug' && l.msg === 'webhook dispatch success'))
    } finally {
      await cleanup()
    }
  })

  test('41. Logger emits warn on 401', async () => {
    /** @type {Array<{ level: string, msg: string, meta: any }>} */
    const logs = []
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push({ level: 'warn', msg, meta }),
      error: () => {}
    }
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_SECRET' }],
      secrets: { HOOK_SECRET: 'secret' },
      logger
    })
    try {
      assert.ok(url)
      await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.ok(logs.some((l) => l.level === 'warn' && l.msg === 'webhook verification failed'))
    } finally {
      await cleanup()
    }
  })

  test('42. Logger emits error on 500', async () => {
    /** @type {Array<{ level: string, msg: string, meta: any }>} */
    const logs = []
    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push({ level: 'error', msg, meta })
    }
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook' }],
      handler: async () => {
        throw new Error('handler error')
      },
      logger
    })
    try {
      assert.ok(url)
      await sendRequest(`${url}/hook`, { method: 'POST' })
      assert.ok(logs.some((l) => l.level === 'error' && l.msg === 'webhook handler failed'))
    } finally {
      await cleanup()
    }
  })

  test('43. Logger does not log request body or secret', async () => {
    const sentinelBody = 'SENTINEL_BODY_XYZ123'
    const sentinelSecret = 'SENTINEL_SECRET_ABC456'
    /** @type {string[]} */
    const logs = []
    const logger = {
      debug: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push(JSON.stringify({ msg, meta })),
      info: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push(JSON.stringify({ msg, meta })),
      warn: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push(JSON.stringify({ msg, meta })),
      error: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push(JSON.stringify({ msg, meta }))
    }
    const sig = hmacSha256Hex(sentinelSecret, sentinelBody)
    const { url, cleanup } = await startWebhookServer({
      triggers: [{ type: 'webhook', path: '/hook', secret: 'HOOK_SECRET' }],
      secrets: { HOOK_SECRET: sentinelSecret },
      handler: async () => {},
      logger
    })
    try {
      assert.ok(url)
      await sendRequest(`${url}/hook`, {
        method: 'POST',
        headers: { 'x-signature-256': sig },
        body: sentinelBody
      })
      for (const logStr of logs) {
        assert.ok(!logStr.includes(sentinelBody), `Log contains sentinel body: ${logStr}`)
        assert.ok(!logStr.includes(sentinelSecret), `Log contains sentinel secret: ${logStr}`)
      }
    } finally {
      await cleanup()
    }
  })
})
