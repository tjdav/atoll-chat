// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Extracts the bearer token from an Authorization header value.
 * Returns null when the header is missing or malformed.
 * @param {string | undefined} header - The header value.
 * @returns {string | null} The token, or null.
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
  return token.length === 0 ? null : token
}

/**
 * Creates a fixed-window rate limiter. Each key gets its own bucket,
 * and each bucket holds a count and a window start time.
 *
 * The limiter holds state in memory only. It does not persist, sync
 * across processes, or coordinate with other limiters.
 * @param {object} config - The limiter configuration.
 * @param {number} config.windowMs - The window duration in
 *   milliseconds.
 * @param {number} config.max - The maximum requests allowed per
 *   window.
 * @param {() => number} [config.now] - A function returning the
 *   current time in milliseconds. Defaults to Date.now.
 * @returns {RateLimiter} The limiter.
 * @throws {Error} When the configuration is malformed.
 */
export function createRateLimiter (config) {
  if (config === null || typeof config !== 'object') {
    throw new Error('createRateLimiter: config must be an object')
  }
  const { windowMs, max } = config
  const now = config.now === undefined ? Date.now : config.now

  if (typeof windowMs !== 'number' || !Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error('createRateLimiter: config.windowMs must be a positive integer')
  }
  if (typeof max !== 'number' || !Number.isInteger(max) || max <= 0) {
    throw new Error('createRateLimiter: config.max must be a positive integer')
  }
  if (typeof now !== 'function') {
    throw new Error('createRateLimiter: config.now must be a function when provided')
  }

  const buckets = new Map()
  let lastSweep = now()

  /**
   * Removes buckets whose window has expired relative to the given
   * time.
   * @param {number} time - The current time in milliseconds.
   * @returns {void}
   */
  function sweepAt (time) {
    for (const [key, bucket] of buckets) {
      if (time - bucket.start >= windowMs) {
        buckets.delete(key)
      }
    }
  }

  return {
    check (key) {
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('rateLimiter.check: key must be a non-empty string')
      }
      const time = now()

      if (time - lastSweep >= windowMs) {
        sweepAt(time)
        lastSweep = time
      }

      let bucket = buckets.get(key)
      if (bucket === undefined || time - bucket.start >= windowMs) {
        bucket = { start: time, count: 0 }
        buckets.set(key, bucket)
      }

      if (bucket.count >= max) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: bucket.start + windowMs - time
        }
      }

      bucket.count += 1
      return {
        allowed: true,
        remaining: max - bucket.count,
        retryAfterMs: 0
      }
    },

    size () {
      return buckets.size
    },

    clear () {
      buckets.clear()
    },

    sweep () {
      sweepAt(now())
      lastSweep = now()
    }
  }
}

/**
 * Returns the default key extractor. Uses the bearer token when
 * present and well-formed; falls back to a shared anonymous bucket
 * otherwise.
 * @param {object} ctx - The handler context.
 * @returns {string} The rate-limit key.
 */
function defaultKeyExtractor (ctx) {
  const header = ctx.headers.authorization
  const token = extractToken(header)
  return token === null ? 'anonymous' : token
}

/**
 * Wraps a route handler with a rate-limit check.
 * @param {Function} handler - The original handler.
 * @param {RateLimiter} limiter - The limiter.
 * @param {Function} keyExtractor - The key extractor.
 * @returns {Function} The wrapped handler.
 */
function wrapHandler (handler, limiter, keyExtractor) {
  return async (ctx) => {
    const key = keyExtractor(ctx)
    const decision = limiter.check(key)

    if (!decision.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
      ctx.setResponseHeader('retry-after', String(retryAfterSeconds))
      ctx.error(429, 'rate_limited', 'Too many requests')
      return
    }

    return handler(ctx)
  }
}

/**
 * Creates a server-shaped wrapper that rate-limits every route
 * registered through it. Every other method (`listen`, `close`,
 * `address`) is passed through unchanged.
 *
 * The wrapper does not mutate the underlying server. A route
 * registered on the wrapper is registered on the underlying server
 * exactly once, with the wrapped handler.
 * @param {object} server - The server created by `createServer`.
 * @param {object} deps - The wrapper's dependencies.
 * @param {RateLimiter} deps.limiter - The limiter.
 * @param {(ctx: object) => string} [deps.keyExtractor] - The key
 *   extractor. Defaults to the bearer-token extractor.
 * @returns {object} A server-shaped object.
 * @throws {Error} When server or deps are malformed.
 */
export function createRateLimitedServer (server, deps) {
  if (server === null || typeof server !== 'object') {
    throw new Error('createRateLimitedServer: server must be an object')
  }
  if (typeof server.addRoute !== 'function') {
    throw new Error('createRateLimitedServer: server.addRoute must be a function')
  }
  if (deps === null || typeof deps !== 'object') {
    throw new Error('createRateLimitedServer: deps must be an object')
  }
  if (deps.limiter === null || typeof deps.limiter !== 'object') {
    throw new Error('createRateLimitedServer: deps.limiter must be an object')
  }
  if (typeof deps.limiter.check !== 'function') {
    throw new Error('createRateLimitedServer: deps.limiter.check must be a function')
  }
  const keyExtractor = deps.keyExtractor === undefined ? defaultKeyExtractor : deps.keyExtractor
  if (typeof keyExtractor !== 'function') {
    throw new Error('createRateLimitedServer: deps.keyExtractor must be a function when provided')
  }

  const { limiter } = deps

  return {
    addRoute (method, pattern, handler) {
      server.addRoute(method, pattern, wrapHandler(handler, limiter, keyExtractor))
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
