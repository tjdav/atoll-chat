import crypto from 'node:crypto'
import { createServer as httpCreateServer } from 'node:http'

/**
 * Extracts a normalized header value from request headers.
 *
 * @param {Record<string, string | string[] | undefined>} headers - Headers object.
 * @param {string} name - Header name (case-insensitive).
 * @returns {string | undefined} - Normalized header value string or undefined.
 */
export function extractHeader (headers, name) {
  if (!headers || typeof headers !== 'object') {
    return undefined
  }
  const targetKey = name.toLowerCase()
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === targetKey) {
      if (Array.isArray(val)) {
        return val.join(', ')
      }
      return val
    }
  }
  return undefined
}

/**
 * Verifies a request's signature or bearer token against a secret.
 *
 * @param {object} params - Parameters object.
 * @param {string} params.secretName - The env var name (e.g. `MY_HOOK_SECRET`).
 * @param {string} params.secretValue - The resolved secret value from env.
 * @param {Buffer} params.rawBody - The raw request body buffer.
 * @param {Record<string, string | string[] | undefined>} params.headers - Incoming headers.
 * @returns {{ ok: boolean, message?: string }} - Verification result.
 */
export function verifySignature ({ secretName, secretValue, rawBody, headers }) {
  if (secretName.endsWith('_SECRET')) {
    const sigHeader = extractHeader(headers, 'x-hub-signature-256') ?? extractHeader(headers, 'x-signature-256')
    if (!sigHeader) {
      return {
        ok: false,
        message: 'Missing signature header'
      }
    }

    let hexStr = sigHeader.trim()
    if (hexStr.startsWith('sha256=')) {
      hexStr = hexStr.slice(7)
    }

    if (hexStr.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hexStr)) {
      return {
        ok: false,
        message: 'Malformed signature'
      }
    }

    const received = Buffer.from(hexStr, 'hex')
    const expected = crypto.createHmac('sha256', secretValue).update(rawBody).digest()

    const expectedHash = crypto.createHash('sha256').update(expected).digest()
    const receivedHash = crypto.createHash('sha256').update(received).digest()

    if (!crypto.timingSafeEqual(expectedHash, receivedHash)) {
      return {
        ok: false,
        message: 'Invalid signature'
      }
    }

    return { ok: true }
  }

  if (secretName.endsWith('_TOKEN')) {
    const authHeader = extractHeader(headers, 'authorization')
    if (!authHeader) {
      return {
        ok: false,
        message: 'Missing authorization header'
      }
    }

    const match = /^bearer\s+(.+)$/i.exec(authHeader.trim())
    if (!match || !match[1]) {
      return {
        ok: false,
        message: 'Invalid authorization scheme'
      }
    }

    const extractedToken = match[1].trim()
    const expectedHash = crypto.createHash('sha256').update(secretValue, 'utf8').digest()
    const receivedHash = crypto.createHash('sha256').update(extractedToken, 'utf8').digest()

    if (!crypto.timingSafeEqual(expectedHash, receivedHash)) {
      return {
        ok: false,
        message: 'Invalid token'
      }
    }

    return { ok: true }
  }

  return {
    ok: false,
    message: `Unsupported secret variable suffix '${secretName}'`
  }
}

/**
 * @typedef {object} WebhookInvocation
 * @property {string} path - The matched trigger's path (relative to `basePath`).
 * @property {string} body - The raw request body as a string.
 * @property {Record<string, string>} headers - The request headers, normalized to lowercase keys.
 */

/**
 * @typedef {object} WebhookServer
 * @property {() => Promise<void>} start - Binds and listens. Resolves once the server is accepting connections.
 * @property {() => Promise<void>} stop - Closes the server and waits for in-flight requests to complete.
 * @property {() => number | null} getBoundPort - The bound port, or null when not started. Useful for tests with port 0.
 */

/**
 * Creates the webhook trigger server.
 *
 * @param {object} deps - Factory dependencies.
 * @param {{ host: string, port: number, basePath: string, maxBodyBytes: number, timeoutMs: number }} deps.config - The webhook config block.
 * @param {WebhookTrigger[]} deps.triggers - The webhook triggers array.
 * @param {(invocation: WebhookInvocation) => Promise<BotCtx>} deps.makeBotCtx - Constructs BotCtx.
 * @param {import('../idempotency/index.js').IdempotencyStore} deps.idempotency - Idempotency store.
 * @param {import('../pause-policy.js').PausePolicy} [deps.pausePolicy] - Pause policy guard.
 * @param {import('../shutdown.js').ShutdownTracker} [deps.shutdownTracker] - Shutdown tracker.
 * @param {NodeJS.ProcessEnv} [deps.env=process.env] - Environment.
 * @param {import('../diagnostics/logger.js').Logger} [deps.logger] - Optional logger.
 * @param {(ctx: BotCtx, invocation: WebhookInvocation) => Promise<void> | void} [deps.onWebhook] - Optional direct webhook handler.
 * @returns {WebhookServer} - The server instance.
 */
