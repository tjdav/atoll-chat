// @ts-nocheck
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { createHmac, randomUUID } from 'node:crypto'
import { createWebhookServer, verifySignature, extractHeader } from '../../src/runtime/triggers/webhook.js'
import { IdempotencyStore } from '../../src/runtime/idempotency/index.js'
import { createShutdownTracker } from '../../src/runtime/shutdown.js'

/**
 * Helper to generate a random temporary storage path.
 *
 * @returns {string} - Storage path.
 */
function tempStoragePath () {
  return `/tmp/atoll-test-webhook-${randomUUID()}.storage`
}

/**
 * Creates a minimal in-memory state store for idempotency tests.
 */
function createFakeStorage () {
  /** @type {Map<string, string>} */
  const map = new Map()
  return {
    path: tempStoragePath(),
    async open () {},
    async close () {},
    async get (key) { return map.get(key) ?? null },
    async set (key, val) { map.set(key, val) },
    async delete (key) { map.delete(key) }
  }
}

/**
 * Helper to compute HMAC SHA-256 hex string.
 *
 * @param {string} secret - Secret key.
 * @param {string} body - Body string.
 * @returns {string} - Hex string.
 */
function hmacSha256Hex (secret, body) {
  return createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * Helper to send HTTP request and collect response.
 *
 * @param {string} url - Request URL.
 * @param {object} [options] - Options.
 * @param {string} [options.method='POST'] - HTTP method.
 * @param {Record<string, string>} [options.headers={}] - Headers.
 * @param {string} [options.body=''] - Body.
 * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: string }>}
 */
function sendRequest (url, { method = 'POST', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = httpRequest({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers
    }, (res) => {
      let resBody = ''
      res.on('data', (chunk) => { resBody += chunk })
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: resBody
        })
      })
    })

    req.on('error', reject)
    if (body) {
      req.write(body)
    }
    req.end()
  })
}

/**
 * Helper to bootstrap and start a createWebhookServer instance.
 */
async function startWebhookServer ({
  triggers = [{ type: 'webhook', path: '/hook' }],
  basePath = '',
  maxBodyBytes = 1024 * 1024,
  timeoutMs = 5000,
  secrets = {},
  handler,
  shutdownTracker,
  logger
}) {
  const fakeStorage = createFakeStorage()
  const idempotency = new IdempotencyStore({ storage: fakeStorage })

  const server = createWebhookServer({
    config: {
      host: '127.0.0.1',
      port: 0,
      basePath,
      maxBodyBytes,
      timeoutMs
    },
    triggers,
    makeBotCtx: async (invocation) => (/** @type {any} */ ({
      webhook: async (ctx, inv) => {
        if (handler) {
          await handler(ctx, inv)
        }
      }
    })),
    idempotency,
    shutdownTracker,
    env: secrets,
    logger
  })

  await server.start()
  const port = server.getBoundPort()
  const url = `http://127.0.0.1:${port}${basePath}`

  return {
    server,
    url,
    port,
    async cleanup () {
      await server.stop()
    }
  }
}

describe('Webhook Trigger Server Unit Tests', () => {
  describe('Signature & Header Helpers', () => {
    test('1. extractHeader handles single, array, and case-insensitivity', () => {
      const headers = {
        'X-Signature-256': 'sig123',
        authorization: ['Bearer tok1', 'Bearer tok2']
      }
      assert.equal(extractHeader(headers, 'x-signature-256'), 'sig123')
      assert.equal(extractHeader(headers, 'X-SIGNATURE-256'), 'sig123')
      assert.equal(extractHeader(headers, 'Authorization'), 'Bearer tok1, Bearer tok2')
      assert.equal(extractHeader(headers, 'missing'), undefined)
    })

    test('2. verifySignature HMAC _SECRET verification', () => {
      const secret = 'supersecret'
      const body = Buffer.from('{"hello":"world"}')
      const hexSig = hmacSha256Hex(secret, body)

      const okRes = verifySignature({
        secretName: 'HOOK_SECRET',
        secretValue: secret,
        rawBody: body,
        headers: { 'x-signature-256': `sha256=${hexSig}` }
      })
      assert.equal(okRes.ok, true)

      const badSig = verifySignature({
        secretName: 'HOOK_SECRET',
        secretValue: secret,
        rawBody: body,
        headers: { 'x-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' }
      })
      assert.equal(badSig.ok, false)
      assert.equal(badSig.message, 'Invalid signature')
    })

    test('3. verifySignature Bearer _TOKEN verification', () => {
      const token = 'my-secret-token'
      const okRes = verifySignature({
        secretName: 'HOOK_TOKEN',
        secretValue: token,
        rawBody: Buffer.from(''),
        headers: { authorization: `Bearer ${token}` }
      })
      assert.equal(okRes.ok, true)

      const badRes = verifySignature({
        secretName: 'HOOK_TOKEN',
        secretValue: token,
        rawBody: Buffer.from(''),
        headers: { authorization: 'Bearer wrong-token' }
      })
      assert.equal(badRes.ok, false)
      assert.equal(badRes.message, 'Invalid token')
    })
  })

  describe('Server Routing & Validation', () => {
    test('4. Unmatched path returns 404', async () => {
      const { url, cleanup } = await startWebhookServer({
        triggers: [{ type: 'webhook', path: '/valid' }]
      })
      try {
        const res = await sendRequest(`${url}/invalid`)
        assert.equal(res.status, 404)
        assert.equal(JSON.parse(res.body).error, 'not_found')
      } finally {
        await cleanup()
      }
    })

    test('5. Unmatched method returns 405', async () => {
      const { url, cleanup } = await startWebhookServer({
        triggers: [{ type: 'webhook', path: '/hook', method: 'POST' }]
      })
      try {
        const res = await sendRequest(`${url}/hook`, { method: 'GET' })
        assert.equal(res.status, 405)
        assert.equal(JSON.parse(res.body).error, 'method_not_allowed')
      } finally {
        await cleanup()
      }
    })

    test('6. Body exceeding maxBodyBytes returns 413', async () => {
      const { url, cleanup } = await startWebhookServer({
        maxBodyBytes: 10
      })
      try {
        const res = await sendRequest(`${url}/hook`, { body: '123456789012345' })
        assert.equal(res.status, 413)
        assert.equal(JSON.parse(res.body).error, 'request_too_large')
      } finally {
        await cleanup()
      }
    })
  })

  describe('Shutdown State', () => {
    test('7. Shutdown state returns 503 with bot_shutting_down and skips handler', async () => {
      let handlerRan = false
      const shutdownTracker = createShutdownTracker()
      const { url, cleanup } = await startWebhookServer({
        triggers: [{ type: 'webhook', path: '/hook' }],
        shutdownTracker,
        handler: async () => {
          handlerRan = true
        }
      })
      try {
        shutdownTracker.startShutdown()
        const res = await sendRequest(`${url}/hook`, { body: 'test' })
        assert.equal(res.status, 503)
        const parsed = JSON.parse(res.body)
        assert.equal(parsed.error, 'bot_shutting_down')
        assert.equal(parsed.message, 'The bot is shutting down.')
        assert.equal(handlerRan, false)
      } finally {
        await cleanup()
      }
    })
  })

  describe('Logging & Redaction', () => {
    test('8. Redacts secret values and raw body from logs', async () => {
      const sentinelSecret = 'SUPER_SECRET_123'
      const sentinelBody = 'PAYLOAD_SECRET_DATA'
      /** @type {string[]} */
      const logs = []
      const logger = {
        debug: (/** @type {string} */ msg, /** @type {any} */ meta) => logs.push(JSON.stringify({ msg, meta })),
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
})
