import http from 'node:http'
import { verify, encodeBotMessagePayload, encodePublisherKeyPayload } from '../runtime/crypto/signing.js'

/**
 * @typedef {object} RecordedRequest
 * @property {string} method - Uppercased HTTP method.
 * @property {string} path - Pathname without query.
 * @property {string} query - Raw query string including leading ? or empty string.
 * @property {Record<string, string | string[] | undefined>} headers - Received HTTP headers.
 * @property {string} body - Raw body string.
 * @property {unknown} [json] - Parsed JSON body if application/json.
 */

/**
 * @typedef {object} StaticResponse
 * @property {number} [status=200] - Status code.
 * @property {Record<string, string>} [headers] - Response headers.
 * @property {unknown} [body] - Response body.
 */

/**
 * @typedef {object} MockResponse
 * @property {(status: number, body?: unknown, headers?: Record<string, string>) => void} send - Sends a response.
 * @property {(status: number, headers: Record<string, string>) => void} writeHead - Writes response headers.
 * @property {(chunk: string) => void} write - Writes a body chunk.
 * @property {() => void} end - Ends the response.
 */

/**
 * @typedef {(req: RecordedRequest, res: MockResponse) => void | Promise<void>} HandlerFn
 */

/**
 * @typedef {object} MockServer
 * @property {() => string} getUrl - Returns base server URL.
 * @property {() => number} getPort - Returns bound port.
 * @property {RecordedRequest[]} requests - Every request received in order.
 * @property {(method: string, path: string, response: StaticResponse | null) => void} setResponse - Sets a static response.
 * @property {(method: string, path: string, handler: HandlerFn | null) => void} setHandler - Sets a custom handler.
 * @property {(path: string, event: { event: string, data: unknown, id?: string }) => void} sseEmit - Emits an SSE event.
 * @property {() => Promise<void>} close - Closes the server.
 */

/**
 * Safely parses a base64url string into a Uint8Array.
 *
 * @param {string} str - The base64url encoded string.
 * @returns {Uint8Array | null} The decoded bytes or null if invalid.
 */
function parseBase64url (str) {
  if (typeof str !== 'string' || str.length === 0 || !/^[A-Za-z0-9_-]+$/.test(str)) {
    return null
  }
  try {
    const buf = Buffer.from(str, 'base64url')
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  } catch {
    return null
  }
}

/**
 * Creates a mock server for the Atoll bot API.
 *
 * @param {object} [options] - Options object.
 * @param {boolean} [options.validateCrypto=false] - Verify signatures and wire lengths when true.
 * @param {string} [options.botId='b_test'] - The bot id reported in metadata.
 * @param {string} [options.ownerUserId='u_test'] - The owner id reported in metadata.
 * @param {Uint8Array} [options.botIdentityPubkey] - 32-byte Ed25519 identity pubkey required when validateCrypto is true.
 * @param {string} [options.sockudoUrl='ws://test'] - Sockudo WebSocket URL for capabilities.
 * @param {string} [options.sockudoAppKey='test-key'] - Sockudo app key for capabilities.
 * @param {string} [options.sockudoAuthEndpoint='/sockudo/auth'] - Sockudo auth endpoint for capabilities.
 * @param {string} [options.host='127.0.0.1'] - Bind host.
 * @param {number} [options.port=0] - Bind port (0 selects ephemeral).
 * @param {(req: RecordedRequest, res: MockResponse) => boolean | Promise<boolean>} [options.onRequest] - Custom request interceptor.
 * @returns {Promise<MockServer>} The started mock server.
 */