export function createWebhookServer ({
  config,
  triggers,
  makeBotCtx,
  idempotency,
  pausePolicy,
  shutdownTracker,
  env = process.env,
  logger,
  onWebhook
}) {
  if (!config || typeof config !== 'object') {
    throw new Error('config must be an object')
  }
  if (typeof config.host !== 'string') {
    throw new Error('config.host must be a string')
  }
  if (typeof config.port !== 'number' || !Number.isInteger(config.port) || config.port < 0) {
    throw new Error('config.port must be a non-negative integer')
  }
  if (typeof config.basePath !== 'string') {
    throw new Error('config.basePath must be a string')
  }
  if (typeof config.maxBodyBytes !== 'number' || config.maxBodyBytes < 0) {
    throw new Error('config.maxBodyBytes must be a non-negative number')
  }
  if (typeof config.timeoutMs !== 'number' || config.timeoutMs < 0) {
    throw new Error('config.timeoutMs must be a non-negative number')
  }
  if (!Array.isArray(triggers)) {
    throw new Error('triggers must be an array')
  }
  if (typeof makeBotCtx !== 'function') {
    throw new Error('makeBotCtx must be a function')
  }
  if (!idempotency || typeof idempotency.checkAndRecord !== 'function' || typeof idempotency.remove !== 'function') {
    throw new Error('idempotency store must provide checkAndRecord and remove methods')
  }

  /** @type {WebhookTrigger[]} */
  const webhookTriggers = triggers.filter((t) => t && typeof t === 'object' && t.type === 'webhook')

  /** @type {import('node:http').Server | null} */
  let server = null
  /** @type {Promise<void> | null} */
  let startPromise = null
  /** @type {Promise<void> | null} */
  let stopPromise = null
  let isStarted = false

  /**
   * Handles incoming HTTP requests for webhook triggers.
   *
   * @param {import('node:http').IncomingMessage} req - Incoming request.
   * @param {import('node:http').ServerResponse} res - Server response.
   */
  async function handleRequest (req, res) {
    const rawUrl = req.url ?? '/'
    const fullPath = rawUrl.split('?')[0] ?? '/'
    const reqMethod = req.method ?? 'POST'

    logger?.debug('webhook request received', {
      meta: {
        method: reqMethod,
        path: fullPath
      }
    })

    if (shutdownTracker?.isShuttingDown()) {
      logger?.warn('webhook dispatch skipped: shutting down', { meta: { path: fullPath } })
      respondJson(res, 503, {
        error: 'bot_shutting_down',
        message: 'The bot is shutting down.'
      })
      return
    }

    // Match triggers by path
    const matchingByPath = webhookTriggers.filter((t) => `${config.basePath}${t.path}` === fullPath)
    if (matchingByPath.length === 0) {
      logger?.warn('webhook path not found', { meta: { path: fullPath } })
      respondJson(res, 404, { error: 'not_found' })
      return
    }

    const matchedTrigger = matchingByPath.find((t) => (t.method ?? 'POST') === reqMethod)
    if (!matchedTrigger) {
      logger?.warn('webhook method not allowed', { meta: { path: fullPath } })
      respondJson(res, 405, { error: 'method_not_allowed' })
      return
    }

    // Read body up to maxBodyBytes
    let totalBytes = 0
    /** @type {Buffer[]} */
    const chunks = []
    let tooLarge = false

    try {
      for await (const chunk of req) {
        totalBytes += chunk.length
        if (totalBytes > config.maxBodyBytes) {
          tooLarge = true
          logger?.warn('webhook request body too large', { meta: { path: fullPath } })
          respondJson(res, 413, { error: 'request_too_large' })
          req.destroy()
          return
        }
        chunks.push(chunk)
      }
    } catch (_err) {
      // Stream destroyed or error
    }

    if (tooLarge) {
      return
    }

    const rawBody = Buffer.concat(chunks)
    const bodyString = new TextDecoder('utf-8', { fatal: false }).decode(rawBody)

    // Secret verification
    if (matchedTrigger.secret) {
      const secretName = matchedTrigger.secret
      const secretValue = env[secretName]

      if (secretValue === undefined || secretValue === null) {
        logger?.error('missing secret env var', {
          meta: {
            path: fullPath,
            error: `Environment variable ${secretName} is missing`
          }
        })
        respondJson(res, 500, {
          error: 'internal',
          message: `Environment variable ${secretName} is missing`
        })
        return
      }

      if (!secretName.endsWith('_SECRET') && !secretName.endsWith('_TOKEN')) {
        logger?.error('unsupported secret variable suffix', {
          meta: {
            path: fullPath,
            error: `Unsupported secret variable suffix '${secretName}'`
          }
        })
        respondJson(res, 500, {
          error: 'internal',
          message: `Unsupported secret variable suffix '${secretName}'`
        })
        return
      }

      const verifyRes = verifySignature({
        secretName,
        secretValue,
        rawBody,
        headers: req.headers
      })

      if (!verifyRes.ok) {
        logger?.warn('webhook verification failed', {
          meta: {
            path: fullPath,
            reason: verifyRes.message ?? 'Verification failed'
          }
        })
        respondJson(res, 401, {
          error: 'unauthorized',
          message: verifyRes.message ?? 'Verification failed'
        })
        return
      }
    }

    // Idempotency check
    let idempotencyKey
    if (matchedTrigger.idempotency) {
      const [, headerName] = matchedTrigger.idempotency.split(':', 2)
      if (headerName) {
        const hVal = extractHeader(req.headers, headerName.trim())
        if (hVal && hVal.trim().length > 0) {
          idempotencyKey = hVal.trim()
        }
      }
    }
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID()
    }

    const seen = await idempotency.checkAndRecord(idempotencyKey)
    if (seen) {
      logger?.debug('webhook idempotency hit', { meta: { path: fullPath } })
      respondEmpty(res, 200)
      return
    }

    // Construct BotCtx
    const invocation = {
      path: matchedTrigger.path,
      body: bodyString,
      headers: normalizeHeaders(req.headers)
    }

    let ctx
    try {
      ctx = await makeBotCtx(invocation)
    } catch (err) {
      await idempotency.remove(idempotencyKey)
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger?.error('makeBotCtx failed', {
        meta: {
          path: fullPath,
          error: errorMsg
        }
      })
      respondJson(res, 500, {
        error: 'internal',
        message: errorMsg.slice(0, 200)
      })
      return
    }

    // Handler dispatch
    /** @type {any} */
    const ctxUntyped = ctx
    const handlerFn = onWebhook ?? ctxUntyped.webhook ?? ctxUntyped.handlers?.webhook ?? ctxUntyped.config?.handlers?.webhook

    const runHandler = () => (typeof handlerFn === 'function'
      ? withTimeout(
        Promise.resolve().then(() => handlerFn(ctx, invocation)),
        config.timeoutMs
      )
      : Promise.resolve())

    const startTime = Date.now()
    if (pausePolicy?.isPaused()) {
      logger?.warn('webhook dispatch skipped: bot paused', { meta: { path: fullPath } })
      respondJson(res, 503, {
        error: 'bot_paused',
        message: 'The bot is paused.'
      })
      return
    }

    if (pausePolicy) {
      const executeWithTrack = () => (shutdownTracker
        ? shutdownTracker.track(runHandler)
        : runHandler())

      const guardResult = await pausePolicy.guard(executeWithTrack)

      if (guardResult.kind === 'paused') {
        logger?.warn('webhook dispatch skipped: bot paused', { meta: { path: fullPath } })
        respondJson(res, 503, {
          error: 'bot_paused',
          message: 'The bot is paused.'
        })
        return
      }

      if (guardResult.kind === 'failure') {
        await idempotency.remove(idempotencyKey)
        /** @type {any} */
        const errObj = guardResult.error
        const errorMsg = errObj instanceof Error ? errObj.message : String(errObj)

        if (errObj && errObj.isTimeout) {
          logger?.error('webhook handler timeout', {
            meta: {
              path: fullPath,
              error: errorMsg
            }
          })
          respondJson(res, 504, { error: 'handler_timeout' })
        } else {
          logger?.error('webhook handler failed', {
            meta: {
              path: fullPath,
              error: errorMsg
            }
          })
          respondJson(res, 500, {
            error: 'handler_failed',
            message: errorMsg.slice(0, 200)
          })
        }
        return
      }

      const durationMs = Date.now() - startTime
      logger?.debug('webhook dispatch success', {
        meta: {
          path: fullPath,
          duration_ms: durationMs
        }
      })
      respondEmpty(res, 200)
    } else {
      try {
        if (shutdownTracker) {
          await shutdownTracker.track(runHandler)
        } else {
          await runHandler()
        }
        const durationMs = Date.now() - startTime
        logger?.debug('webhook dispatch success', {
          meta: {
            path: fullPath,
            duration_ms: durationMs
          }
        })
        respondEmpty(res, 200)
      } catch (err) {
        await idempotency.remove(idempotencyKey)
        /** @type {any} */
        const errObj = err
        const errorMsg = err instanceof Error ? err.message : String(err)

        if (errObj && errObj.isTimeout) {
          logger?.error('webhook handler timeout', {
            meta: {
              path: fullPath,
              error: errorMsg
            }
          })
          respondJson(res, 504, { error: 'handler_timeout' })
        } else {
          logger?.error('webhook handler failed', {
            meta: {
              path: fullPath,
              error: errorMsg
            }
          })
          respondJson(res, 500, {
            error: 'handler_failed',
            message: errorMsg.slice(0, 200)
          })
        }
      }
    }
  }

  return {
    async start () {
      if (webhookTriggers.length === 0) {
        return
      }
      if (startPromise) {
        return startPromise
      }

      startPromise = new Promise((resolve, reject) => {
        const s = httpCreateServer((req, res) => {
          handleRequest(req, res).catch((err) => {
            logger?.error('unhandled webhook request error', {
              meta: { error: err instanceof Error ? err.message : String(err) }
            })
            if (!res.headersSent) {
              respondJson(res, 500, {
                error: 'internal',
                message: 'Internal server error'
              })
            }
          })
        })

        s.once('error', (err) => {
          startPromise = null
          reject(err)
        })

        s.listen(config.port, config.host, () => {
          server = s
          isStarted = true
          resolve()
        })
      })

      return startPromise
    },

    async stop () {
      if (!isStarted || !server) {
        return
      }
      if (stopPromise) {
        return stopPromise
      }

      const activeServer = server
      stopPromise = new Promise((resolve, reject) => {
        activeServer.close((err) => {
          if (err) {
            stopPromise = null
            reject(err)
          } else {
            isStarted = false
            server = null
            stopPromise = null
            startPromise = null
            resolve()
          }
        })
      })

      return stopPromise
    },

    getBoundPort () {
      if (!isStarted || !server) {
        return null
      }
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        return addr.port
      }
      return null
    }
  }
}

