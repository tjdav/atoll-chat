import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {
  EnqueuePayloadTooLargeError,
  EnqueuePayloadNotSerializableError,
  EnqueueInvalidRequestIdError,
  EnqueueInvalidTimeoutError,
  EnqueueMissingCannedResponseError,
  EnqueueRequestIdReusedError,
  EnqueueNetworkFailureError,
  EnqueueBudgetExhaustedError,
  EnqueueInvalidRoutingError
} from '../../src/errors.js'
import { createEnqueueMethod } from '../../src/runtime/context/enqueue.js'
import { createHttpClient } from '../../src/runtime/transport/http.js'
import { createTestRuntime } from '../../src/testing/create-test-runtime.js'
import { defineBot } from '../../src/define-bot.js'

/**
 * Creates a helper test HTTP server.
 *
 * @param {(req: http.IncomingMessage, res: http.ServerResponse, body: any) => void} handler
 * @returns {Promise<{ server: http.Server, url: string, close: () => Promise<void> }>}
 */
function createTestServer (handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        let body = null
        const raw = Buffer.concat(chunks).toString('utf8')
        if (raw) {
          try {
            body = JSON.parse(raw)
          } catch {
            body = raw
          }
        }
        handler(req, res, body)
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const url = `http://127.0.0.1:${port}`
      resolve({
        server,
        url,
        close: () => new Promise((res) => server.close(() => res()))
      })
    })
  })
}