export async function createMockServer (options = {}) {
  const {
    validateCrypto = false,
    botId = 'b_test',
    ownerUserId = 'u_test',
    botIdentityPubkey,
    sockudoUrl = 'ws://test',
    sockudoAppKey = 'test-key',
    sockudoAuthEndpoint = '/sockudo/auth',
    host = '127.0.0.1',
    port = 0,
    onRequest
  } = options

  if (validateCrypto) {
    if (!(botIdentityPubkey instanceof Uint8Array) || botIdentityPubkey.length !== 32) {
      throw new TypeError('botIdentityPubkey must be a 32-byte Uint8Array when validateCrypto is true')
    }
  }

  /** @type {RecordedRequest[]} */
  const requests = []
  const staticResponses = new Map()
  const handlers = new Map()
  const sseStreams = new Set()

  let messageCounter = 0
  let commandCounter = 0
  let isClosed = false

  const server = http.createServer(async (nodeReq, nodeRes) => {
    const chunks = []
    for await (const chunk of nodeReq) {
      chunks.push(chunk)
    }
    const rawBody = Buffer.concat(chunks).toString('utf8')

    const hostHeader = nodeReq.headers.host || `${host}:${port}`
    const parsedUrl = new URL(nodeReq.url || '/', `http://${hostHeader}`)
    const path = parsedUrl.pathname
    const query = parsedUrl.search

    const contentTypeHeader = nodeReq.headers['content-type'] || ''
    let json
    if (contentTypeHeader.toLowerCase().includes('application/json') && rawBody.trim().length > 0) {
      try {
        json = JSON.parse(rawBody)
      } catch {
        json = undefined
      }
    }

    const method = (nodeReq.method || 'GET').toUpperCase()

    /** @type {RecordedRequest} */
    const recordedReq = {
      method,
      path,
      query,
      headers: nodeReq.headers,
      body: rawBody,
      json
    }
    requests.push(recordedReq)

    let headersSent = false
    /** @type {MockResponse} */
    const mockRes = {
      send (status, body, extraHeaders = {}) {
        if (headersSent) {
          return
        }
        headersSent = true
        const resHeaders = { ...extraHeaders }
        if (body !== undefined && body !== null && status !== 204) {
          if (typeof body === 'object' || typeof body === 'number' || typeof body === 'boolean') {
            if (!resHeaders['content-type'] && !resHeaders['Content-Type']) {
              resHeaders['Content-Type'] = 'application/json'
            }
            const str = JSON.stringify(body)
            resHeaders['Content-Length'] = String(Buffer.byteLength(str))
            nodeRes.writeHead(status, resHeaders)
            nodeRes.end(str)
            return
          } else {
            const str = String(body)
            resHeaders['Content-Length'] = String(Buffer.byteLength(str))
            nodeRes.writeHead(status, resHeaders)
            nodeRes.end(str)
            return
          }
        }
        nodeRes.writeHead(status, resHeaders)
        nodeRes.end()
      },
      writeHead (status, headers) {
        headersSent = true
        nodeRes.writeHead(status, headers)
      },
      write (chunk) {
        nodeRes.write(chunk)
      },
      end () {
        nodeRes.end()
      }
    }

    /* Check onRequest callback */
    if (typeof onRequest === 'function') {
      const handled = await onRequest(recordedReq, mockRes)
      if (handled === true) {
        return
      }
    }

    const key = `${method} ${path}`

    /* Check setHandler */
    if (handlers.has(key)) {
      const handlerFn = handlers.get(key)
      if (typeof handlerFn === 'function') {
        await handlerFn(recordedReq, mockRes)
        return
      }
    }

    /* Check setResponse */
    if (staticResponses.has(key)) {
      const resSpec = staticResponses.get(key)
      if (resSpec) {
        mockRes.send(resSpec.status ?? 200, resSpec.body, resSpec.headers)
        return
      }
    }

    const isCapabilities = path === '/capabilities'
    const isBotMeta = /^\/api\/v1\/bots\/([^/]+)$/.test(path)
    const isSockudoAuth = path === '/sockudo/auth'
    const isSettings = path === '/api/v1/bots/me/settings'
    const isMessages = path === '/api/v1/bots/me/messages'
    const isAck = /^\/api\/v1\/bots\/me\/commands\/([^/]+)\/ack$/.test(path)
    const isPause = path === '/api/v1/bots/me/pause'
    const isBotMessages = /^\/api\/v1\/rooms\/([^/]+)\/bot-messages$/.test(path)
    const isPublisherKey = /^\/api\/v1\/rooms\/([^/]+)\/publisher-key$/.test(path)
    const isKtUser = /^\/api\/v1\/kt\/user\/([^/]+)$/.test(path)
    const isObserverStream = /^\/api\/v1\/rooms\/([^/]+)\/observer-stream$/.test(path)
    const isBotCommands = /^\/api\/v1\/rooms\/([^/]+)\/bot-commands$/.test(path)

    let allowedMethod = null
    if (isCapabilities || isBotMeta || isSettings || isKtUser || isObserverStream) {
      allowedMethod = 'GET'
    } else if (isSockudoAuth || isMessages || isAck || isPause || isBotMessages || isPublisherKey || isBotCommands) {
      allowedMethod = 'POST'
    }

    if (allowedMethod !== null) {
      if (method !== allowedMethod) {
        return mockRes.send(405, { error: 'method_not_allowed' })
      }
    } else {
      let pathKnown = false
      for (const k of handlers.keys()) {
        if (k.substring(k.indexOf(' ') + 1) === path && typeof handlers.get(k) === 'function') {
          pathKnown = true
          break
        }
      }
      if (!pathKnown) {
        for (const k of staticResponses.keys()) {
          if (k.substring(k.indexOf(' ') + 1) === path && staticResponses.get(k)) {
            pathKnown = true
            break
          }
        }
      }
      if (pathKnown) {
        return mockRes.send(405, { error: 'method_not_allowed' })
      } else {
        return mockRes.send(404, { error: 'not_found' })
      }
    }

    if (isCapabilities) {
      return mockRes.send(200, {
        version: '3.0.2',
        sockudo_url: sockudoUrl,
        sockudo_app_key: sockudoAppKey,
        sockudo_auth_endpoint: sockudoAuthEndpoint,
        calling: false,
        sessions_enabled: false,
        key_transparency_enabled: false,
        key_transparency_auditor_count: 0,
        link_preview_proxy_enabled: false,
        extension_proxy_enabled: false,
        model_hosting_enabled: false,
        safety_number_mode: 'warn',
        moderation_mode: 'messenger',
        edit_window_seconds: 900,
        reactions_per_message: 50,
        sync_event_retention_days: 90,
        threading_enabled: true,
        starred_items_per_user: 10000,
        bots_enabled: true,
        bot_identity_in_kt: true,
        bot_max_per_room: 10,
        bot_max_per_user: 50,
        preferences_max_encrypted_bytes: 131072
      })
    }

    if (isBotMeta) {
      return mockRes.send(200, {
        id: botId,
        owner_user_id: ownerUserId,
        display_name: 'Mock Bot',
        avatar_file_id: null
      })
    }

    if (isSockudoAuth) {
      return mockRes.send(200, {
        auth: `${sockudoAppKey}:mock-signature`
      })
    }

    if (isSettings) {
      return mockRes.send(200, [])
    }

    if (isMessages) {
      messageCounter++
      return mockRes.send(200, { id: 'm_mock_' + messageCounter })
    }

    if (isAck) {
      return mockRes.send(204)
    }

    if (isPause) {
      return mockRes.send(202)
    }

    if (isBotMessages) {
      const match = path.match(/^\/api\/v1\/rooms\/([^/]+)\/bot-messages$/)
      const roomId = match?.[1] ?? ''

      if (validateCrypto) {
        if (!json || typeof json !== 'object') {
          return mockRes.send(400, { error: 'invalid_request' })
        }
        const { epoch, ciphertext, content_type: contentType, signature, request_id: requestId } = json

        if (
          (typeof epoch !== 'number' && typeof epoch !== 'bigint') ||
          epoch < 0 ||
          typeof ciphertext !== 'string' ||
          typeof signature !== 'string' ||
          typeof contentType !== 'string' ||
          typeof requestId !== 'string'
        ) {
          return mockRes.send(400, { error: 'invalid_request' })
        }

        const decodedCiphertext = parseBase64url(ciphertext)
        if (!decodedCiphertext || decodedCiphertext.length < 60) {
          return mockRes.send(400, { error: 'invalid_request' })
        }

        const decodedSignature = parseBase64url(signature)
        if (!decodedSignature || decodedSignature.length !== 64) {
          return mockRes.send(400, { error: 'invalid_request' })
        }

        let signingPayload
        try {
          signingPayload = encodeBotMessagePayload({
            roomId,
            epoch,
            contentType,
            ciphertext: decodedCiphertext
          })
        } catch {
          return mockRes.send(400, { error: 'invalid_request' })
        }

        let isValid = false
        try {
          if (botIdentityPubkey) {
            isValid = verify(decodedSignature, signingPayload, botIdentityPubkey)
          }
        } catch {
          isValid = false
        }

        if (!isValid) {
          return mockRes.send(400, { error: 'signature_invalid' })
        }
      }

      messageCounter++
      return mockRes.send(200, {
        id: 'm_mock_' + messageCounter,
        created_at: new Date().toISOString()
      })
    }

    if (isPublisherKey) {
      const match = path.match(/^\/api\/v1\/rooms\/([^/]+)\/publisher-key$/)
      const roomId = match?.[1] ?? ''

      if (validateCrypto) {
        if (!json || typeof json !== 'object') {
          return mockRes.send(400, { error: 'invalid_request' })
        }
        const { epoch, publisher_public_key: publisherPublicKey, signature } = json

        if (
          (typeof epoch !== 'number' && typeof epoch !== 'bigint') ||
          epoch < 0 ||
          typeof publisherPublicKey !== 'string' ||
          typeof signature !== 'string'
        ) {
          return mockRes.send(400, { error: 'invalid_request' })
        }

        const decodedPubkey = parseBase64url(publisherPublicKey)
        if (!decodedPubkey || decodedPubkey.length !== 32) {
          return mockRes.send(400, { error: 'invalid_request' })
        }

        const decodedSignature = parseBase64url(signature)
        if (!decodedSignature || decodedSignature.length !== 64) {
          return mockRes.send(400, { error: 'invalid_request' })
        }

        let signerIdentityPubkey = null
        for (const [k, v] of staticResponses.entries()) {
          if (k.startsWith('GET /api/v1/kt/user/') && v) {
            if (v.body && v.body.identity_pubkey) {
              const rawKey = v.body.identity_pubkey
              if (rawKey instanceof Uint8Array && rawKey.length === 32) {
                signerIdentityPubkey = rawKey
              } else if (typeof rawKey === 'string') {
                signerIdentityPubkey = parseBase64url(rawKey)
              }
            }
          }
        }

        if (!signerIdentityPubkey || signerIdentityPubkey.length !== 32) {
          return mockRes.send(400, { error: 'kt_missing' })
        }

        let signingPayload
        try {
          signingPayload = encodePublisherKeyPayload({
            roomId,
            epoch,
            publisherPublicKey: decodedPubkey
          })
        } catch {
          return mockRes.send(400, { error: 'invalid_request' })
        }

        let isValid = false
        try {
          isValid = verify(decodedSignature, signingPayload, signerIdentityPubkey)
        } catch {
          isValid = false
        }

        if (!isValid) {
          return mockRes.send(400, { error: 'signature_invalid' })
        }
      }

      return mockRes.send(200, { status: 'ok' })
    }

    if (isKtUser) {
      return mockRes.send(404, { error: 'not_found' })
    }

    if (isObserverStream) {
      nodeRes.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      nodeRes.write('retry: 1000\n\n')

      const streamEntry = {
        res: nodeRes,
        path,
        closed: false
      }
      sseStreams.add(streamEntry)

      const cleanup = () => {
        if (!streamEntry.closed) {
          streamEntry.closed = true
          sseStreams.delete(streamEntry)
        }
      }
      nodeReq.on('close', cleanup)
      nodeReq.on('aborted', cleanup)
      nodeRes.on('close', cleanup)
      nodeRes.on('error', cleanup)
      return
    }

    if (isBotCommands) {
      commandCounter++
      return mockRes.send(200, { command_id: 'cmd_mock_' + commandCounter })
    }

    return mockRes.send(404, { error: 'not_found' })
  })

  await new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      resolve(null)
    })
    server.on('error', reject)
  })

  const boundAddress = server.address()
  const boundPort = typeof boundAddress === 'object' && boundAddress !== null ? boundAddress.port : port

  return {
    getUrl () {
      return `http://${host}:${boundPort}`
    },
    getPort () {
      return boundPort
    },
    requests,
    setResponse (method, path, response) {
      const key = `${method.toUpperCase()} ${path}`
      if (response === null || response === undefined) {
        staticResponses.delete(key)
      } else {
        staticResponses.set(key, response)
      }
    },
    setHandler (method, path, handler) {
      const key = `${method.toUpperCase()} ${path}`
      if (typeof handler !== 'function') {
        handlers.delete(key)
      } else {
        handlers.set(key, handler)
      }
    },
    sseEmit (emitPath, { event, data, id }) {
      for (const stream of sseStreams) {
        if (stream.path === emitPath && !stream.closed) {
          let msg = ''
          if (event) {
            msg += `event: ${event}\n`
          }
          msg += `data: ${JSON.stringify(data)}\n`
          if (id !== undefined && id !== null) {
            msg += `id: ${id}\n`
          }
          msg += '\n'
          try {
            stream.res.write(msg)
          } catch {
            /* ignore stream write error */
          }
        }
      }
    },
    async close () {
      if (isClosed) {
        return
      }
      isClosed = true

      for (const stream of sseStreams) {
        stream.closed = true
        try {
          stream.res.end()
          stream.res.destroy()
        } catch {
          /* ignore */
        }
      }
      sseStreams.clear()

      await new Promise((resolve) => {
        server.close(() => resolve(null))
      })
    }
  }
}