/**
 * Normalizes HTTP headers into lowercased string-only key/value map.
 *
 * @param {import('node:http').IncomingHttpHeaders} rawHeaders - Raw headers.
 * @returns {Record<string, string>} - Normalized headers.
 */
function normalizeHeaders (rawHeaders) {
  /** @type {Record<string, string>} */
  const normalized = {}
  for (const [key, val] of Object.entries(rawHeaders)) {
    if (val === undefined) {
      continue
    }
    const lowerKey = key.toLowerCase()
    if (Array.isArray(val)) {
      normalized[lowerKey] = val.join(', ')
    } else {
      normalized[lowerKey] = val
    }
  }
  return normalized
}

/**
 * Sends a JSON response envelope.
 *
 * @param {import('node:http').ServerResponse} res - Response.
 * @param {number} statusCode - Status code.
 * @param {object} bodyObj - Envelope object.
 */
function respondJson (res, statusCode, bodyObj) {
  if (res.headersSent) {
    return
  }
  const json = JSON.stringify(bodyObj)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json)
  })
  res.end(json)
}

/**
 * Sends an empty response.
 *
 * @param {import('node:http').ServerResponse} res - Response.
 * @param {number} [statusCode=200] - Status code.
 */
function respondEmpty (res, statusCode = 200) {
  if (res.headersSent) {
    return
  }
  res.writeHead(statusCode)
  res.end()
}

/**
 * Wraps a promise with a timeout deadline.
 *
 * @template T
 * @param {Promise<T>} promise - The promise.
 * @param {number} ms - Deadline in ms.
 * @returns {Promise<T>} - Promise result.
 */
function withTimeout (promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`handler timed out after ${ms}ms`)
      /** @type {any} */
      const errorObj = err
      errorObj.isTimeout = true
      reject(err)
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}
