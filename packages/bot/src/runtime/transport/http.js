import { HttpRequestError } from '../../errors.js'

/**
 * Parses a Retry-After header value into milliseconds.
 *
 * @param {string | null} headerValue - The header string value.
 * @returns {number | null} - Delay in milliseconds or null if unparseable.
 */
function parseRetryAfter (headerValue) {
  if (!headerValue) {
    return null
  }
  const seconds = Number(headerValue)
  if (Number.isInteger(seconds) && seconds >= 0) {
    return seconds * 1000
  }
  const dateMs = Date.parse(headerValue)
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now()
    return diff > 0 ? diff : 0
  }
  return null
}

/**
 * Checks if a value is a plain object or array for JSON serialization.
 *
 * @param {unknown} val - Value to check.
 * @returns {boolean} - True if plain object or array.
 */
function isPlainObjectOrArray (val) {
  if (val === null || typeof val !== 'object') {
    return false
  }
  if (Array.isArray(val)) {
    return true
  }
  return Object.prototype.toString.call(val) === '[object Object]'
}

/**
 * Creates an HTTP client for the bot-facing server API.
 *
 * @param {object} options - Configuration options.
 * @param {string} options.serverUrl - Base URL of the server, without a trailing slash.
 * @param {string} options.botToken - The bot's authentication token.
 * @param {number} [options.defaultTimeoutMs=30000] - Per-attempt timeout.
 * @param {number[]} [options.backoffMs=[2000, 5000, 15000]] - Delay between retry attempts.
 * @param {string} [options.userAgent='AtollBot/1.0'] - The User-Agent header value.
 * @param {import('../diagnostics/logger.js').Logger} [options.logger] - Optional logger for retry diagnostics.
 * @param {typeof globalThis.fetch} [options.fetchImpl=globalThis.fetch] - The fetch implementation.
 * @param {number} [options.maxRetryAfterMs=60000] - Maximum Retry-After delay in milliseconds (for testing).
 * @returns {HttpClient} - The client.
 */
