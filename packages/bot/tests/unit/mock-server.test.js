import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createMockServer } from '../../src/testing/mock-server.js'
import {
  sign,
  encodeBotMessagePayload,
  encodePublisherKeyPayload
} from '../../src/runtime/crypto/signing.js'

/**
 * Helper to generate an Ed25519 keypair for test assertions.
 */
function generateEd25519KeyPair () {
  const seed = new Uint8Array(crypto.randomBytes(32))
  const pkcs8Der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed
  ])
  const privKeyObject = crypto.createPrivateKey({
    key: pkcs8Der,
    format: 'der',
    type: 'pkcs8'
  })
  const pubKeyObject = crypto.createPublicKey(privKeyObject)
  const spkiDer = pubKeyObject.export({ format: 'der', type: 'spki' })
  const pubkey = new Uint8Array(spkiDer.subarray(12, 44))
  return { seed, pubkey }
}

test('Mock Server Unit Tests', async (t) => {
  // Lifecycle
  await t.test('1. createMockServer() resolves with a started server', async () => {
    const server = await createMockServer()
    try {
      assert.ok(server)
      assert.equal(typeof server.getUrl, 'function')
    } finally {
      await server.close()
    }
  })

  await t.test('2. getUrl() returns an http://127.0.0.1:<port> string', async () => {
    const server = await createMockServer()
    try {
      const url = server.getUrl()
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/)
    } finally {
      await server.close()
    }
  })

  await t.test('3. getPort() returns a number greater than 0', async () => {
    const server = await createMockServer()
    try {
      const port = server.getPort()
      assert.equal(typeof port, 'number')
      assert.ok(port > 0)
    } finally {
      await server.close()
    }
  })

  await t.test('4. close() shuts down the server', async () => {
    const server = await createMockServer()
    const url = server.getUrl()
    await server.close()
    await assert.rejects(async () => {
      await fetch(`${url}/capabilities`)
    }, (err) => err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED')
  })

  await t.test('5. close() is idempotent', async () => {
    const server = await createMockServer()
    await server.close()
    await server.close() // Should resolve immediately without error
  })

  await t.test('6. Two mock servers bind on different ports', async () => {
    const server1 = await createMockServer()
    const server2 = await createMockServer()
    try {
      assert.notEqual(server1.getPort(), server2.getPort())
    } finally {
      await server1.close()
      await server2.close()
    }
  })

  // Default responses
  await t.test('7. GET /capabilities returns the configured sockudo fields', async () => {
    const server = await createMockServer({
      sockudoUrl: 'wss://sockudo.test',
      sockudoAppKey: 'app-key-123',
      sockudoAuthEndpoint: '/custom/auth'
    })
    try {
      const res = await fetch(`${server.getUrl()}/capabilities`)
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.equal(json.sockudo_url, 'wss://sockudo.test')
      assert.equal(json.sockudo_app_key, 'app-key-123')
      assert.equal(json.sockudo_auth_endpoint, '/custom/auth')
      assert.equal(json.version, '3.0.2')
      assert.equal(json.bots_enabled, true)
    } finally {
      await server.close()
    }
  })

  await t.test('8. GET /api/v1/bots/:id returns the configured bot id and owner', async () => {
    const server = await createMockServer({
      botId: 'b_custom_1',
      ownerUserId: 'u_owner_99'
    })
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/bots/b_custom_1`)
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.equal(json.id, 'b_custom_1')
      assert.equal(json.owner_user_id, 'u_owner_99')
      assert.equal(json.display_name, 'Mock Bot')
      assert.equal(json.avatar_file_id, null)
    } finally {
      await server.close()
    }
  })

  await t.test('9. POST /sockudo/auth returns an auth string starting with the app key', async () => {
    const server = await createMockServer({
      sockudoAppKey: 'my-app-key'
    })
    try {
      const res = await fetch(`${server.getUrl()}/sockudo/auth`, { method: 'POST' })
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.ok(json.auth.startsWith('my-app-key:'))
    } finally {
      await server.close()
    }
  })

  await t.test('10. GET /api/v1/bots/me/settings returns []', async () => {
    const server = await createMockServer()
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/bots/me/settings`)
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.deepEqual(json, [])
    } finally {
      await server.close()
    }
  })

  await t.test('11. POST /api/v1/bots/me/messages returns a message id', async () => {
    const server = await createMockServer()
    try {
      const res1 = await fetch(`${server.getUrl()}/api/v1/bots/me/messages`, { method: 'POST' })
      const json1 = await res1.json()
      const res2 = await fetch(`${server.getUrl()}/api/v1/bots/me/messages`, { method: 'POST' })
      const json2 = await res2.json()
      assert.equal(json1.id, 'm_mock_1')
      assert.equal(json2.id, 'm_mock_2')
    } finally {
      await server.close()
    }
  })

  await t.test('12. POST /api/v1/bots/me/commands/:id/ack returns 204', async () => {
    const server = await createMockServer()
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/bots/me/commands/cmd_123/ack`, { method: 'POST' })
      assert.equal(res.status, 204)
    } finally {
      await server.close()
    }
  })

  await t.test('13. POST /api/v1/bots/me/pause returns 202', async () => {
    const server = await createMockServer()
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/bots/me/pause`, { method: 'POST' })
      assert.equal(res.status, 202)
    } finally {
      await server.close()
    }
  })

  await t.test('14. POST /api/v1/rooms/r_abc/bot-messages returns a message id and a created_at ISO string', async () => {
    const server = await createMockServer()
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/rooms/r_abc/bot-messages`, { method: 'POST' })
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.match(json.id, /^m_mock_\d+$/)
      assert.ok(!isNaN(Date.parse(json.created_at)))
    } finally {
      await server.close()
    }
  })

  await t.test('15. GET /api/v1/kt/user/:id returns 404 by default', async () => {
    const server = await createMockServer()
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/kt/user/u_123`)
      assert.equal(res.status, 404)
      const json = await res.json()
      assert.equal(json.error, 'not_found')
    } finally {
      await server.close()
    }
  })

  await t.test('16. Unknown path returns 404 with { error: "not_found" }', async () => {
    const server = await createMockServer()
    try {
      const res = await fetch(`${server.getUrl()}/unknown/route`)
      assert.equal(res.status, 404)
      const json = await res.json()
      assert.equal(json.error, 'not_found')
    } finally {
      await server.close()
    }
  })

  await t.test('17. Wrong method on a known path returns 405', async () => {
    const server = await createMockServer()
    try {
      const res = await fetch(`${server.getUrl()}/capabilities`, { method: 'POST' })
      assert.equal(res.status, 405)
      const json = await res.json()
      assert.equal(json.error, 'method_not_allowed')
    } finally {
      await server.close()
    }
  })

  // Request recording
  await t.test('18. Every request is recorded', async () => {
    const server = await createMockServer()
    try {
      await fetch(`${server.getUrl()}/capabilities`)
      await fetch(`${server.getUrl()}/api/v1/bots/me/settings`)
      await fetch(`${server.getUrl()}/api/v1/bots/me/messages`, { method: 'POST' })
      assert.equal(server.requests.length, 3)
    } finally {
      await server.close()
    }
  })

  await t.test('19. Recorded request has method, path, query, headers, body, json', async () => {
    const server = await createMockServer()
    try {
      await fetch(`${server.getUrl()}/api/v1/bots/me/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hello: 'world' })
      })
      const req = server.requests[0]
      assert.equal(req.method, 'POST')
      assert.equal(req.path, '/api/v1/bots/me/messages')
      assert.equal(req.query, '')
      assert.ok(req.headers)
      assert.equal(req.body, '{"hello":"world"}')
      assert.deepEqual(req.json, { hello: 'world' })
    } finally {
      await server.close()
    }
  })

  await t.test('20. JSON body is parsed', async () => {
    const server = await createMockServer()
    try {
      await fetch(`${server.getUrl()}/api/v1/bots/me/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: 1 })
      })
      assert.equal(server.requests[0].json.a, 1)
    } finally {
      await server.close()
    }
  })

  await t.test('21. Non-JSON body leaves json undefined', async () => {
    const server = await createMockServer()
    try {
      await fetch(`${server.getUrl()}/api/v1/bots/me/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'plain text'
      })
      assert.equal(server.requests[0].json, undefined)
    } finally {
      await server.close()
    }
  })

  await t.test('22. Query string is captured', async () => {
    const server = await createMockServer()
    try {
      await fetch(`${server.getUrl()}/capabilities?x=1&y=2`)
      assert.equal(server.requests[0].query, '?x=1&y=2')
    } finally {
      await server.close()
    }
  })

  await t.test('23. 404 requests are recorded too', async () => {
    const server = await createMockServer()
    try {
      await fetch(`${server.getUrl()}/does-not-exist`)
      assert.equal(server.requests.length, 1)
      assert.equal(server.requests[0].path, '/does-not-exist')
    } finally {
      await server.close()
    }
  })

  // Overrides
  await t.test('24. setResponse overrides the default response for a path', async () => {
    const server = await createMockServer()
    try {
      server.setResponse('GET', '/capabilities', { body: { custom: true } })
      const res = await fetch(`${server.getUrl()}/capabilities`)
      const json = await res.json()
      assert.equal(json.custom, true)
    } finally {
      await server.close()
    }
  })

  await t.test('25. setResponse with a custom status and body', async () => {
    const server = await createMockServer()
    try {
      server.setResponse('GET', '/custom', { status: 201, body: { created: true } })
      const res = await fetch(`${server.getUrl()}/custom`)
      assert.equal(res.status, 201)
      const json = await res.json()
      assert.equal(json.created, true)
    } finally {
      await server.close()
    }
  })

  await t.test('26. setHandler receives the recorded request and a response object', async () => {
    const server = await createMockServer()
    try {
      server.setHandler('POST', '/custom-handler', (req, res) => {
        res.send(202, { received: req.json.foo })
      })
      const res = await fetch(`${server.getUrl()}/custom-handler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' })
      })
      assert.equal(res.status, 202)
      const json = await res.json()
      assert.equal(json.received, 'bar')
    } finally {
      await server.close()
    }
  })

  await t.test('27. setHandler can send a chunked response', async () => {
    const server = await createMockServer()
    try {
      server.setHandler('GET', '/chunked', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.write('hello ')
        res.write('world')
        res.end()
      })
      const res = await fetch(`${server.getUrl()}/chunked`)
      const text = await res.text()
      assert.equal(text, 'hello world')
    } finally {
      await server.close()
    }
  })

  await t.test('28. onRequest callback runs first (fall-through)', async () => {
    const server = await createMockServer({
      onRequest (req) {
        req.passedThrough = true
        return false
      }
    })
    try {
      const res = await fetch(`${server.getUrl()}/capabilities`)
      assert.equal(res.status, 200)
      assert.equal(server.requests[0].passedThrough, true)
    } finally {
      await server.close()
    }
  })

  await t.test('29. onRequest returning true short-circuits', async () => {
    const server = await createMockServer({
      onRequest (_req, res) {
        res.send(203, { intercepted: true })
        return true
      }
    })
    try {
      const res = await fetch(`${server.getUrl()}/capabilities`)
      assert.equal(res.status, 203)
      const json = await res.json()
      assert.equal(json.intercepted, true)
    } finally {
      await server.close()
    }
  })

  await t.test('30. Override precedence: onRequest > setHandler > setResponse > default', async () => {
    let mode = 'onRequest'
    const server = await createMockServer({
      onRequest (_req, res) {
        if (mode === 'onRequest') {
          res.send(201, { layer: 'onRequest' })
          return true
        }
        return false
      }
    })
    try {
      server.setHandler('GET', '/test-route', (_req, res) => {
        res.send(202, { layer: 'setHandler' })
      })
      server.setResponse('GET', '/test-route', { status: 203, body: { layer: 'setResponse' } })

      // 1. onRequest handles
      let res = await fetch(`${server.getUrl()}/test-route`)
      let json = await res.json()
      assert.equal(json.layer, 'onRequest')

      // 2. setHandler handles when onRequest passes through
      mode = 'pass'
      res = await fetch(`${server.getUrl()}/test-route`)
      json = await res.json()
      assert.equal(json.layer, 'setHandler')

      // 3. setResponse handles when setHandler removed
      server.setHandler('GET', '/test-route', null)
      res = await fetch(`${server.getUrl()}/test-route`)
      json = await res.json()
      assert.equal(json.layer, 'setResponse')
    } finally {
      await server.close()
    }
  })

  // Crypto validation — validateCrypto: true
  await t.test('31. A valid signature is accepted (validateCrypto: true)', async () => {
    const { seed, pubkey } = generateEd25519KeyPair()
    const server = await createMockServer({
      validateCrypto: true,
      botIdentityPubkey: pubkey
    })
    try {
      const roomId = 'r_valid'
      const epoch = 1
      const contentType = 'bot'
      const ciphertext = new Uint8Array(64).fill(0xaa)

      const signingPayload = encodeBotMessagePayload({
        roomId,
        epoch,
        contentType,
        ciphertext
      })
      const signature = sign(signingPayload, seed)

      const res = await fetch(`${server.getUrl()}/api/v1/rooms/${roomId}/bot-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epoch,
          ciphertext: Buffer.from(ciphertext).toString('base64url'),
          content_type: contentType,
          signature: Buffer.from(signature).toString('base64url'),
          request_id: 'req_1'
        })
      })
      assert.equal(res.status, 200)
    } finally {
      await server.close()
    }
  })

  await t.test('32. A wrong signature is rejected (signature_invalid)', async () => {
    const { seed, pubkey } = generateEd25519KeyPair()
    const server = await createMockServer({
      validateCrypto: true,
      botIdentityPubkey: pubkey
    })
    try {
      const roomId = 'r_invalid'
      const epoch = 1
      const contentType = 'bot'
      const ciphertext = new Uint8Array(60).fill(0xaa)

      const signingPayload = encodeBotMessagePayload({
        roomId,
        epoch,
        contentType,
        ciphertext
      })
      const signature = sign(signingPayload, seed)
      signature[0] ^= 0xff // Corrupt signature

      const res = await fetch(`${server.getUrl()}/api/v1/rooms/${roomId}/bot-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epoch,
          ciphertext: Buffer.from(ciphertext).toString('base64url'),
          content_type: contentType,
          signature: Buffer.from(signature).toString('base64url'),
          request_id: 'req_1'
        })
      })
      assert.equal(res.status, 400)
      const json = await res.json()
      assert.equal(json.error, 'signature_invalid')
    } finally {
      await server.close()
    }
  })

  await t.test('33. A missing signature is rejected (invalid_request)', async () => {
    const { pubkey } = generateEd25519KeyPair()
    const server = await createMockServer({
      validateCrypto: true,
      botIdentityPubkey: pubkey
    })
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/rooms/r_1/bot-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epoch: 1,
          ciphertext: Buffer.from(new Uint8Array(60)).toString('base64url'),
          content_type: 'bot',
          request_id: 'req_1'
        })
      })
      assert.equal(res.status, 400)
      const json = await res.json()
      assert.equal(json.error, 'invalid_request')
    } finally {
      await server.close()
    }
  })

  await t.test('34. A too-short ciphertext is rejected', async () => {
    const { pubkey } = generateEd25519KeyPair()
    const server = await createMockServer({
      validateCrypto: true,
      botIdentityPubkey: pubkey
    })
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/rooms/r_1/bot-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epoch: 1,
          ciphertext: Buffer.from(new Uint8Array(30)).toString('base64url'),
          content_type: 'bot',
          signature: Buffer.from(new Uint8Array(64)).toString('base64url'),
          request_id: 'req_1'
        })
      })
      assert.equal(res.status, 400)
      const json = await res.json()
      assert.equal(json.error, 'invalid_request')
    } finally {
      await server.close()
    }
  })

  await t.test('35. A malformed base64url signature is rejected', async () => {
    const { pubkey } = generateEd25519KeyPair()
    const server = await createMockServer({
      validateCrypto: true,
      botIdentityPubkey: pubkey
    })
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/rooms/r_1/bot-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epoch: 1,
          ciphertext: Buffer.from(new Uint8Array(60)).toString('base64url'),
          content_type: 'bot',
          signature: 'invalid_base64!!!',
          request_id: 'req_1'
        })
      })
      assert.equal(res.status, 400)
      const json = await res.json()
      assert.equal(json.error, 'invalid_request')
    } finally {
      await server.close()
    }
  })

  await t.test('36. validateCrypto: false accepts a wrong signature', async () => {
    const server = await createMockServer({ validateCrypto: false })
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/rooms/r_1/bot-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epoch: 1,
          ciphertext: 'invalid',
          signature: 'invalid'
        })
      })
      assert.equal(res.status, 200)
    } finally {
      await server.close()
    }
  })

  await t.test('37. KT lookup missing rejects publisher key publication', async () => {
    const { pubkey } = generateEd25519KeyPair()
    const server = await createMockServer({
      validateCrypto: true,
      botIdentityPubkey: pubkey
    })
    try {
      const res = await fetch(`${server.getUrl()}/api/v1/rooms/r_1/publisher-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epoch: 1,
          publisher_public_key: Buffer.from(new Uint8Array(32)).toString('base64url'),
          signature: Buffer.from(new Uint8Array(64)).toString('base64url')
        })
      })
      assert.equal(res.status, 400)
      const json = await res.json()
      assert.equal(json.error, 'kt_missing')
    } finally {
      await server.close()
    }
  })

  // SSE
  await t.test('38. GET /observer-stream opens a stream with retry: 1000', async () => {
    const server = await createMockServer()
    try {
      const controller = new AbortController()
      const res = await fetch(`${server.getUrl()}/api/v1/rooms/r_1/observer-stream`, {
        signal: controller.signal
      })
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), 'text/event-stream')

      const reader = res.body.getReader()
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      assert.ok(text.includes('retry: 1000'))
      controller.abort()
    } finally {
      await server.close()
    }
  })

  await t.test('39. sseEmit writes an event', async () => {
    const server = await createMockServer()
    try {
      const controller = new AbortController()
      const path = '/api/v1/rooms/r_1/observer-stream'
      const res = await fetch(`${server.getUrl()}${path}`, { signal: controller.signal })
      const reader = res.body.getReader()

      // Read retry directive
      await reader.read()

      // Emit event
      server.sseEmit(path, { event: 'message.new', data: { id: 'm_1' }, id: 'evt_1' })

      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      assert.ok(text.includes('event: message.new'))
      assert.ok(text.includes('data: {"id":"m_1"}'))
      assert.ok(text.includes('id: evt_1'))
      controller.abort()
    } finally {
      await server.close()
    }
  })

  await t.test('40. Multiple events are written in order', async () => {
    const server = await createMockServer()
    try {
      const controller = new AbortController()
      const path = '/api/v1/rooms/r_1/observer-stream'
      const res = await fetch(`${server.getUrl()}${path}`, { signal: controller.signal })
      const reader = res.body.getReader()

      await reader.read() // retry directive

      server.sseEmit(path, { event: 'evt1', data: { seq: 1 } })
      server.sseEmit(path, { event: 'evt2', data: { seq: 2 } })

      let chunks = ''
      while (!chunks.includes('evt2')) {
        const { value } = await reader.read()
        chunks += new TextDecoder().decode(value)
      }

      const idx1 = chunks.indexOf('event: evt1')
      const idx2 = chunks.indexOf('event: evt2')
      assert.ok(idx1 >= 0 && idx2 > idx1)
      controller.abort()
    } finally {
      await server.close()
    }
  })

  await t.test('41. sseEmit on a different path does not affect the stream', async () => {
    const server = await createMockServer()
    try {
      const controller = new AbortController()
      const path1 = '/api/v1/rooms/r_1/observer-stream'
      const path2 = '/api/v1/rooms/r_2/observer-stream'

      const res = await fetch(`${server.getUrl()}${path1}`, { signal: controller.signal })
      const reader = res.body.getReader()
      await reader.read() // retry

      server.sseEmit(path2, { event: 'ignored', data: {} })

      // Attempting to read with a short race/timeout or checking stream stays quiet
      server.sseEmit(path1, { event: 'expected', data: {} })
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      assert.ok(!text.includes('event: ignored'))
      assert.ok(text.includes('event: expected'))
      controller.abort()
    } finally {
      await server.close()
    }
  })

  await t.test('42. Multiple streams on the same path both receive an emit', async () => {
    const server = await createMockServer()
    try {
      const ctrl1 = new AbortController()
      const ctrl2 = new AbortController()
      const path = '/api/v1/rooms/r_1/observer-stream'

      const res1 = await fetch(`${server.getUrl()}${path}`, { signal: ctrl1.signal })
      const res2 = await fetch(`${server.getUrl()}${path}`, { signal: ctrl2.signal })

      const reader1 = res1.body.getReader()
      const reader2 = res2.body.getReader()
      await reader1.read()
      await reader2.read()

      server.sseEmit(path, { event: 'broadcast', data: { msg: 'hello' } })

      const chunk1 = await reader1.read()
      const chunk2 = await reader2.read()

      assert.ok(new TextDecoder().decode(chunk1.value).includes('event: broadcast'))
      assert.ok(new TextDecoder().decode(chunk2.value).includes('event: broadcast'))

      ctrl1.abort()
      ctrl2.abort()
    } finally {
      await server.close()
    }
  })

  await t.test('43. Client disconnect removes the stream', async () => {
    const server = await createMockServer()
    try {
      const controller = new AbortController()
      const path = '/api/v1/rooms/r_1/observer-stream'
      const res = await fetch(`${server.getUrl()}${path}`, { signal: controller.signal })
      const reader = res.body.getReader()
      await reader.read()

      controller.abort() // Disconnect client
      await new Promise((r) => setTimeout(r, 50))

      // Emit should not throw
      server.sseEmit(path, { event: 'test', data: {} })
    } finally {
      await server.close()
    }
  })

  await t.test('44. close() destroys active streams', async () => {
    const server = await createMockServer()
    const path = '/api/v1/rooms/r_1/observer-stream'
    const res = await fetch(`${server.getUrl()}${path}`)
    const reader = res.body.getReader()
    await reader.read() // retry

    await server.close()

    const { done } = await reader.read()
    assert.equal(done, true)
  })

  // Error envelope
  await t.test('45. 404 responses have Content-Type: application/json', async () => {
    const server = await createMockServer()
    try {
      const res = await fetch(`${server.getUrl()}/nonexistent`)
      assert.equal(res.status, 404)
      assert.ok(res.headers.get('content-type').includes('application/json'))
    } finally {
      await server.close()
    }
  })

  await t.test('46. 405 responses have Content-Type: application/json', async () => {
    const server = await createMockServer()
    try {
      const res = await fetch(`${server.getUrl()}/capabilities`, { method: 'POST' })
      assert.equal(res.status, 405)
      assert.ok(res.headers.get('content-type').includes('application/json'))
    } finally {
      await server.close()
    }
  })
})
