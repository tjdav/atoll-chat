import { createServer } from 'node:http'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createFetchMethods, stripQuery } from '../../src/runtime/context/fetch.js'

/**
 * @param {import('node:http').RequestListener} handler
 * @returns {Promise<{ server: import('node:http').Server, url: string }>}
 */
function startServer (handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

/**
 * @typedef {object} SpyLogger
 * @property {{ level: string, msg: string, meta: any }[]} lines
 * @property {(level: any, msg: string, meta?: any) => void} log
 * @property {(msg: string, meta?: any) => void} debug
 * @property {(msg: string, meta?: any) => void} info
 * @property {(msg: string, meta?: any) => void} warn
 * @property {(msg: string, meta?: any) => void} error
 * @property {() => 'debug'} level
 */

/**
 * @returns {import('../../src/runtime/diagnostics/logger.js').Logger & SpyLogger}
 */
function makeSpyLogger () {
  /** @type {{ level: string, msg: string, meta: any }[]} */
  const lines = []
  return {
    lines,
    log (level, msg, meta) { lines.push({ level: String(level), msg, meta }) },
    debug (msg, meta) { lines.push({ level: 'debug', msg, meta }) },
    info (msg, meta) { lines.push({ level: 'info', msg, meta }) },
    warn (msg, meta) { lines.push({ level: 'warn', msg, meta }) },
    error (msg, meta) { lines.push({ level: 'error', msg, meta }) },
    level () { return 'debug' }
  }
}

describe('ctx.fetch and ctx.fetchUserUrl unit tests', () => {
  // Basic behavior
  test('1. GET returns the response', async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods()
      const response = await fetch(url)
      assert.equal(response.status, 200)
      assert.equal(response.ok, true)
      const text = await response.text()
      assert.equal(text, 'ok')
    } finally {
      server.close()
    }
  })

  test('2. POST with body', async () => {
    let receivedBody = ''
    const { server, url } = await startServer((req, res) => {
      req.on('data', (chunk) => { receivedBody += chunk })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(receivedBody)
      })
    })

    try {
      const { fetch } = createFetchMethods()
      const response = await fetch(url, { method: 'POST', body: 'hello server' })
      assert.equal(response.status, 200)
      const text = await response.text()
      assert.equal(text, 'hello server')
      assert.equal(receivedBody, 'hello server')
    } finally {
      server.close()
    }
  })

  test('3. Non-2xx does not throw', async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    })

    try {
      const { fetch } = createFetchMethods()
      const response = await fetch(`${url}/missing`)
      assert.equal(response.status, 404)
      assert.equal(response.ok, false)
    } finally {
      server.close()
    }
  })

  test('4. Network failure propagates', async () => {
    // Port 1 on 127.0.0.1 is closed / inaccessible
    const { fetch } = createFetchMethods()
    await assert.rejects(
      async () => {
        await fetch('http://127.0.0.1:1')
      },
      (err) => err !== null && err !== undefined
    )
  })

  test('5. Body can be read by the caller', async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ greeting: 'hello' }))
    })

    try {
      const { fetch } = createFetchMethods()
      const response = await fetch(url)
      assert.equal(response.status, 200)
      const data = await response.json()
      assert.deepEqual(data, { greeting: 'hello' })
    } finally {
      server.close()
    }
  })

  // URL validation
  test('6. Non-string url throws TypeError', async () => {
    const { fetch } = createFetchMethods()
    await assert.rejects(
      async () => {
        // @ts-expect-error Testing non-string input
        await fetch(12345)
      },
      { name: 'TypeError', message: 'fetch: url must be a non-empty string' }
    )
  })

  test('7. Empty url throws TypeError', async () => {
    const { fetch } = createFetchMethods()
    await assert.rejects(
      async () => {
        await fetch('')
      },
      { name: 'TypeError', message: 'fetch: url must be a non-empty string' }
    )
  })

  test('8. Malformed url throws TypeError', async () => {
    const { fetch } = createFetchMethods()
    await assert.rejects(
      async () => {
        await fetch('not-a-valid-url')
      },
      (err) => err instanceof TypeError && err.message.includes('fetch: url is not a valid URL:')
    )
  })

  test('9. file:// scheme throws TypeError', async () => {
    const { fetch } = createFetchMethods()
    await assert.rejects(
      async () => {
        await fetch('file:///etc/passwd')
      },
      { name: 'TypeError', message: "fetch: unsupported scheme 'file:'" }
    )
  })

  test('10. data: scheme throws TypeError', async () => {
    const { fetch } = createFetchMethods()
    await assert.rejects(
      async () => {
        await fetch('data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==')
      },
      { name: 'TypeError', message: "fetch: unsupported scheme 'data:'" }
    )
  })

  test('11. ws:// scheme throws TypeError', async () => {
    const { fetch } = createFetchMethods()
    await assert.rejects(
      async () => {
        await fetch('ws://127.0.0.1:8080/socket')
      },
      { name: 'TypeError', message: "fetch: unsupported scheme 'ws:'" }
    )
  })

  test('12. http:// scheme accepted', async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods()
      const response = await fetch(url)
      assert.equal(response.status, 200)
    } finally {
      server.close()
    }
  })

  test('13. https:// scheme accepted', async () => {
    /** @type {string|null} */
    let attemptedUrl = null
    /** @type {typeof globalThis.fetch} */
    const mockFetch = async (input) => {
      attemptedUrl = String(input)
      return new Response('ok', { status: 200 })
    }

    const { fetch } = createFetchMethods({ fetchImpl: mockFetch })
    const response = await fetch('https://example.com/api/v1')
    assert.equal(response.status, 200)
    assert.equal(attemptedUrl, 'https://example.com/api/v1')
  })

  // Logging
  test('14. Logger emits debug on entry', async () => {
    const logger = makeSpyLogger()
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods({ logger })
      await fetch(url)
      const entryLog = logger.lines.find((line) => line.msg === 'fetch')
      assert.ok(entryLog)
      assert.equal(entryLog.level, 'debug')
      assert.equal(entryLog.meta.method, 'GET')
    } finally {
      server.close()
    }
  })

  test('15. Logger emits debug on success', async () => {
    const logger = makeSpyLogger()
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods({ logger })
      await fetch(url)
      const successLog = logger.lines.find((line) => line.msg === 'fetch completed')
      assert.ok(successLog)
      assert.equal(successLog.level, 'debug')
      assert.equal(successLog.meta.status, 200)
    } finally {
      server.close()
    }
  })

  test('16. Logger emits warn on failure', async () => {
    const logger = makeSpyLogger()
    const { fetch } = createFetchMethods({ logger })
    try {
      await fetch('http://127.0.0.1:1')
    } catch {
      // Expected network failure
    }
    const failLog = logger.lines.find((line) => line.msg === 'fetch failed')
    assert.ok(failLog)
    assert.equal(failLog.level, 'warn')
    assert.ok(typeof failLog.meta.error === 'string')
  })

  test('17. Query string stripped from entry log', async () => {
    const logger = makeSpyLogger()
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods({ logger })
      await fetch(`${url}/path?token=secret123`)
      const entryLog = logger.lines.find((line) => line.msg === 'fetch')
      assert.ok(entryLog)
      assert.ok(!entryLog.meta.url.includes('token'))
      assert.ok(!entryLog.meta.url.includes('secret123'))
    } finally {
      server.close()
    }
  })

  test('18. Fragment stripped from entry log', async () => {
    const logger = makeSpyLogger()
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods({ logger })
      await fetch(`${url}/path#access_token=abc`)
      const entryLog = logger.lines.find((line) => line.msg === 'fetch')
      assert.ok(entryLog)
      assert.ok(!entryLog.meta.url.includes('access_token'))
      assert.ok(!entryLog.meta.url.includes('abc'))
    } finally {
      server.close()
    }
  })

  test('19. Query string stripped from success log', async () => {
    const logger = makeSpyLogger()
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods({ logger })
      await fetch(`${url}/path?token=secret123#frag=xyz`)
      const successLog = logger.lines.find((line) => line.msg === 'fetch completed')
      assert.ok(successLog)
      assert.ok(!successLog.meta.url.includes('token'))
      assert.ok(!successLog.meta.url.includes('secret123'))
      assert.ok(!successLog.meta.url.includes('frag'))
    } finally {
      server.close()
    }
  })

  test('20. Query string stripped from failure log', async () => {
    const logger = makeSpyLogger()
    const { fetch } = createFetchMethods({ logger })
    try {
      await fetch('http://127.0.0.1:1/path?token=secret123#frag=xyz')
    } catch {
      // Expected network failure
    }
    const failLog = logger.lines.find((line) => line.msg === 'fetch failed')
    assert.ok(failLog)
    assert.ok(!failLog.meta.url.includes('token'))
    assert.ok(!failLog.meta.url.includes('secret123'))
    assert.ok(!failLog.meta.url.includes('frag'))
  })

  test('21. Headers not logged', async () => {
    const logger = makeSpyLogger()
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods({ logger })
      await fetch(url, {
        headers: {
          Authorization: 'Bearer abc',
          Cookie: 'x=1'
        }
      })
      const serialized = JSON.stringify(logger.lines)
      assert.ok(!serialized.includes('Bearer'))
      assert.ok(!serialized.includes('abc'))
      assert.ok(!serialized.includes('x=1'))
    } finally {
      server.close()
    }
  })

  test('22. Body not logged', async () => {
    const logger = makeSpyLogger()
    const sentinel = 'SENTINEL_REQUEST_BODY_12345'
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods({ logger })
      await fetch(url, {
        method: 'POST',
        body: sentinel
      })
      const serialized = JSON.stringify(logger.lines)
      assert.ok(!serialized.includes(sentinel))
    } finally {
      server.close()
    }
  })

  test('23. Response body not logged', async () => {
    const logger = makeSpyLogger()
    const sentinel = 'SENTINEL_RESPONSE_BODY_67890'
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end(sentinel)
    })

    try {
      const { fetch } = createFetchMethods({ logger })
      const res = await fetch(url)
      await res.text()
      const serialized = JSON.stringify(logger.lines)
      assert.ok(!serialized.includes(sentinel))
    } finally {
      server.close()
    }
  })

  test('24. has_body flag reflects the request', async () => {
    const logger = makeSpyLogger()
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods({ logger })
      await fetch(url)
      const getEntry = logger.lines.find((line) => line.msg === 'fetch')
      assert.ok(getEntry)
      assert.equal(getEntry.meta.has_body, false)

      logger.lines.length = 0
      await fetch(url, { method: 'POST', body: 'data' })
      const postEntry = logger.lines.find((line) => line.msg === 'fetch')
      assert.ok(postEntry)
      assert.equal(postEntry.meta.has_body, true)
    } finally {
      server.close()
    }
  })

  test('25. duration_ms present and non-negative on success and failure', async () => {
    const logger = makeSpyLogger()
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetch } = createFetchMethods({ logger })
      await fetch(url)
      const successLog = logger.lines.find((line) => line.msg === 'fetch completed')
      assert.ok(successLog)
      assert.ok(typeof successLog.meta.duration_ms === 'number')
      assert.ok(successLog.meta.duration_ms >= 0)

      logger.lines.length = 0
      try {
        await fetch('http://127.0.0.1:1')
      } catch {
        // Expected network failure
      }
      const failLog = logger.lines.find((line) => line.msg === 'fetch failed')
      assert.ok(failLog)
      assert.ok(typeof failLog.meta.duration_ms === 'number')
      assert.ok(failLog.meta.duration_ms >= 0)
    } finally {
      server.close()
    }
  })

  // fetchUserUrl distinction
  test('26. fetch !== fetchUserUrl', () => {
    const { fetch, fetchUserUrl } = createFetchMethods()
    assert.notEqual(fetch, fetchUserUrl)
    assert.equal(typeof fetch, 'function')
    assert.equal(typeof fetchUserUrl, 'function')
  })

  test('27. fetchUserUrl sends the same request', async () => {
    /** @type {string|null} */
    let reqMethod = null
    /** @type {import('node:http').IncomingHttpHeaders|null} */
    let reqHeaders = null
    const { server, url } = await startServer((req, res) => {
      reqMethod = req.method ?? null
      reqHeaders = req.headers
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetchUserUrl } = createFetchMethods()
      const response = await fetchUserUrl(url, { method: 'GET' })
      assert.equal(response.status, 200)
      assert.equal(reqMethod, 'GET')
      assert.ok(reqHeaders)
    } finally {
      server.close()
    }
  })

  test('28. fetchUserUrl log includes on_behalf_of: "user"', async () => {
    const logger = makeSpyLogger()
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const { fetchUserUrl } = createFetchMethods({ logger })
      await fetchUserUrl(url)
      const entryLog = logger.lines.find((line) => line.msg === 'fetch')
      const successLog = logger.lines.find((line) => line.msg === 'fetch completed')
      assert.ok(entryLog)
      assert.equal(entryLog.meta.on_behalf_of, 'user')
      assert.ok(successLog)
      assert.equal(successLog.meta.on_behalf_of, 'user')
    } finally {
      server.close()
    }
  })

  // stripQuery helper
  test('29. Valid URL with query and fragment', () => {
    assert.equal(stripQuery('https://x.com/a?b=1#c'), 'https://x.com/a')
  })

  test('30. No query string', () => {
    assert.equal(stripQuery('https://x.com/a'), 'https://x.com/a')
  })

  test('31. Malformed URL with query', () => {
    assert.equal(stripQuery('example.com/a?b=1'), 'example.com/a')
  })

  test('32. Malformed URL with fragment', () => {
    assert.equal(stripQuery('example.com/a#c'), 'example.com/a')
  })

  test('33. Empty string', () => {
    assert.equal(stripQuery(''), '')
  })

  test('34. Query-only string', () => {
    assert.equal(stripQuery('?a=1'), '')
  })
})
