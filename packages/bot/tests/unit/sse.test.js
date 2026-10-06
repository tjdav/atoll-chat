import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createSseClient } from '../../src/runtime/transport/sse.js'
import { HttpRequestError } from '../../src/errors.js'

/**
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} handler
 * @returns {Promise<{ server: http.Server, url: string }>}
 */
function sseServer (handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.writeHead(200)
      handler(req, res)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

/**
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} handler
 * @returns {Promise<{ server: http.Server, url: string }>}
 */
function customServer (handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handler(req, res)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

describe('createSseClient unit tests', () => {
  test('1. Single event', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('event: message.new\ndata: {"id":"m1"}\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/rooms/r1/observer-stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.deepEqual(events[0], {
        event: 'message.new',
        data: '{"id":"m1"}',
        id: null
      })
    } finally {
      server.close()
    }
  })

  test('2. Bare data: defaults to message event type', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('data: hello world\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/rooms/r1/observer-stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.equal(events[0].event, 'message')
      assert.equal(events[0].data, 'hello world')
    } finally {
      server.close()
    }
  })

  test('3. Multiple events', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('event: e1\ndata: d1\n\nevent: e2\ndata: d2\n\nevent: e3\ndata: d3\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 3)
      assert.equal(events[0].data, 'd1')
      assert.equal(events[1].data, 'd2')
      assert.equal(events[2].data, 'd3')
    } finally {
      server.close()
    }
  })

  test('4. Multi-line data', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('data: a\ndata: b\ndata: c\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.equal(events[0].data, 'a\nb\nc')
    } finally {
      server.close()
    }
  })

  test('5. Comment line ignored', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write(':comment\ndata: x\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.equal(events[0].data, 'x')
    } finally {
      server.close()
    }
  })

  test('6. Line with no colon', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('data\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.equal(events[0].data, '')
    } finally {
      server.close()
    }
  })

  test('7. id: line sets the last event ID', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('id: 42\ndata: x\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.equal(events[0].id, '42')
      assert.equal(client.getLastEventId(), '42')
    } finally {
      server.close()
    }
  })

  test('8. id: persists across events', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('id: 42\ndata: x\n\ndata: y\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 2)
      assert.equal(events[0].id, '42')
      assert.equal(events[1].id, '42')
    } finally {
      server.close()
    }
  })

  test('9. retry: value stored', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('retry: 3000\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 0)
      assert.equal(client.getRetryMs(), 3000)
    } finally {
      server.close()
    }
  })

  test('10. Retry persists across events', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('retry: 3000\ndata: e1\n\ndata: e2\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 2)
      assert.equal(client.getRetryMs(), 3000)
    } finally {
      server.close()
    }
  })

  test('11. CRLF line endings', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('data: x\r\n\r\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.equal(events[0].data, 'x')
    } finally {
      server.close()
    }
  })

  test('12. Standalone CR line endings', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('data: x\r\r')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.equal(events[0].data, 'x')
    } finally {
      server.close()
    }
  })

  test('13. Mixed line endings', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('event: e1\rdata: d1\r\n\rdata: d2\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 2)
      assert.equal(events[0].data, 'd1')
      assert.equal(events[1].data, 'd2')
    } finally {
      server.close()
    }
  })

  test('14. Chunk boundary splits a line', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write('data: he')
      setTimeout(() => {
        res.write('llo\n\n')
        res.end()
      }, 30)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.equal(events[0].data, 'hello')
    } finally {
      server.close()
    }
  })

  test('15. Chunk boundary splits a multi-byte UTF-8 character', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      // "data: " + € (0xE2, 0x82, 0xAC) + "\n\n"
      const prefix = Buffer.from('data: ')
      const euro = Buffer.from('€') // 3 bytes: 0xE2, 0x82, 0xAC
      const suffix = Buffer.from('\n\n')

      // Chunk 1: "data: " + first 2 bytes of euro
      const chunk1 = Buffer.concat([prefix, euro.subarray(0, 2)])
      // Chunk 2: 3rd byte of euro + "\n\n"
      const chunk2 = Buffer.concat([euro.subarray(2), suffix])

      res.write(chunk1)
      setTimeout(() => {
        res.write(chunk2)
        res.end()
      }, 30)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.equal(events[0].data, '€')
    } finally {
      server.close()
    }
  })

  test('16. Chunk boundary splits the CRLF pair', async () => {
    /** @type {any[]} */
    const events = []
    const { server, url } = await sseServer((req, res) => {
      res.write(Buffer.from('data: x\r'))
      setTimeout(() => {
        res.write(Buffer.from('\n\r\n'))
        res.end()
      }, 30)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.equal(events[0].data, 'x')
    } finally {
      server.close()
    }
  })

  test('17. connect() resolves on valid response', async () => {
    const { server, url } = await sseServer((req, res) => {
      res.write('data: hello\n\n')
      setTimeout(() => res.end(), 100)
    })

    try {
      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: () => {}
      })

      await client.connect()
      assert.equal(client.isConnected(), true)
      await client.close()
    } finally {
      server.close()
    }
  })

  test('18. Non-200 status rejects connect()', async () => {
    const { server, url } = await customServer((req, res) => {
      res.writeHead(403)
      res.end('Forbidden')
    })

    try {
      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: () => {}
      })

      await assert.rejects(
        async () => {
          await client.connect()
        },
        (err) => {
          assert.ok(err instanceof HttpRequestError)
          assert.equal(err.status, 403)
          assert.equal(err.body, 'Forbidden')
          return true
        }
      )
    } finally {
      server.close()
    }
  })

  test('19. Wrong Content-Type rejects connect()', async () => {
    const { server, url } = await customServer((req, res) => {
      res.setHeader('Content-Type', 'text/plain')
      res.writeHead(200)
      res.end('ok')
    })

    try {
      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: () => {}
      })

      await assert.rejects(
        async () => {
          await client.connect()
        },
        (err) => {
          assert.ok(err instanceof HttpRequestError)
          assert.equal(err.status, 200)
          assert.match(err.message, /invalid content-type text\/plain/)
          return true
        }
      )
    } finally {
      server.close()
    }
  })

  test('20. Connect timeout rejects', async () => {
    const { server, url } = await customServer((_req, _res) => {
      // Do not respond
    })

    try {
      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        connectTimeoutMs: 50,
        onEvent: () => {}
      })

      await assert.rejects(
        async () => {
          await client.connect()
        },
        (err) => {
          assert.ok(err instanceof HttpRequestError)
          assert.equal(err.status, 0)
          assert.match(err.message, /connect timeout after 50ms/)
          return true
        }
      )
    } finally {
      server.close()
    }
  })

  test('21. Network failure rejects connect()', async () => {
    const client = createSseClient({
      serverUrl: 'http://127.0.0.1:59999', // closed port
      botToken: 'token123',
      path: '/stream',
      onEvent: () => {}
    })

    await assert.rejects(
      async () => {
        await client.connect()
      },
      (err) => {
        assert.ok(err instanceof HttpRequestError)
        assert.equal(err.status, 0)
        return true
      }
    )
  })

  test('22. close() aborts the stream', async () => {
    /** @type {any} */
    let closedReason = null
    const { server, url } = await sseServer((req, res) => {
      res.write('data: ping\n\n')
    })

    try {
      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: () => {},
        onClose: (reason) => {
          closedReason = reason
        }
      })

      await client.connect()
      assert.equal(client.isConnected(), true)

      await client.close()
      assert.equal(client.isConnected(), false)
      assert.deepEqual(closedReason, { code: 0 })
    } finally {
      server.close()
    }
  })

  test('23. close() before connect() resolves immediately', async () => {
    const client = createSseClient({
      serverUrl: 'http://127.0.0.1:8080',
      botToken: 'token123',
      path: '/stream',
      onEvent: () => {}
    })

    await client.close()
    assert.equal(client.isConnected(), false)
  })

  test('24. close() on already-closed client is idempotent', async () => {
    const { server, url } = await sseServer((req, res) => {
      res.write('data: ping\n\n')
      res.end()
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: () => {},
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      await client.close()
      await client.close()
    } finally {
      server.close()
    }
  })

  test('25. Server closes the stream', async () => {
    /** @type {any[]} */
    const events = []
    /** @type {any} */
    let closedReason = null

    const { server, url } = await sseServer((req, res) => {
      res.write('data: hello\n\n')
      setTimeout(() => res.end(), 30)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: (evt) => events.push(evt),
        onClose: (reason) => {
          closedReason = reason
          resolveClosed()
        }
      })

      await client.connect()
      await closedPromise

      assert.equal(events.length, 1)
      assert.deepEqual(closedReason, { code: 0 })
      assert.equal(client.isConnected(), false)
    } finally {
      server.close()
    }
  })

  test('26. Mid-stream network failure emits onError', async () => {
    /** @type {any[]} */
    const errors = []
    /** @type {any} */
    let closedReason = null

    const { server, url } = await sseServer((req, res) => {
      res.write('data: hello\n\n')
      setTimeout(() => {
        req.destroy()
      }, 30)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: () => {},
        onError: (err) => errors.push(err),
        onClose: (reason) => {
          closedReason = reason
          resolveClosed()
        }
      })

      await client.connect()
      await closedPromise

      assert.equal(errors.length, 1)
      assert.ok(errors[0] instanceof Error)
      assert.ok(closedReason)
      assert.equal(closedReason.code, 0)
      assert.ok(closedReason.cause)
    } finally {
      server.close()
    }
  })

  test('27. isConnected() transitions correctly', async () => {
    const { server, url } = await sseServer((req, res) => {
      res.write('data: ping\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: () => {},
        onClose: () => resolveClosed()
      })

      assert.equal(client.isConnected(), false)
      await client.connect()
      assert.equal(client.isConnected(), true)
      await closedPromise
      assert.equal(client.isConnected(), false)
    } finally {
      server.close()
    }
  })

  test('28. getLastEventId() returns null before any event, the last id after', async () => {
    const { server, url } = await sseServer((req, res) => {
      res.write('id: evt-1\ndata: x\n\n')
      setTimeout(() => res.end(), 50)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: () => {},
        onClose: () => resolveClosed()
      })

      assert.equal(client.getLastEventId(), null)
      await client.connect()
      await closedPromise
      assert.equal(client.getLastEventId(), 'evt-1')
    } finally {
      server.close()
    }
  })

  test('29. Last-Event-ID header sent on reconnect', async () => {
    /** @type {Record<string, string>[]} */
    const receivedHeaders = []

    const { server, url } = await sseServer((req, res) => {
      receivedHeaders.push(/** @type {Record<string, string>} */ (req.headers))
      if (receivedHeaders.length === 1) {
        res.write('id: 100\ndata: evt1\n\n')
        setTimeout(() => res.end(), 30)
      } else {
        res.write('data: evt2\n\n')
        setTimeout(() => res.end(), 30)
      }
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      let closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        onEvent: () => {},
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      await client.connect()
      await closedPromise

      assert.equal(receivedHeaders.length, 2)
      assert.ok(receivedHeaders[0])
      assert.ok(receivedHeaders[1])
      assert.equal(receivedHeaders[0]['last-event-id'], undefined)
      assert.equal(receivedHeaders[1]['last-event-id'], '100')
    } finally {
      server.close()
    }
  })

  test('30. initialLastEventId sent on first connection', async () => {
    /** @type {Record<string, string>[]} */
    const receivedHeaders = []

    const { server, url } = await sseServer((req, res) => {
      receivedHeaders.push(/** @type {Record<string, string>} */ (req.headers))
      res.write('data: evt\n\n')
      setTimeout(() => res.end(), 30)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        initialLastEventId: '99',
        onEvent: () => {},
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      assert.equal(receivedHeaders.length, 1)
      assert.ok(receivedHeaders[0])
      assert.equal(receivedHeaders[0]['last-event-id'], '99')
    } finally {
      server.close()
    }
  })

  test('31. Logger receives debug lines', async () => {
    /** @type {any[]} */
    const logLines = []
    /** @type {import('../../src/runtime/diagnostics/logger.js').Logger} */
    // @ts-ignore
    const dummyLogger = {
      debug: (msg, meta) => logLines.push({ level: 'debug', msg, meta }),
      info: (msg, meta) => logLines.push({ level: 'info', msg, meta }),
      warn: (msg, meta) => logLines.push({ level: 'warn', msg, meta }),
      error: (msg, meta) => logLines.push({ level: 'error', msg, meta })
    }

    const { server, url } = await sseServer((req, res) => {
      res.write('id: e1\ndata: secret_payload\n\n')
      setTimeout(() => res.end(), 30)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream?query=1',
        logger: dummyLogger,
        onEvent: () => {},
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      const msgs = logLines.map((l) => l.msg)
      assert.ok(msgs.includes('sse connect'))
      assert.ok(msgs.includes('sse connected'))
      assert.ok(msgs.includes('sse event'))
      assert.ok(msgs.includes('sse closed'))

      for (const line of logLines) {
        assert.equal(line.meta.path, '/stream')
      }
    } finally {
      server.close()
    }
  })

  test('32. Logger does not log event data', async () => {
    /** @type {any[]} */
    const logLines = []
    /** @type {import('../../src/runtime/diagnostics/logger.js').Logger} */
    // @ts-ignore
    const dummyLogger = {
      debug: (msg, meta) => logLines.push({ level: 'debug', msg, meta }),
      info: (msg, meta) => logLines.push({ level: 'info', msg, meta }),
      warn: (msg, meta) => logLines.push({ level: 'warn', msg, meta }),
      error: (msg, meta) => logLines.push({ level: 'error', msg, meta })
    }

    const secretPayload = 'super_secret_user_message_content'
    const { server, url } = await sseServer((req, res) => {
      res.write(`data: ${secretPayload}\n\n`)
      setTimeout(() => res.end(), 30)
    })

    try {
      /** @type {(value?: unknown) => void} */
      let resolveClosed = () => {}
      const closedPromise = new Promise((resolve) => {
        resolveClosed = resolve
      })

      const client = createSseClient({
        serverUrl: url,
        botToken: 'token123',
        path: '/stream',
        logger: dummyLogger,
        onEvent: () => {},
        onClose: () => resolveClosed()
      })

      await client.connect()
      await closedPromise

      const logStr = JSON.stringify(logLines)
      assert.equal(logStr.includes(secretPayload), false)
    } finally {
      server.close()
    }
  })

  test('33. Factory validates serverUrl and path', () => {
    assert.throws(
      () => createSseClient({ serverUrl: '', botToken: 'tok', path: '/p', onEvent: () => {} }),
      /serverUrl must be a non-empty string/
    )
    assert.throws(
      () => createSseClient({ serverUrl: 'not_a_url', botToken: 'tok', path: '/p', onEvent: () => {} }),
      /serverUrl must be a valid absolute URL/
    )
    assert.throws(
      () => createSseClient({ serverUrl: 'ftp://localhost', botToken: 'tok', path: '/p', onEvent: () => {} }),
      /serverUrl scheme must be http: or https:/
    )
    assert.throws(
      () => createSseClient({ serverUrl: 'http://localhost', botToken: 'tok', path: 'no_slash', onEvent: () => {} }),
      /path must be a string beginning with "\/"/
    )
    assert.throws(
      () => createSseClient({ serverUrl: 'http://localhost', botToken: 'tok', path: 'http://other/path', onEvent: () => {} }),
      /path must not be an absolute URL/
    )
  })

  test('34. Factory validates botToken and onEvent', () => {
    assert.throws(
      () => createSseClient({ serverUrl: 'http://localhost', botToken: '', path: '/p', onEvent: () => {} }),
      /botToken must be a non-empty string/
    )
    assert.throws(
      // @ts-ignore
      () => createSseClient({ serverUrl: 'http://localhost', botToken: 'tok', path: '/p', onEvent: 'not_fn' }),
      /onEvent must be a function/
    )
  })
})
