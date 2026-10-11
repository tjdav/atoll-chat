// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto'

/**
 * Reads the consent tier from the request headers. Returns 0 for a
 * missing, malformed, or unknown header value.
 * @param {object} ctx - The handler context.
 * @returns {0 | 1 | 2} The consent tier.
 */
function readTier (ctx) {
  const header = ctx.headers['x-consent-tier']
  if (typeof header !== 'string') {
    return 0
  }
  const trimmed = header.trim()
  if (trimmed === '1') return 1
  if (trimmed === '2') return 2
  return 0
}

/**
 * Extracts the intent text from a match request body. Returns null
 * when the body does not carry a string intent.
 * @param {unknown} body - The parsed request body.
 * @returns {string | null} The intent, or null.
 */
function readIntent (body) {
  if (body === null || typeof body !== 'object') {
    return null
  }
  const intent = body.intent
  if (typeof intent !== 'string' || intent.length === 0) {
    return null
  }
  return intent
}

/**
 * Extracts the candidate list from a MatchResult. Every match kind
 * carries a list of candidates; the field name varies.
 * @param {object} result - The MatchResult.
 * @returns {Candidate[]} The candidate list.
 */
function extractCandidates (result) {
  if (result.kind === 'match') return result.candidates
  if (result.kind === 'ambiguous') return result.candidates
  if (result.kind === 'refusal') return result.suggestions
  return []
}

/**
 * Builds the full telemetry record from the intent, the match
 * result, and the engine metadata.
 * @param {object} args - The record inputs.
 * @param {string} args.intent - The intent text.
 * @param {object} args.result - The MatchResult.
 * @param {string} args.requestId - The request identifier.
 * @param {string} args.engineVersion - The engine version.
 * @param {string} args.createdAt - ISO 8601 timestamp.
 * @returns {TelemetryRecord} The record.
 */
function buildRecord (args) {
  const { intent, result, requestId, engineVersion, createdAt } = args
  const record = {
    requestId,
    intentText: intent,
    matchKind: result.kind,
    candidates: extractCandidates(result),
    engineVersion,
    createdAt
  }
  if (result.kind === 'match') {
    record.matchedRecipe = result.recipeId
    record.matchConfidence = result.confidence
  }
  return record
}

/**
 * Filters a record by consent tier. Returns null when the record
 * must not be persisted.
 * @param {TelemetryRecord} record - The full record.
 * @param {0 | 1 | 2} tier - The consent tier.
 * @returns {TelemetryRecord | null} The filtered record, or null.
 */
function filterByTier (record, tier) {
  if (tier === 0) {
    return null
  }
  if (tier === 2) {
    return record
  }
  const { intentText, ...withoutIntent } = record
  return withoutIntent
}

/**
 * Creates the telemetry middleware. The middleware captures the
 * intent and match result for a handler that produces a 200 with a
 * MatchResult body, and forwards a filtered record to the sink.
 * @param {object} config - The middleware configuration.
 * @param {TelemetrySink} config.sink - The sink.
 * @param {string} config.engineVersion - The engine version.
 * @param {() => string} [config.requestId] - A request-id generator.
 *   Defaults to `crypto.randomUUID`.
 * @param {() => number} [config.now] - A timestamp source.
 *   Defaults to `Date.now`.
 * @returns {object} The middleware.
 * @throws {Error} When the configuration is malformed.
 */
export function createTelemetry (config) {
  if (config === null || typeof config !== 'object') {
    throw new Error('createTelemetry: config must be an object')
  }
  if (config.sink === null || typeof config.sink !== 'object') {
    throw new Error('createTelemetry: config.sink must be an object')
  }
  if (typeof config.sink.write !== 'function') {
    throw new Error('createTelemetry: config.sink.write must be a function')
  }
  if (typeof config.engineVersion !== 'string' || config.engineVersion.length === 0) {
    throw new Error('createTelemetry: config.engineVersion must be a non-empty string')
  }
  const requestId = config.requestId === undefined ? randomUUID : config.requestId
  const now = config.now === undefined ? Date.now : config.now
  if (typeof requestId !== 'function') {
    throw new Error('createTelemetry: config.requestId must be a function when provided')
  }
  if (typeof now !== 'function') {
    throw new Error('createTelemetry: config.now must be a function when provided')
  }

  const { sink, engineVersion } = config

  return {
    /**
     * Wraps a route handler with telemetry capture.
     * @param {Function} handler - The original handler.
     * @returns {Function} The wrapped handler.
     */
    wrapHandler (handler) {
      return async (ctx) => {
        const intent = readIntent(ctx.body)
        const originalJson = ctx.json
        let captured = null

        ctx.json = (status, data) => {
          if (status === 200) {
            captured = data
          }
          return originalJson.call(ctx, status, data)
        }

        try {
          await handler(ctx)
        } finally {
          ctx.json = originalJson
        }

        if (captured === null || intent === null) {
          return
        }
        if (captured === null || typeof captured !== 'object' || typeof captured.kind !== 'string') {
          return
        }

        const tier = readTier(ctx)
        const record = buildRecord({
          intent,
          result: captured,
          requestId: requestId(),
          engineVersion,
          createdAt: new Date(now()).toISOString()
        })
        const filtered = filterByTier(record, tier)
        if (filtered === null) {
          return
        }

        try {
          await sink.write(filtered)
        } catch {
          return
        }
      }
    }
  }
}

/**
 * Wraps a server so that routes whose pattern is listed in `paths`
 * have their handlers instrumented with the given telemetry. Other
 * routes pass through unchanged.
 * @param {object} server - The server created by `createServer`.
 * @param {object} deps - The wrapper's dependencies.
 * @param {object} deps.telemetry - The telemetry middleware.
 * @param {string[]} [deps.paths] - Route patterns to instrument.
 *   Defaults to `['/v1/match']`.
 * @returns {object} A server-shaped object.
 * @throws {Error} When server or deps are malformed.
 */
export function createTelemetryServer (server, deps) {
  if (server === null || typeof server !== 'object') {
    throw new Error('createTelemetryServer: server must be an object')
  }
  if (typeof server.addRoute !== 'function') {
    throw new Error('createTelemetryServer: server.addRoute must be a function')
  }
  if (deps === null || typeof deps !== 'object') {
    throw new Error('createTelemetryServer: deps must be an object')
  }
  if (deps.telemetry === null || typeof deps.telemetry !== 'object') {
    throw new Error('createTelemetryServer: deps.telemetry must be an object')
  }
  if (typeof deps.telemetry.wrapHandler !== 'function') {
    throw new Error('createTelemetryServer: deps.telemetry.wrapHandler must be a function')
  }

  const pathsList = deps.paths === undefined ? ['/v1/match'] : deps.paths
  if (!Array.isArray(pathsList)) {
    throw new Error('createTelemetryServer: deps.paths must be an array when provided')
  }
  for (const path of pathsList) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('createTelemetryServer: every path must be a non-empty string')
    }
  }

  const { telemetry } = deps
  const paths = new Set(pathsList)

  return {
    addRoute (method, pattern, handler) {
      if (paths.has(pattern)) {
        server.addRoute(method, pattern, telemetry.wrapHandler(handler))
      } else {
        server.addRoute(method, pattern, handler)
      }
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