describe('ctx.enqueue', () => {
  describe('Validation', () => {
    const dummyHttp = /** @type {any} */ ({
      request: async () => ({ status: 200, body: {} })
    })

    test('1. Non-object payload rejects with EnqueuePayloadNotSerializableError', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      await assert.rejects(
        () => enqueue(/** @type {any} */ ('invalid string')),
        EnqueuePayloadNotSerializableError
      )
      await assert.rejects(
        () => enqueue(/** @type {any} */ (123)),
        EnqueuePayloadNotSerializableError
      )
      await assert.rejects(
        () => enqueue(/** @type {any} */ (null)),
        EnqueuePayloadNotSerializableError
      )
    })

    test('2. Array payload rejects', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      await assert.rejects(
        () => enqueue(/** @type {any} */ ([1, 2, 3])),
        EnqueuePayloadNotSerializableError
      )
    })

    test('3. Circular reference rejects with EnqueuePayloadNotSerializableError', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      /** @type {any} */
      const payload = { a: 1 }
      payload.self = payload
      await assert.rejects(
        () => enqueue(payload),
        EnqueuePayloadNotSerializableError
      )
    })

    test('4. BigInt in payload rejects with EnqueuePayloadNotSerializableError', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      const payload = { num: BigInt(9007199254740991) }
      await assert.rejects(
        () => enqueue(payload),
        EnqueuePayloadNotSerializableError
      )
    })

    test('5. Payload over 64 KB rejects with EnqueuePayloadTooLargeError', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      const payload = { data: 'x'.repeat(70000) }
      await assert.rejects(
        () => enqueue(payload),
        EnqueuePayloadTooLargeError
      )
    })

    test('6. Payload at exactly 64 KB accepts', async () => {
      let recordedBody = null
      const mockHttp = /** @type {any} */ ({
        request: async (_method, _path, opts) => {
          recordedBody = opts.body
          return { status: 200, body: {} }
        }
      })
      const enqueue = createEnqueueMethod({ http: mockHttp, maxPayloadBytes: 65536 })
      // Construct a string payload so that JSON.stringify({ data }) is exactly 65536 bytes
      // '{"data":""}' is 11 bytes. 65536 - 11 = 65525.
      const payload = { data: 'a'.repeat(65525) }
      const res = await enqueue(payload)
      assert.ok(typeof res === 'string')
      assert.ok(recordedBody)
    })

    test('7. Invalid requestId rejects with EnqueueInvalidRequestIdError', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      await assert.rejects(
        () => enqueue({ q: 1 }, { requestId: '' }),
        EnqueueInvalidRequestIdError
      )
      await assert.rejects(
        () => enqueue({ q: 1 }, { requestId: 'a'.repeat(129) }),
        EnqueueInvalidRequestIdError
      )
      await assert.rejects(
        () => enqueue({ q: 1 }, { requestId: 'req@invalid!' }),
        EnqueueInvalidRequestIdError
      )
    })

    test('8. timeout: 0 rejects with EnqueueInvalidTimeoutError', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      await assert.rejects(
        () => enqueue({ q: 1 }, { timeout: 0 }),
        EnqueueInvalidTimeoutError
      )
    })

    test('9. timeout: -1 rejects', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      await assert.rejects(
        () => enqueue({ q: 1 }, { timeout: -1 }),
        EnqueueInvalidTimeoutError
      )
    })

    test('10. timeout: 2592001 rejects', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      await assert.rejects(
        () => enqueue({ q: 1 }, { timeout: 2592001 }),
        EnqueueInvalidTimeoutError
      )
    })

    test('11. timeout: 2592000 accepts', async () => {
      const mockHttp = /** @type {any} */ ({
        request: async () => ({ status: 200, body: {} })
      })
      const enqueue = createEnqueueMethod({ http: mockHttp })
      const res = await enqueue({ q: 1 }, { timeout: 2592000 })
      assert.ok(typeof res === 'string')
    })

    test('12. onTimeout: "canned" without cannedResponse rejects with EnqueueMissingCannedResponseError', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      await assert.rejects(
        () => enqueue({ q: 1 }, { onTimeout: 'canned' }),
        EnqueueMissingCannedResponseError
      )
    })

    test('13. cannedResponse over 16 KB rejects with EnqueuePayloadTooLargeError', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      await assert.rejects(
        () => enqueue({ q: 1 }, { onTimeout: 'canned', cannedResponse: 'x'.repeat(16385) }),
        EnqueuePayloadTooLargeError
      )
    })

    test('14. Invalid audience rejects', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      await assert.rejects(
        () => enqueue({ q: 1 }, { audience: /** @type {any} */ ('internal') }),
        EnqueueInvalidRoutingError
      )
    })

    test('15. Invalid onTimeout rejects', async () => {
      const enqueue = createEnqueueMethod({ http: dummyHttp })
      await assert.rejects(
        () => enqueue({ q: 1 }, { onTimeout: /** @type {any} */ ('abort') }),
        TypeError
      )
    })
  })

  describe('Happy path', () => {
    test('16. Minimal call succeeds', async () => {
      let recordedPath = ''
      let recordedMethod = ''
      const mockHttp = /** @type {any} */ ({
        request: async (method, path) => {
          recordedMethod = method
          recordedPath = path
          return { status: 200, body: {} }
        }
      })
      const enqueue = createEnqueueMethod({ http: mockHttp })
      const handle = await enqueue({ question: 'x' })
      assert.strictEqual(recordedMethod, 'POST')
      assert.strictEqual(recordedPath, '/bots/me/operator-queue')
      assert.strictEqual(typeof handle, 'string')
      assert.strictEqual(handle.length, 36) // UUID format length
    })

    test('17. Request body has the expected shape', async () => {
      let recordedBody = null
      const mockHttp = /** @type {any} */ ({
        request: async (_method, _path, opts) => {
          recordedBody = opts.body
          return { status: 200, body: {} }
        }
      })
      const enqueue = createEnqueueMethod({ http: mockHttp, generateRequestId: () => 'req_test_123' })
      await enqueue({ question: 'hello' })
      assert.deepStrictEqual(recordedBody, {
        request_id: 'req_test_123',
        payload: { question: 'hello' },
        audience: 'private',
        room_id: null,
        timeout: null,
        on_timeout: 'ignore',
        canned_response: null
      })
    })

    test('18. The request is POST /bots/me/operator-queue', async () => {
      let pathCalled = ''
      let methodCalled = ''
      const mockHttp = /** @type {any} */ ({
        request: async (method, path) => {
          methodCalled = method
          pathCalled = path
          return { status: 200, body: {} }
        }
      })
      const enqueue = createEnqueueMethod({ http: mockHttp })
      await enqueue({ a: 1 })
      assert.strictEqual(methodCalled, 'POST')
      assert.strictEqual(pathCalled, '/bots/me/operator-queue')
    })

    test('19. Caller-supplied requestId is used', async () => {
      let recordedBody = null
      const mockHttp = /** @type {any} */ ({
        request: async (_method, _path, opts) => {
          recordedBody = opts.body
          return { status: 200, body: {} }
        }
      })
      const enqueue = createEnqueueMethod({ http: mockHttp })
      const handle = await enqueue({ a: 1 }, { requestId: 'custom-id-999' })
      assert.strictEqual(handle, 'custom-id-999')
      assert.strictEqual(recordedBody.request_id, 'custom-id-999')
    })

    test('20. Caller-supplied audience is used', async () => {
      let recordedBody = null
      const mockHttp = /** @type {any} */ ({
        request: async (_method, _path, opts) => {
          recordedBody = opts.body
          return { status: 200, body: {} }
        }
      })
      const enqueue = createEnqueueMethod({ http: mockHttp })
      await enqueue({ a: 1 }, { audience: 'public' })
      assert.strictEqual(recordedBody.audience, 'public')
    })

    test('21. Caller-supplied roomId is used', async () => {
      let recordedBody = null
      const mockHttp = /** @type {any} */ ({
        request: async (_method, _path, opts) => {
          recordedBody = opts.body
          return { status: 200, body: {} }
        }
      })
      const enqueue = createEnqueueMethod({ http: mockHttp })
      await enqueue({ a: 1 }, { roomId: 'r_room_123' })
      assert.strictEqual(recordedBody.room_id, 'r_room_123')
    })

    test('22. Caller-supplied timeout is used', async () => {
      let recordedBody = null
      const mockHttp = /** @type {any} */ ({
        request: async (_method, _path, opts) => {
          recordedBody = opts.body
          return { status: 200, body: {} }
        }
      })
      const enqueue = createEnqueueMethod({ http: mockHttp })
      await enqueue({ a: 1 }, { timeout: 3600 })
      assert.strictEqual(recordedBody.timeout, 3600)
    })

    test("23. onTimeout: 'canned' includes canned_response", async () => {
      let recordedBody = null
      const mockHttp = /** @type {any} */ ({
        request: async (_method, _path, opts) => {
          recordedBody = opts.body
          return { status: 200, body: {} }
        }
      })
      const enqueue = createEnqueueMethod({ http: mockHttp })
      await enqueue({ a: 1 }, { onTimeout: 'canned', cannedResponse: 'Please stand by' })
      assert.strictEqual(recordedBody.on_timeout, 'canned')
      assert.strictEqual(recordedBody.canned_response, 'Please stand by')
    })
  })

  describe('Retry and Error Mapping', () => {
    test('24. Network failure retries', async () => {
      let attempts = 0
      const serverEnv = await createTestServer((_req, res) => {
        attempts++
        if (attempts < 3) {
          res.destroy()
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok' }))
        }
      })

      try {
        const http = createHttpClient({ serverUrl: serverEnv.url, botToken: 'test', backoffMs: [10, 20, 30], defaultTimeoutMs: 1000 })
        const enqueue = createEnqueueMethod({ http })
        const res = await enqueue({ text: 'test' })
        assert.ok(typeof res === 'string')
        assert.strictEqual(attempts, 3)
      } finally {
        await serverEnv.close()
      }
    })

    test('25. 5xx retries', async () => {
      let attempts = 0
      const serverEnv = await createTestServer((_req, res) => {
        attempts++
        if (attempts < 3) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal_error' }))
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok' }))
        }
      })

      try {
        const http = createHttpClient({ serverUrl: serverEnv.url, botToken: 'test', backoffMs: [10, 20, 30], defaultTimeoutMs: 1000 })
        const enqueue = createEnqueueMethod({ http })
        const res = await enqueue({ text: 'test' })
        assert.ok(typeof res === 'string')
        assert.strictEqual(attempts, 3)
      } finally {
        await serverEnv.close()
      }
    })

    test('26. 429 retries respecting Retry-After', async () => {
      let attempts = 0
      const serverEnv = await createTestServer((_req, res) => {
        attempts++
        if (attempts < 2) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' })
          res.end(JSON.stringify({ error: 'rate_limited' }))
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok' }))
        }
      })

      try {
        const http = createHttpClient({ serverUrl: serverEnv.url, botToken: 'test', backoffMs: [10, 20, 30], defaultTimeoutMs: 1000 })
        const enqueue = createEnqueueMethod({ http })
        const res = await enqueue({ text: 'test' })
        assert.ok(typeof res === 'string')
        assert.strictEqual(attempts, 2)
      } finally {
        await serverEnv.close()
      }
    })

    test('27. 400 does not retry', async () => {
      let attempts = 0
      const serverEnv = await createTestServer((_req, res) => {
        attempts++
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'bad_request' }))
      })

      try {
        const http = createHttpClient({ serverUrl: serverEnv.url, botToken: 'test', backoffMs: [10, 20, 30], defaultTimeoutMs: 1000 })
        const enqueue = createEnqueueMethod({ http })
        await assert.rejects(
          () => enqueue({ text: 'test' }),
          EnqueueNetworkFailureError
        )
        assert.strictEqual(attempts, 1)
      } finally {
        await serverEnv.close()
      }
    })

    test('28. 401 does not retry', async () => {
      let attempts = 0
      const serverEnv = await createTestServer((_req, res) => {
        attempts++
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
      })

      try {
        const http = createHttpClient({ serverUrl: serverEnv.url, botToken: 'test', backoffMs: [10, 20, 30], defaultTimeoutMs: 1000 })
        const enqueue = createEnqueueMethod({ http })
        await assert.rejects(
          () => enqueue({ text: 'test' }),
          EnqueueNetworkFailureError
        )
        assert.strictEqual(attempts, 1)
      } finally {
        await serverEnv.close()
      }
    })

    test('29. 409 with error: "request_id_reused" throws EnqueueRequestIdReusedError', async () => {
      const serverEnv = await createTestServer((_req, res) => {
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'request_id_reused' }))
      })

      try {
        const http = createHttpClient({ serverUrl: serverEnv.url, botToken: 'test', backoffMs: [10, 20, 30], defaultTimeoutMs: 1000 })
        const enqueue = createEnqueueMethod({ http })
        await assert.rejects(
          () => enqueue({ text: 'test' }),
          EnqueueRequestIdReusedError
        )
      } finally {
        await serverEnv.close()
      }
    })

    test('30. Network failure after retries throws EnqueueNetworkFailureError', async () => {
      const serverEnv = await createTestServer((_req) => {
        _req.destroy()
      })

      try {
        const http = createHttpClient({ serverUrl: serverEnv.url, botToken: 'test', backoffMs: [10, 20, 30], defaultTimeoutMs: 1000 })
        const enqueue = createEnqueueMethod({ http })
        await assert.rejects(
          () => enqueue({ text: 'test' }),
          EnqueueNetworkFailureError
        )
      } finally {
        await serverEnv.close()
      }
    })

    test('31. 429 after retries throws EnqueueBudgetExhaustedError', async () => {
      const serverEnv = await createTestServer((_req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' })
        res.end(JSON.stringify({ error: 'rate_limited' }))
      })

      try {
        const http = createHttpClient({ serverUrl: serverEnv.url, botToken: 'test', backoffMs: [10, 20, 30], defaultTimeoutMs: 1000 })
        const enqueue = createEnqueueMethod({ http })
        await assert.rejects(
          () => enqueue({ text: 'test' }),
          EnqueueBudgetExhaustedError
        )
      } finally {
        await serverEnv.close()
      }
    })

    test('32. 5xx after retries throws EnqueueNetworkFailureError', async () => {
      const serverEnv = await createTestServer((_req, res) => {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'service_unavailable' }))
      })

      try {
        const http = createHttpClient({ serverUrl: serverEnv.url, botToken: 'test' })
        const enqueue = createEnqueueMethod({ http })
        await assert.rejects(
          () => enqueue({ text: 'test' }),
          EnqueueNetworkFailureError
        )
      } finally {
        await serverEnv.close()
      }
    })
  })

  describe('Runtime Integration', () => {
    test('33. The method is on ctx in a handler', async () => {
      const testBot = defineBot({
        id: 'test.bot',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['read_commands'],
        handlers: {
          message: async () => {}
        },
        commands: {
          testcmd: {
            description: 'Test command',
            args: {},
            handler: async (ctx) => {
              const handle = await ctx.enqueue({ question: 'help' })
              return { type: 'local_message', content: `Enqueued: ${handle}` }
            }
          }
        }
      })

      const testRuntime = await createTestRuntime(testBot)
      testRuntime.simulateResponse('/bots/me/operator-queue', { status: 200, body: { status: 'ok' } }, 'POST')

      try {
        const res = await testRuntime.inject({
          type: 'command',
          payload: { commandName: 'testcmd' }
        })
        assert.ok(res.ok)
        const opCall = testRuntime.calls.find((c) => c.path === '/api/v1/bots/me/operator-queue')
        assert.ok(opCall)
        assert.deepStrictEqual(opCall.json.payload, { question: 'help' })
      } finally {
        await testRuntime.close()
      }
    })

    test('34. The method is stable across invocations', async () => {
      /** @type {any} */
      let capturedCtx1 = null
      /** @type {any} */
      let capturedCtx2 = null

      const testBot = defineBot({
        id: 'test.bot',
        hostApi: '1.0',
        label: 'Test Bot',
        capabilities: ['read_content'],
        handlers: {
          message: async (ctx, event) => {
            if (event.roomId === 'room_1') {
              capturedCtx1 = ctx
            } else {
              capturedCtx2 = ctx
            }
          }
        }
      })

      const testRuntime = await createTestRuntime(testBot)

      try {
        await testRuntime.inject({ type: 'message', payload: { roomId: 'room_1' } })
        await testRuntime.inject({ type: 'message', payload: { roomId: 'room_2' } })
        assert.ok(capturedCtx1)
        assert.ok(capturedCtx2)
        assert.strictEqual(capturedCtx1.enqueue, capturedCtx2.enqueue)
      } finally {
        await testRuntime.close()
      }
    })
  })
})