export function createHttpClient ({
  serverUrl,
  botToken,
  defaultTimeoutMs = 30000,
  backoffMs = [2000, 5000, 15000],
  userAgent = 'AtollBot/1.0',
  logger,
  fetchImpl = globalThis.fetch,
  maxRetryAfterMs = 60000
}) {
  if (typeof serverUrl !== 'string' || serverUrl.trim() === '') {
    throw new Error('serverUrl must be a non-empty string')
  }
  let parsedUrl
  try {
    parsedUrl = new URL(serverUrl)
  } catch {
    throw new Error('serverUrl must be a valid absolute URL')
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('serverUrl scheme must be http: or https:')
  }
  if (typeof botToken !== 'string' || botToken.trim() === '') {
    throw new Error('botToken must be a non-empty string')
  }

  const cleanServerUrl = serverUrl.replace(/\/+$/, '')

  return {
    async request (method, path, opts = {}) {
      if (typeof path !== 'string') {
        throw new Error('path must be a string')
      }
      if (path.startsWith('http://') || path.startsWith('https://')) {
        throw new Error('path must not be an absolute URL')
      }
      if (!path.startsWith('/')) {
        throw new Error('path must begin with "/"')
      }

      const uppercaseMethod = method.toUpperCase()
      const url = cleanServerUrl + path

      /** @type {Record<string, string>} */
      const reqHeaders = {
        'User-Agent': userAgent,
        Accept: 'application/json'
      }

      if (isPlainObjectOrArray(opts.body)) {
        reqHeaders['Content-Type'] = 'application/json'
      }

      if (opts.headers && typeof opts.headers === 'object') {
        for (const [k, v] of Object.entries(opts.headers)) {
          if (k.toLowerCase() !== 'authorization') {
            reqHeaders[k] = String(v)
          }
        }
      }

      // Authorization header is forced and not overrideable
      reqHeaders['Authorization'] = `Bearer ${botToken}`

      // Serialize body
      /** @type {any} */
      let serializedBody = null
      if (isPlainObjectOrArray(opts.body)) {
        serializedBody = JSON.stringify(opts.body)
      } else if (typeof opts.body === 'string') {
        serializedBody = opts.body
      } else if (opts.body instanceof Uint8Array) {
        serializedBody = opts.body
      }

      const maxAttempts = backoffMs.length + 1
      let lastStatus = 0
      let lastBody = null
      let lastResponseErrorCode = null
      let lastCause = null

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs
        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          controller.abort(new Error(`Request timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        let res
        try {
          res = await fetchImpl(url, {
            method: uppercaseMethod,
            headers: reqHeaders,
            body: serializedBody,
            signal: controller.signal
          })
        } catch (fetchErr) {
          lastStatus = 0
          lastBody = null
          lastResponseErrorCode = null
          lastCause = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr))

          const canRetry = opts.retry === true && attempt < maxAttempts
          if (canRetry) {
            if (logger) {
              const cleanPath = path.split('?')[0] ?? path
              logger.debug('http retry', {
                method: uppercaseMethod,
                path: cleanPath,
                status: 0,
                attempt
              })
            }
            const delay = backoffMs[attempt - 1] ?? 0
            await new Promise((r) => setTimeout(r, delay))
            continue
          }

          break
        } finally {
          clearTimeout(timeoutId)
        }

        // Process response
        lastStatus = res.status
        /** @type {Record<string, string>} */
        const responseHeaders = {}
        if (res.headers && typeof res.headers.entries === 'function') {
          for (const [k, v] of res.headers.entries()) {
            responseHeaders[k] = v
          }
        }

        const contentType = res.headers ? res.headers.get('content-type') : null
        const contentLength = res.headers ? res.headers.get('content-length') : null

        if (res.status === 204 || contentLength === '0') {
          lastBody = null
        } else if (contentType && contentType.includes('application/json')) {
          try {
            const text = await res.text()
            lastBody = text.trim() === '' ? null : JSON.parse(text)
          } catch {
            lastBody = null
          }
        } else {
          const text = await res.text()
          lastBody = text === '' ? null : text
        }

        if (lastBody && typeof lastBody === 'object' && typeof lastBody.error === 'string') {
          lastResponseErrorCode = lastBody.error
        } else {
          lastResponseErrorCode = null
        }

        if (res.ok) {
          return {
            status: res.status,
            headers: responseHeaders,
            body: lastBody
          }
        }

        // Non-2xx response
        const is429 = res.status === 429
        const is5xx = res.status >= 500
        const canRetry = (is429 || (is5xx && opts.retry === true)) && attempt < maxAttempts

        if (canRetry) {
          if (logger) {
            const cleanPath = path.split('?')[0] ?? path
            logger.debug('http retry', {
              method: uppercaseMethod,
              path: cleanPath,
              status: res.status,
              attempt
            })
          }

          let delay = backoffMs[attempt - 1] ?? 0
          if (is429) {
            const retryAfterHeader = res.headers ? res.headers.get('retry-after') : null
            const parsedRetryAfterMs = parseRetryAfter(retryAfterHeader)
            if (parsedRetryAfterMs !== null) {
              delay = Math.min(parsedRetryAfterMs, maxRetryAfterMs)
            }
          }

          await new Promise((r) => setTimeout(r, delay))
          continue
        }

        break
      }

      const err = new HttpRequestError(
        `HTTP request failed (${uppercaseMethod} ${path}): status ${lastStatus}`,
        lastCause ? { cause: lastCause } : undefined
      )
      Object.assign(err, {
        status: lastStatus,
        url,
        method: uppercaseMethod,
        body: lastBody,
        responseErrorCode: lastResponseErrorCode
      })
      throw err
    }
  }
}

/**
 * @typedef {object} HttpClient
 * @property {(method: string, path: string, opts?: RequestOptions) => Promise<Response>} request - Sends a request.
 */

/**
 * @typedef {object} RequestOptions
 * @property {unknown} [body] - Request body.
 * @property {Record<string, string>} [headers] - Additional headers.
 * @property {boolean} [retry=false] - Retry on 5xx and network failures.
 * @property {number} [timeoutMs] - Per-attempt timeout override.
 */

/**
 * @typedef {object} Response
 * @property {number} status - The HTTP status code.
 * @property {Record<string, string>} headers - Response headers.
 * @property {unknown} body - Parsed response body.
 */
