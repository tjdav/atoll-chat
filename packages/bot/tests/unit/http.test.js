import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHttpClient } from '../../src/runtime/transport/http.js'
import { HttpRequestError } from '../../src/errors.js'

/**
 * @param {http.RequestListener} handler
 * @returns {Promise<{ server: http.Server, url: string }>}
 */
function startServer (handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

describe('createHttpClient unit tests', () => {
  it('1. Basic GET', async () => {
    const { server, url } = await startServer((req, res) => {
      assert.equal(req.method, 'GET')
      assert.equal(req.url, '/test')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'test-token', backoffMs: [1, 1, 1] })
      const res = await client.request('GET', '/test')
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { ok: true })
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('2. Basic POST with JSON body', async () => {
    const { server, url } = await startServer((req, res) => {
      assert.equal(req.method, 'POST')
      assert.equal(req.headers['content-type'], 'application/json')
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        const parsed = JSON.parse(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ echoed: parsed }))
      })
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'test-token', backoffMs: [1, 1, 1] })
      const res = await client.request('POST', '/echo', { body: { hello: 'world' } })
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { echoed: { hello: 'world' } })
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('3. Authorization header present', async () => {
    let seenAuth = ''
    const { server, url } = await startServer((req, res) => {
      seenAuth = req.headers['authorization'] ?? ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'secret-token-123', backoffMs: [1, 1, 1] })
      await client.request('GET', '/auth-check')
      assert.equal(seenAuth, 'Bearer secret-token-123')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('4. User-Agent present', async () => {
    let seenUserAgent = ''
    const { server, url } = await startServer((req, res) => {
      seenUserAgent = req.headers['user-agent'] ?? ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    try {
      const client = createHttpClient({
        serverUrl: url,
        botToken: 'token',
        userAgent: 'CustomBot/2.0',
        backoffMs: [1, 1, 1]
      })
      await client.request('GET', '/ua-check')
      assert.equal(seenUserAgent, 'CustomBot/2.0')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('5. Accept header present', async () => {
    let seenAccept = ''
    const { server, url } = await startServer((req, res) => {
      seenAccept = req.headers['accept'] ?? ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await client.request('GET', '/accept-check')
      assert.equal(seenAccept, 'application/json')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('6. Caller cannot override Authorization', async () => {
    let seenAuth = ''
    const { server, url } = await startServer((req, res) => {
      seenAuth = req.headers['authorization'] ?? ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'real-token', backoffMs: [1, 1, 1] })
      await client.request('GET', '/auth-override', {
        headers: { Authorization: 'Bearer fake-token', authorization: 'Bearer fake-token-2' }
      })
      assert.equal(seenAuth, 'Bearer real-token')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('7. Caller can set other headers', async () => {
    let seenCustom = ''
    const { server, url } = await startServer((req, res) => {
      const headerVal = req.headers['x-custom']
      seenCustom = Array.isArray(headerVal) ? headerVal.join(',') : (headerVal ?? '')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await client.request('GET', '/custom-header', { headers: { 'X-Custom': 'v123' } })
      assert.equal(seenCustom, 'v123')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('8. Query string preserved', async () => {
    let seenUrl = ''
    const { server, url } = await startServer((req, res) => {
      seenUrl = req.url ?? ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await client.request('GET', '/items?limit=10&cursor=x')
      assert.equal(seenUrl, '/items?limit=10&cursor=x')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('9. Path must begin with "/"', async () => {
    const client = createHttpClient({ serverUrl: 'http://127.0.0.1:8080', botToken: 'token' })
    await assert.rejects(
      async () => { await client.request('GET', 'items') },
      { message: 'path must begin with "/"' }
    )
  })

  it('10. Absolute URL rejected', async () => {
    const client = createHttpClient({ serverUrl: 'http://127.0.0.1:8080', botToken: 'token' })
    await assert.rejects(
      async () => { await client.request('GET', 'http://example.com/items') },
      { message: 'path must not be an absolute URL' }
    )
  })

  it('11. 204 No Content', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(204)
      res.end()
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      const res = await client.request('DELETE', '/item/1')
      assert.equal(res.status, 204)
      assert.equal(res.body, null)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('12. Non-JSON response', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('plain text response')
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      const res = await client.request('GET', '/plain')
      assert.equal(res.status, 200)
      assert.equal(res.body, 'plain text response')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('13. Invalid JSON response', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('not json')
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      const res = await client.request('GET', '/bad-json')
      assert.equal(res.status, 200)
      assert.equal(res.body, null)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('14. 400 error throws', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'validation_error', message: 'Invalid field' }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await assert.rejects(
        async () => { await client.request('POST', '/submit', { body: {} }) },
        /** @param {unknown} err */
        (err) => {
          assert.ok(err instanceof HttpRequestError)
          assert.equal(err.code, 'http_request_failed')
          assert.equal(err.status, 400)
          assert.equal(err.responseErrorCode, 'validation_error')
          assert.deepEqual(err.body, { error: 'validation_error', message: 'Invalid field' })
          return true
        }
      )
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('15. 404 error throws', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found', message: 'Room not found' }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await assert.rejects(
        async () => { await client.request('GET', '/rooms/missing') },
        /** @param {unknown} err */
        (err) => {
          assert.ok(err instanceof HttpRequestError)
          assert.equal(err.status, 404)
          assert.equal(err.responseErrorCode, 'not_found')
          return true
        }
      )
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('16. 400 does not retry', async () => {
    let requestCount = 0
    const { server, url } = await startServer((_req, res) => {
      requestCount++
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'validation_error' }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await assert.rejects(async () => { await client.request('GET', '/bad') })
      assert.equal(requestCount, 1)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('17. 500 throws by default', async () => {
    let requestCount = 0
    const { server, url } = await startServer((_req, res) => {
      requestCount++
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal_error' }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await assert.rejects(async () => { await client.request('POST', '/fail') })
      assert.equal(requestCount, 1)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('18. 500 retries with retry: true', async () => {
    let requestCount = 0
    const { server, url } = await startServer((_req, res) => {
      requestCount++
      if (requestCount < 3) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      const res = await client.request('POST', '/retry-500', { retry: true })
      assert.equal(requestCount, 3)
      assert.equal(res.status, 200)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('19. 500 retries exhaust', async () => {
    let requestCount = 0
    const { server, url } = await startServer((_req, res) => {
      requestCount++
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal_error' }))
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await assert.rejects(
        async () => { await client.request('POST', '/exhaust-500', { retry: true }) },
        /** @param {unknown} err */
        (err) => {
          assert.ok(err instanceof HttpRequestError)
          assert.equal(err.status, 500)
          return true
        }
      )
      // Initial attempt + 3 backoffMs retries
      assert.equal(requestCount, 4)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('20. 429 retries without retry: true', async () => {
    let requestCount = 0
    const { server, url } = await startServer((_req, res) => {
      requestCount++
      if (requestCount < 3) {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'rate_limited' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      const res = await client.request('GET', '/rate-limited')
      assert.equal(requestCount, 3)
      assert.equal(res.status, 200)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('21. 429 respects Retry-After', async () => {
    let requestCount = 0
    const { server, url } = await startServer((_req, res) => {
      requestCount++
      if (requestCount === 1) {
        res.writeHead(429, { 'Retry-After': '0', 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'rate_limited' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1000, 1000] })
      const start = Date.now()
      const res = await client.request('GET', '/retry-after')
      const elapsed = Date.now() - start
      assert.equal(requestCount, 2)
      assert.equal(res.status, 200)
      assert.ok(elapsed < 500)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('22. 429 clamps Retry-After', async () => {
    let requestCount = 0
    const { server, url } = await startServer((_req, res) => {
      requestCount++
      if (requestCount === 1) {
        res.writeHead(429, { 'Retry-After': '3600', 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'rate_limited' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }
    })
    try {
      const client = createHttpClient({
        serverUrl: url,
        botToken: 'token',
        backoffMs: [1000],
        maxRetryAfterMs: 2
      })
      const start = Date.now()
      const res = await client.request('GET', '/clamp-retry-after')
      const elapsed = Date.now() - start
      assert.equal(requestCount, 2)
      assert.equal(res.status, 200)
      assert.ok(elapsed < 500)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('23. Network error retries with retry: true', async () => {
    let attemptCount = 0
    const { server, url } = await startServer((req, _res) => {
      attemptCount++
      req.socket.destroy()
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await assert.rejects(
        async () => { await client.request('GET', '/network-err', { retry: true }) },
        /** @param {unknown} err */
        (err) => {
          assert.ok(err instanceof HttpRequestError)
          assert.equal(err.status, 0)
          return true
        }
      )
      assert.equal(attemptCount, 4)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('24. Timeout', async () => {
    const { server, url } = await startServer((_req, _res) => {
      // Do not respond
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await assert.rejects(
        async () => { await client.request('GET', '/timeout-test', { timeoutMs: 10, retry: false }) },
        /** @param {unknown} err */
        (err) => {
          assert.ok(err instanceof HttpRequestError)
          assert.equal(err.status, 0)
          assert.ok(err.cause instanceof Error)
          return true
        }
      )
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('25. Network error does not retry by default', async () => {
    let attemptCount = 0
    const { server, url } = await startServer((req, _res) => {
      attemptCount++
      req.socket.destroy()
    })
    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await assert.rejects(
        async () => { await client.request('GET', '/no-retry-net') },
        /** @param {unknown} err */
        (err) => {
          assert.ok(err instanceof HttpRequestError)
          assert.equal(err.status, 0)
          return true
        }
      )
      assert.equal(attemptCount, 1)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('26. Logger emits retry lines', async () => {
    /** @type {Array<{ msg: string, meta: Record<string, unknown> }>} */
    const logs = []
    /** @type {any} */
    const dummyLogger = {
      debug (/** @type {string} */ msg, /** @type {Record<string, unknown>} */ meta) { logs.push({ msg, meta }) },
      info () {},
      warn () {},
      error () {}
    }

    let requestCount = 0
    const { server, url } = await startServer((_req, res) => {
      requestCount++
      if (requestCount === 1) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'unavailable' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }
    })

    try {
      const client = createHttpClient({
        serverUrl: url,
        botToken: 'token',
        backoffMs: [1, 1, 1],
        logger: dummyLogger
      })
      await client.request('POST', '/rooms/r_abc/bot-messages', { retry: true })
      assert.equal(logs.length, 1)
      assert.deepEqual(logs[0], {
        msg: 'http retry',
        meta: {
          method: 'POST',
          path: '/rooms/r_abc/bot-messages',
          status: 503,
          attempt: 1
        }
      })
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('27. Logger strips query string', async () => {
    /** @type {Array<{ msg: string, meta: Record<string, unknown> }>} */
    const logs = []
    /** @type {any} */
    const dummyLogger = {
      debug (/** @type {string} */ msg, /** @type {Record<string, unknown>} */ meta) { logs.push({ msg, meta }) },
      info () {},
      warn () {},
      error () {}
    }

    let requestCount = 0
    const { server, url } = await startServer((_req, res) => {
      requestCount++
      if (requestCount === 1) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'server_error' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }
    })

    try {
      const client = createHttpClient({
        serverUrl: url,
        botToken: 'token',
        backoffMs: [1, 1, 1],
        logger: dummyLogger
      })
      await client.request('GET', '/items?token=secret123&limit=50', { retry: true })
      assert.equal(logs.length, 1)
      assert.equal(logs[0]?.meta?.path, '/items')
    } finally {
      await new Promise((r) => server.close(r))
    }
  })

  it('28. Factory rejects bad serverUrl', () => {
    assert.throws(
      () => createHttpClient({ serverUrl: '', botToken: 'token' }),
      { message: 'serverUrl must be a non-empty string' }
    )
    assert.throws(
      () => createHttpClient({ serverUrl: 'not a url', botToken: 'token' }),
      { message: 'serverUrl must be a valid absolute URL' }
    )
    assert.throws(
      () => createHttpClient({ serverUrl: 'ftp://example.com', botToken: 'token' }),
      { message: 'serverUrl scheme must be http: or https:' }
    )
  })

  it('29. Factory rejects missing botToken', () => {
    assert.throws(
      () => createHttpClient({ serverUrl: 'http://localhost:8080', botToken: '' }),
      { message: 'botToken must be a non-empty string' }
    )
    assert.throws(
      () => createHttpClient({ serverUrl: 'http://localhost:8080', botToken: '   ' }),
      { message: 'botToken must be a non-empty string' }
    )
  })

  it('30. Retries send the same body', async () => {
    /** @type {string[]} */
    const bodies = []
    let requestCount = 0
    const { server, url } = await startServer((req, res) => {
      requestCount++
      let b = ''
      req.on('data', (c) => { b += c })
      req.on('end', () => {
        bodies.push(b)
        if (requestCount < 3) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'fail' }))
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        }
      })
    })

    try {
      const client = createHttpClient({ serverUrl: url, botToken: 'token', backoffMs: [1, 1, 1] })
      await client.request('POST', '/same-body', { body: { data: 123 }, retry: true })
      assert.equal(bodies.length, 3)
      assert.equal(bodies[0], bodies[1])
      assert.equal(bodies[1], bodies[2])
      assert.equal(bodies[0], JSON.stringify({ data: 123 }))
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})
