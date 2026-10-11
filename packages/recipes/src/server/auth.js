// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Returns the SHA-256 hash of a string as a Buffer. Used to compare
 * tokens in constant time regardless of their length.
 * @param {string} value - The value to hash.
 * @returns {Buffer} The hash.
 */
function sha256 (value) {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Returns true when two strings are equal. Comparison is performed
 * on hashes so different lengths do not throw and the runtime does
 * not short-circuit on length differences.
 * @param {string} a - The first string.
 * @param {string} b - The second string.
 * @returns {boolean} True when equal.
 */
function safeEqual (a, b) {
  const hashA = sha256(a)
  const hashB = sha256(b)
  return timingSafeEqual(hashA, hashB)
}

/**
 * Extracts the token from an Authorization header value. Returns
 * null when the header is missing, not a Bearer scheme, or has an
 * empty token.
 * @param {string | undefined} header - The header value.
 * @returns {string | null} The token, or null when malformed.
 */
function extractToken (header) {
  if (typeof header !== 'string' || header.length === 0) {
    return null
  }
  const trimmed = header.trim()
  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex <= 0) {
    return null
  }
  const scheme = trimmed.slice(0, spaceIndex).toLowerCase()
  if (scheme !== 'bearer') {
    return null
  }
  const token = trimmed.slice(spaceIndex + 1).trim()
  if (token.length === 0) {
    return null
  }
  return token
}

/**
 * Creates an authenticator that validates tokens against a fixed
 * set. The set is copied at construction; later mutations of the
 * array do not affect the authenticator.
 * @param {object} config - The authenticator configuration.
 * @param {string[]} config.tokens - The known tokens.
 * @returns {Authenticator} The authenticator.
 * @throws {Error} When the configuration is malformed.
 */
export function createTokenAuthenticator (config) {
  if (config === null || typeof config !== 'object') {
    throw new Error('createTokenAuthenticator: config must be an object')
  }
  if (!Array.isArray(config.tokens)) {
    throw new Error('createTokenAuthenticator: config.tokens must be an array')
  }
  for (const token of config.tokens) {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('createTokenAuthenticator: every token must be a non-empty string')
    }
  }

  const tokens = [...config.tokens]

  return {
    async authenticate (ctx) {
      const header = ctx.headers.authorization
      if (header === undefined) {
        return { valid: false, reason: 'Missing token' }
      }
      const token = extractToken(header)
      if (token === null) {
        return { valid: false, reason: 'Malformed Authorization header' }
      }
      for (const known of tokens) {
        if (safeEqual(token, known)) {
          return { valid: true }
        }
      }
      return { valid: false, reason: 'Invalid token' }
    }
  }
}

/**
 * Wraps a route handler so the authenticator runs before it. When
 * the path is exempt, the handler runs directly. When auth fails,
 * a 401 is written and the handler is not called.
 * @param {Function} handler - The original handler.
 * @param {Authenticator} authenticator - The authenticator.
 * @param {Set<string>} exemptPaths - Paths that bypass auth.
 * @returns {Function} The wrapped handler.
 */
function wrapHandler (handler, authenticator, exemptPaths) {
  return async (ctx) => {
    if (exemptPaths.has(ctx.path)) {
      return handler(ctx)
    }
    const result = await authenticator.authenticate(ctx)
    if (!result.valid) {
      ctx.error(401, 'unauthorized', result.reason ?? 'Unauthorized')
      return
    }
    return handler(ctx)
  }
}

/**
 * Creates a server-shaped wrapper around an existing server. Routes
 * registered through the wrapper have their handlers wrapped with
 * the authenticator. Every other method (`listen`, `close`,
 * `address`) is passed through unchanged.
 *
 * The wrapper does not mutate the underlying server. A route
 * registered on the wrapper is registered on the underlying server
 * exactly once, with the wrapped handler.
 * @param {object} server - The server created by `createServer`.
 * @param {object} deps - The wrapper's dependencies.
 * @param {Authenticator} deps.authenticator - The authenticator.
 * @param {string[]} [deps.exemptPaths] - Paths that bypass auth.
 * @returns {object} A server-shaped object.
 * @throws {Error} When server or deps are malformed.
 */
export function createAuthedServer (server, deps) {
  if (server === null || typeof server !== 'object') {
    throw new Error('createAuthedServer: server must be an object')
  }
  if (typeof server.addRoute !== 'function') {
    throw new Error('createAuthedServer: server.addRoute must be a function')
  }
  if (deps === null || typeof deps !== 'object') {
    throw new Error('createAuthedServer: deps must be an object')
  }
  if (deps.authenticator === null || typeof deps.authenticator !== 'object') {
    throw new Error('createAuthedServer: deps.authenticator must be an object')
  }
  if (typeof deps.authenticator.authenticate !== 'function') {
    throw new Error('createAuthedServer: deps.authenticator.authenticate must be a function')
  }
  const exemptPathsList = deps.exemptPaths === undefined ? [] : deps.exemptPaths
  if (!Array.isArray(exemptPathsList)) {
    throw new Error('createAuthedServer: deps.exemptPaths must be an array when provided')
  }
  for (const path of exemptPathsList) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('createAuthedServer: every exempt path must be a non-empty string')
    }
  }

  const { authenticator } = deps
  const exemptPaths = new Set(exemptPathsList)

  return {
    addRoute (method, pattern, handler) {
      server.addRoute(method, pattern, wrapHandler(handler, authenticator, exemptPaths))
    },
    listen (port, host) {
      return server.listen(port, host)
    },
    close () {
      return server.close()
    },
    address () {
      return server.address()
    }
  }
}
