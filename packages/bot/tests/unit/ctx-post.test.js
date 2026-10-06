import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import crypto, { createPublicKey } from 'node:crypto'
import { createPostHandler, PUBLISHER_MESSAGE_INFO } from '../../src/runtime/context/post.js'
import { createHttpClient } from '../../src/runtime/transport/http.js'
import { PublisherKeyCache } from '../../src/runtime/crypto/publisher.js'
import { sign, verify, encodePublisherKeyPayload, encodeBotMessagePayload, keyObjectFromSeed } from '../../src/runtime/crypto/signing.js'
import { decrypt, keyObjectFromX25519Private } from '../../src/runtime/crypto/command-result.js'
import { PostFailedError, HttpRequestError, PublisherKeyVerificationFailedError } from '../../src/errors.js'

const SIGNER_SEED = Buffer.alloc(32, 0x11)
const BOT_SEED = Buffer.alloc(32, 0x22)
const PUBLISHER_PRIV = Buffer.alloc(32, 0xcd)

/**
 * @returns {Uint8Array}
 */
function signerPublicKey () {
  const der = createPublicKey(keyObjectFromSeed(SIGNER_SEED)).export({ type: 'spki', format: 'der' })
  return new Uint8Array(der.subarray(der.length - 32))
}

/**
 * @returns {Uint8Array}
 */
function botPublicKey () {
  const der = createPublicKey(keyObjectFromSeed(BOT_SEED)).export({ type: 'spki', format: 'der' })
  return new Uint8Array(der.subarray(der.length - 32))
}

/**
 * @returns {Uint8Array}
 */
function publisherPublicKey () {
  const privKo = keyObjectFromX25519Private(PUBLISHER_PRIV)
  const pubKo = crypto.createPublicKey(privKo)
  const spkiDer = pubKo.export({ type: 'spki', format: 'der' })
  return new Uint8Array(spkiDer.subarray(12))
}

const PUBLISHER_PUB = publisherPublicKey()
const ROOM_ID = 'r_test'

/**
 * @returns {Promise<PublisherKeyCache>}
 */
async function setupCache () {
  const cache = new PublisherKeyCache({
    lookupSignerPubkey: async (uid) => uid === 'u_alice' ? signerPublicKey() : null
  })
  const payload = encodePublisherKeyPayload({
    roomId: ROOM_ID,
    epoch: 42,
    publisherPublicKey: PUBLISHER_PUB
  })
  const signature = sign(payload, SIGNER_SEED)
  await cache.recordPublication({
    roomId: ROOM_ID,
    epoch: 42,
    publisherPublicKey: PUBLISHER_PUB,
    signerUserId: 'u_alice',
    signature
  })
  return cache
}

/**
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void} handler
 * @returns {Promise<{ server: import('node:http').Server, url: string }>}
 */
