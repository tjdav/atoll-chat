// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer as createNodeServer } from 'node:http'

import { createRouter } from './router.js'

const DEFAULT_BODY_LIMIT = 1024 * 1024

/**
 * Reads the request body into a UTF-8 string. Rejects when the body
 * exceeds the byte limit.
 * @param {object} req - The Node request.
 * @param {number} limit - The byte limit.
 * @returns {Promise<string>} The body as a string.
 * @throws {Error} When the body exceeds the limit.
 */
function readBody (req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let settled = false

    req.on('data', (chunk) => {
      if (settled) {
        return
      }
      total += chunk.length
      if (total > limit) {
        settled = true
        reject(new Error('request body exceeds limit'))
        req.pause()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (settled) {
        return
      }
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })

    req.on('error', (err) => {
      if (settled) {
        return
      }
      settled = true
      reject(err)
    })
  })
}

/**
 * Returns true when the content type indicates JSON.
 * @param {string | undefined} contentType - The content-type header.
 * @returns {boolean} True when JSON.
 */
function isJsonContentType (contentType) {
  if (typeof contentType !== 'string') {
    return false
  }
  return contentType.toLowerCase().includes('application/json')
}

/**
 * Builds the request context passed to handlers.
 * @param {object} req - The Node request.
 * @param {object} res - The Node response.
 * @param {Record<string, string>} params - Captured path params.
 * @param {string} bodyText - The raw body text.
 * @returns {object} The handler context.
 */
function buildContext (req, res, params, bodyText) {
  const url = new URL(req.url, 'http://localhost')
  const query = Object.fromEntries(url.searchParams)
  const headers = {}
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }

  let body
  if (isJsonContentType(headers['content-type']) && bodyText.length > 0) {
    body = JSON.parse(bodyText)
  }

  let written = false

  /**
   * Writes a JSON response.
   * @param {number} status - The HTTP status.
   * @param {unknown} data - The response body.
   * @returns {void}
   */
  function json (status, data) {
    if (written) {
      return
    }
    written = true
    const payload = JSON.stringify(data)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload)
    })
    res.end(payload)
  }

  return {
    method: req.method,
    path: url.pathname,
    params,
    query,
    headers,
    body,
    get responded () {
      return written
    },
    json,
    /**
     * Writes the standard error shape.
     * @param {number} status - The HTTP status.
     * @param {string} code - The machine-readable error code.
     * @param {string} message - The human-readable message.
     * @param {object} [details] - Optional additional details.
     * @returns {void}
     */
    error (status, code, message, details) {
      json(status, { error: code, message, details: details ?? {} })
    },
    /**
     * Writes a plain text response.
     * @param {number} status - The HTTP status.
     * @param {string} text - The response body.
     * @returns {void}
     */
    text (status, text) {
      if (written) {
        return
      }
      written = true
      res.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(text)
      })
      res.end(text)
    }
  }
}

/**
 * Creates the HTTP server. Routes are registered via `addRoute` and
 * handled once `listen` is called.
 * @param {object} [options] - Server options.
 * @param {number} [options.bodyLimit] - The body byte limit.
 *   Defaults to 1 MB.
 * @returns {object} The server object.
 */
export function createServer (options) {
  const opts = options === undefined ? {} : options
  const bodyLimit = opts.bodyLimit === undefined ? DEFAULT_BODY_LIMIT : opts.bodyLimit

  if (typeof bodyLimit !== 'number' || !Number.isInteger(bodyLimit) || bodyLimit <= 0) {
    throw new Error('createServer: options.bodyLimit must be a positive integer')
  }

  const router = createRouter()
  let httpServer = null
  let boundPort = null
  let boundHost = null

  /**
   * Handles one request.
   * @param {object} req - The Node request.
   * @param {object} res - The Node response.
   * @returns {Promise<void>} Resolves when the response is complete.
   */
  async function handle (req, res) {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname

    let bodyText = ''
    try {
      bodyText = await readBody(req, bodyLimit)
    } catch (err) {
      const payload = JSON.stringify({
        error: 'payload_too_large',
        message: 'Request body exceeds the size limit',
        details: {}
      })
      res.writeHead(413, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload)
      })
      res.end(payload)
      return
    }

    const match = router.match(req.method, path)
    if (match === null) {
      const methods = router.methodsFor(path)
      const ctx = buildContext(req, res, {}, bodyText)
      if (methods.length === 0) {
        ctx.error(404, 'not_found', 'Not found')
      } else {
        res.setHeader('allow', methods.join(', '))
        ctx.error(405, 'method_not_allowed', 'Method not allowed')
      }
      return
    }

    const ctx = buildContext(req, res, match.params, bodyText)

    try {
      await match.handler(ctx)
      if (!ctx.responded) {
        ctx.error(500, 'internal_error', 'Handler did not write a response')
      }
    } catch (err) {
      if (!ctx.responded) {
        ctx.error(500, 'internal_error', 'Internal server error')
      } else {
        process.stderr.write(`server: handler error after response: ${err.message}\n`)
      }
    }
  }

  return {
    /**
     * Registers a route.
     * @param {string} method - The HTTP method.
     * @param {string} pattern - The path pattern.
     * @param {Function} handler - The handler.
     * @returns {void}
     */
    addRoute (method, pattern, handler) {
      router.add(method, pattern, handler)
    },

    /**
     * Starts listening. Resolves once the server is bound.
     * @param {number} port - The port. Use 0 for an ephemeral port.
     * @param {string} [host] - The host. Defaults to '127.0.0.1'.
     * @returns {Promise<{ port: number, host: string }>} The bound
     *   address.
     */
    async listen (port, host) {
      if (httpServer !== null) {
        throw new Error('listen: server is already listening')
      }
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 0) {
        throw new Error('listen: port must be a non-negative integer')
      }
      const bindHost = host === undefined ? '127.0.0.1' : host

      const server = createNodeServer((req, res) => {
        handle(req, res).catch((err) => {
          process.stderr.write(`server: unhandled: ${err.message}\n`)
          if (!res.writableEnded) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({
              error: 'internal_error',
              message: 'Internal server error',
              details: {}
            }))
          }
        })
      })

      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, bindHost, () => {
          server.removeListener('error', reject)
          resolve()
        })
      })

      httpServer = server
      const address = server.address()
      boundPort = address.port
      boundHost = address.address

      return { port: boundPort, host: boundHost }
    },

    /**
     * Stops the server. Resolves when all connections are closed.
     * @returns {Promise<void>} Resolves on completion.
     */
    async close () {
      if (httpServer === null) {
        return
      }
      const server = httpServer
      httpServer = null
      boundPort = null
      boundHost = null
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },

    /**
     * Returns the bound address, or null when not listening.
     * @returns {{ port: number, host: string } | null} The address.
     */
    address () {
      if (boundPort === null) {
        return null
      }
      return { port: boundPort, host: boundHost }
    }
  }
}