function startServer (handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'string' || !address) {
        throw new Error('invalid server address')
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`
      })
    })
  })
}

describe('ctx.post', () => {
  test('1. Happy path', async () => {
    let receivedUrl
    const { server, url } = await startServer((req, res) => {
      receivedUrl = req.url
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'm_1',
        created_at: '2026-10-06T12:00:00Z'
      }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      const result = await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.deepEqual(result, {
        id: 'm_1',
        roomId: ROOM_ID,
        createdAt: '2026-10-06T12:00:00Z'
      })
      assert.equal(receivedUrl, `/rooms/${ROOM_ID}/bot-messages`)
    } finally {
      server.close()
    }
  })

  test('2. Request body shape', async () => {
    /** @type {Record<string, any> | undefined} */
    let recordedBody
    const { server, url } = await startServer((req, res) => {
      let data = ''
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        recordedBody = JSON.parse(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'm_1' }))
      })
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.ok(recordedBody)
      assert.equal(recordedBody.epoch, 42)
      assert.equal(recordedBody.content_type, 'bot')
      assert.equal(typeof recordedBody.ciphertext, 'string')
      assert.equal(typeof recordedBody.signature, 'string')
      assert.equal(typeof recordedBody.request_id, 'string')
      assert.ok(recordedBody.request_id.length > 0)
      assert.equal(recordedBody.reply_to, undefined)
    } finally {
      server.close()
    }
  })

  test('3. reply_to included when set', async () => {
    /** @type {Record<string, any> | undefined} */
    let recordedBody
    const { server, url } = await startServer((req, res) => {
      let data = ''
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        recordedBody = JSON.parse(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'm_1' }))
      })
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await post({ text: 'hello', replyTo: 'm_parent' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.ok(recordedBody)
      assert.equal(recordedBody.reply_to, 'm_parent')
    } finally {
      server.close()
    }
  })

  test('4. Ciphertext is decodable by publisher key holder', async () => {
    /** @type {Record<string, any> | undefined} */
    let recordedBody
    const { server, url } = await startServer((req, res) => {
      let data = ''
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        recordedBody = JSON.parse(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'm_1' }))
      })
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await post({ text: 'hello world' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.ok(recordedBody)
      const fullCt = Buffer.from(recordedBody.ciphertext, 'base64url')
      const ephemeralPub = fullCt.subarray(0, 32)
      const innerWire = fullCt.subarray(32)

      const decrypted = decrypt({
        privateKey: PUBLISHER_PRIV,
        peerPublicKey: ephemeralPub,
        info: PUBLISHER_MESSAGE_INFO,
        ciphertext: innerWire
      })

      const json = JSON.parse(Buffer.from(decrypted).toString('utf8'))
      assert.equal(json.text, 'hello world')
      assert.equal(json.attachments, null)
      assert.equal(json.reply_to, null)
    } finally {
      server.close()
    }
  })

  test('5. Signature verifies', async () => {
    /** @type {Record<string, any> | undefined} */
    let recordedBody
    const { server, url } = await startServer((req, res) => {
      let data = ''
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        recordedBody = JSON.parse(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'm_1' }))
      })
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await post({ text: 'verify signature' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.ok(recordedBody)
      const sig = Buffer.from(recordedBody.signature, 'base64url')
      const ct = Buffer.from(recordedBody.ciphertext, 'base64url')
      const payload = encodeBotMessagePayload({
        roomId: ROOM_ID,
        epoch: 42,
        contentType: 'bot',
        ciphertext: ct
      })

      const isValid = verify(sig, payload, botPublicKey())
      assert.equal(isValid, true)
    } finally {
      server.close()
    }
  })

  test('6. Ephemeral key is fresh per call', async () => {
    /** @type {string[]} */
    const ciphertexts = []
    const { server, url } = await startServer((req, res) => {
      let data = ''
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        const body = JSON.parse(data)
        ciphertexts.push(body.ciphertext)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'm_' + ciphertexts.length }))
      })
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await post({ text: 'msg1' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })
      await post({ text: 'msg2' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.equal(ciphertexts.length, 2)
      const ct0 = ciphertexts[0]
      const ct1 = ciphertexts[1]
      assert.ok(ct0 && ct1)
      const pub1 = Buffer.from(ct0, 'base64url').subarray(0, 32)
      const pub2 = Buffer.from(ct1, 'base64url').subarray(0, 32)
      assert.notDeepEqual(pub1, pub2)
    } finally {
      server.close()
    }
  })

  test('7. request_id is fresh per call', async () => {
    /** @type {string[]} */
    const requestIds = []
    const { server, url } = await startServer((req, res) => {
      let data = ''
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        const body = JSON.parse(data)
        requestIds.push(body.request_id)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'm_' + requestIds.length }))
      })
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await post({ text: 'msg1' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })
      await post({ text: 'msg2' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.equal(requestIds.length, 2)
      assert.notEqual(requestIds[0], requestIds[1])
    } finally {
      server.close()
    }
  })

  test('8. Room id from ctx.grant when opts.roomId is unset', async () => {
    let targetUrl
    const { server, url } = await startServer((req, res) => {
      targetUrl = req.url
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })
      assert.equal(targetUrl, `/rooms/${ROOM_ID}/bot-messages`)
    } finally {
      server.close()
    }
  })

  test('9. opts.roomId overrides ctx.grant', async () => {
    let targetUrl
    const { server, url } = await startServer((req, res) => {
      targetUrl = req.url
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = new PublisherKeyCache({ lookupSignerPubkey: async () => signerPublicKey() })
      const payload = encodePublisherKeyPayload({
        roomId: 'r_other',
        epoch: 10,
        publisherPublicKey: PUBLISHER_PUB
      })
      const signature = sign(payload, SIGNER_SEED)
      await publisherKeys.recordPublication({
        roomId: 'r_other',
        epoch: 10,
        publisherPublicKey: PUBLISHER_PUB,
        signerUserId: 'u_alice',
        signature
      })

      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await post({ roomId: 'r_other', text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })
      assert.equal(targetUrl, '/rooms/r_other/bot-messages')
    } finally {
      server.close()
    }
  })

  test('10. No room id throws PostFailedError', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await assert.rejects(
        async () => { await post({ text: 'hello' }, { grant: null }) },
        (err) => {
          assert.ok(err instanceof PostFailedError)
          assert.equal(err.code, 'post_failed')
          assert.match(err.message, /room id/i)
          assert.ok(err.cause instanceof TypeError)
          return true
        }
      )
    } finally {
      server.close()
    }
  })

  test('11. Member mode throws PostFailedError', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await assert.rejects(
        async () => { await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'member' } }) },
        (err) => {
          assert.ok(err instanceof PostFailedError)
          assert.match(err.message, /MLS/i)
          return true
        }
      )
    } finally {
      server.close()
    }
  })

  test('12. Observer mode uses the same ECDH path', async () => {
    let receivedUrl
    const { server, url } = await startServer((req, res) => {
      receivedUrl = req.url
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      const result = await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'observer' } })
      assert.equal(result.id, 'm_1')
      assert.equal(receivedUrl, `/rooms/${ROOM_ID}/bot-messages`)
    } finally {
      server.close()
    }
  })

  test('13. Missing publisher key throws PostFailedError', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = new PublisherKeyCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await assert.rejects(
        async () => { await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } }) },
        (err) => {
          assert.ok(err instanceof PostFailedError)
          assert.ok(err.cause instanceof Error)
          return true
        }
      )
    } finally {
      server.close()
    }
  })

  test('14. Unverified publisher key throws', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = new PublisherKeyCache({
        lookupSignerPubkey: async () => signerPublicKey()
      })
      const badSig = new Uint8Array(64).fill(0xff)
      await publisherKeys.recordPublication({
        roomId: ROOM_ID,
        epoch: 42,
        publisherPublicKey: PUBLISHER_PUB,
        signerUserId: 'u_alice',
        signature: badSig
      })

      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await assert.rejects(
        async () => { await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } }) },
        (err) => {
          assert.ok(err instanceof PostFailedError)
          assert.ok(err.cause instanceof PublisherKeyVerificationFailedError)
          return true
        }
      )
    } finally {
      server.close()
    }
  })

  test('15. HTTP 4xx throws PostFailedError with cause set', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad_request' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await assert.rejects(
        async () => { await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } }) },
        (err) => {
          assert.ok(err instanceof PostFailedError)
          assert.ok(err.cause instanceof HttpRequestError)
          assert.equal(err.cause.status, 400)
          return true
        }
      )
    } finally {
      server.close()
    }
  })

  test('16. HTTP 5xx retries', async () => {
    let attempts = 0
    const { server, url } = await startServer((_req, res) => {
      attempts++
      if (attempts < 3) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'server_error' }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'm_1' }))
      }
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token', backoffMs: [10, 20, 30] })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      const res = await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })
      assert.equal(res.id, 'm_1')
      assert.equal(attempts, 3)
    } finally {
      server.close()
    }
  })

  test('17. HTTP 5xx exhaustion throws PostFailedError', async () => {
    let attempts = 0
    const { server, url } = await startServer((_req, res) => {
      attempts++
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'server_error' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token', backoffMs: [10, 10, 10] })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await assert.rejects(
        async () => { await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } }) },
        (err) => {
          assert.ok(err instanceof PostFailedError)
          assert.ok(err.cause instanceof HttpRequestError)
          assert.equal(err.cause.status, 500)
          return true
        }
      )
      assert.equal(attempts, 4)
    } finally {
      server.close()
    }
  })

  test('18. Malformed response throws PostFailedError', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({}))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await assert.rejects(
        async () => { await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } }) },
        (err) => {
          assert.ok(err instanceof PostFailedError)
          assert.match(err.message, /response/i)
          return true
        }
      )
    } finally {
      server.close()
    }
  })

  test('19. Response with created_at absent uses current time', async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      const res = await post({ text: 'hello' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })
      assert.equal(res.id, 'm_1')
      assert.equal(typeof res.createdAt, 'string')
      assert.ok(!isNaN(Date.parse(res.createdAt)))
    } finally {
      server.close()
    }
  })

  test('20. text is serialized into the plaintext', async () => {
    /** @type {Record<string, any> | undefined} */
    let recordedBody
    const { server, url } = await startServer((req, res) => {
      let data = ''
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        recordedBody = JSON.parse(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'm_1' }))
      })
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await post({ text: 'hello text test' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.ok(recordedBody)
      const fullCt = Buffer.from(recordedBody.ciphertext, 'base64url')
      const ephemeralPub = fullCt.subarray(0, 32)
      const innerWire = fullCt.subarray(32)

      const decrypted = decrypt({
        privateKey: PUBLISHER_PRIV,
        peerPublicKey: ephemeralPub,
        info: PUBLISHER_MESSAGE_INFO,
        ciphertext: innerWire
      })

      const json = JSON.parse(Buffer.from(decrypted).toString('utf8'))
      assert.equal(json.text, 'hello text test')
    } finally {
      server.close()
    }
  })

  test('21. Attachments are serialized into the plaintext', async () => {
    /** @type {Record<string, any> | undefined} */
    let recordedBody
    const { server, url } = await startServer((req, res) => {
      let data = ''
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        recordedBody = JSON.parse(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'm_1' }))
      })
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      /** @type {AttachmentRef[]} */
      const attachments = [{
        fileId: 'att_1',
        size: 100,
        contentType: 'image/png'
      }]
      await post({ text: 'with attachment', attachments }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.ok(recordedBody)
      const fullCt = Buffer.from(recordedBody.ciphertext, 'base64url')
      const ephemeralPub = fullCt.subarray(0, 32)
      const innerWire = fullCt.subarray(32)

      const decrypted = decrypt({
        privateKey: PUBLISHER_PRIV,
        peerPublicKey: ephemeralPub,
        info: PUBLISHER_MESSAGE_INFO,
        ciphertext: innerWire
      })

      const json = JSON.parse(Buffer.from(decrypted).toString('utf8'))
      assert.deepEqual(json.attachments, attachments)
    } finally {
      server.close()
    }
  })

  test('22. Empty text with attachments', async () => {
    /** @type {Record<string, any> | undefined} */
    let recordedBody
    const { server, url } = await startServer((req, res) => {
      let data = ''
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        recordedBody = JSON.parse(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'm_1' }))
      })
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      /** @type {AttachmentRef[]} */
      const attachments = [{
        fileId: 'att_1',
        size: 200,
        contentType: 'application/pdf'
      }]
      await post({ attachments }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.ok(recordedBody)
      const fullCt = Buffer.from(recordedBody.ciphertext, 'base64url')
      const ephemeralPub = fullCt.subarray(0, 32)
      const innerWire = fullCt.subarray(32)

      const decrypted = decrypt({
        privateKey: PUBLISHER_PRIV,
        peerPublicKey: ephemeralPub,
        info: PUBLISHER_MESSAGE_INFO,
        ciphertext: innerWire
      })

      const json = JSON.parse(Buffer.from(decrypted).toString('utf8'))
      assert.equal(json.text, null)
      assert.deepEqual(json.attachments, attachments)
    } finally {
      server.close()
    }
  })

  test('23. Logger emits debug on entry and success', async () => {
    /** @type {Array<{ level: string, msg: string, data: any }>} */
    const logs = []
    /** @type {any} */
    const logger = {
      level: 'debug',
      log: () => {},
      /**
       * @param {string} msg
       * @param {any} data
       */
      debug: (msg, data) => logs.push({ level: 'debug', msg, data }),
      /**
       * @param {string} msg
       * @param {any} data
       */
      info: (msg, data) => logs.push({ level: 'info', msg, data }),
      /**
       * @param {string} msg
       * @param {any} data
       */
      warn: (msg, data) => logs.push({ level: 'warn', msg, data }),
      /**
       * @param {string} msg
       * @param {any} data
       */
      error: (msg, data) => logs.push({ level: 'error', msg, data })
    }

    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED,
        logger
      })

      await post({ text: 'secret message text' }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      assert.equal(logs.length, 2)
      const log0 = logs[0]
      const log1 = logs[1]
      assert.ok(log0 && log1)
      assert.equal(log0.level, 'debug')
      assert.equal(log0.msg, 'ctx.post called')
      assert.equal(log0.data.meta.room_id, ROOM_ID)
      assert.equal(log0.data.meta.has_text, true)

      assert.equal(log1.level, 'debug')
      assert.equal(log1.msg, 'post succeeded')
      assert.equal(log1.data.meta.room_id, ROOM_ID)
      assert.equal(log1.data.meta.message_id, 'm_1')
      assert.equal(typeof log1.data.meta.duration_ms, 'number')
    } finally {
      server.close()
    }
  })

  test('24. Logger does not log message text', async () => {
    /** @type {string[]} */
    const logs = []
    /** @type {any} */
    const logger = {
      level: 'debug',
      log: () => {},
      /**
       * @param {string} msg
       * @param {any} data
       */
      debug: (msg, data) => logs.push(JSON.stringify({ msg, data })),
      /**
       * @param {string} msg
       * @param {any} data
       */
      info: (msg, data) => logs.push(JSON.stringify({ msg, data })),
      /**
       * @param {string} msg
       * @param {any} data
       */
      warn: (msg, data) => logs.push(JSON.stringify({ msg, data })),
      /**
       * @param {string} msg
       * @param {any} data
       */
      error: (msg, data) => logs.push(JSON.stringify({ msg, data }))
    }

    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = await setupCache()
      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED,
        logger
      })

      const sensitiveText = 'super_secret_payload_string_12345'
      await post({ text: sensitiveText }, { grant: { roomId: ROOM_ID, mode: 'write_only' } })

      for (const entry of logs) {
        assert.ok(!entry.includes(sensitiveText))
      }
    } finally {
      server.close()
    }
  })

  test('25. URL-unsafe room ids are encoded', async () => {
    let receivedUrl
    const unsafeRoomId = 'r_test/unsafe'
    const { server, url } = await startServer((req, res) => {
      receivedUrl = req.url
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'm_1' }))
    })

    try {
      const http = createHttpClient({ serverUrl: url, botToken: 'test-token' })
      const publisherKeys = new PublisherKeyCache({ lookupSignerPubkey: async () => signerPublicKey() })
      const payload = encodePublisherKeyPayload({
        roomId: unsafeRoomId,
        epoch: 5,
        publisherPublicKey: PUBLISHER_PUB
      })
      const signature = sign(payload, SIGNER_SEED)
      await publisherKeys.recordPublication({
        roomId: unsafeRoomId,
        epoch: 5,
        publisherPublicKey: PUBLISHER_PUB,
        signerUserId: 'u_alice',
        signature
      })

      const post = createPostHandler({
        http,
        publisherKeys,
        botIdentityPrivateKey: BOT_SEED
      })

      await post({ text: 'hello' }, { grant: { roomId: unsafeRoomId, mode: 'write_only' } })
      assert.equal(receivedUrl, '/rooms/r_test%2Funsafe/bot-messages')
    } finally {
      server.close()
    }
  })
})
