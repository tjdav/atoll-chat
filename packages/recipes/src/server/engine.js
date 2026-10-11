// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from './index.js'
import { createAuthedServer, createTokenAuthenticator } from './auth.js'
import { createRateLimitedServer, createRateLimiter } from './rate-limit.js'
import { createTelemetryServer, createTelemetry } from './telemetry.js'
import { registerMatchRoute } from './routes/match.js'
import { registerCompileRoute } from './routes/compile.js'
import { registerReadRoutes } from './routes/read.js'
import { createMatcher } from '../matcher/pipeline.js'
import { scanLibrary } from '../recipe/library.js'

const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 120 }

/**
 * Builds a bot-level summary string for embedding. The label and
 * description are the fields a user's intent should match against;
 * the id, version, and handler details are metadata, not signal.
 * @param {object} recipe - A library summary.
 * @returns {string} The embedding text.
 */
function embeddingText (recipe) {
  return `${recipe.label}. ${recipe.description}`
}

/**
 * Populates the index with embeddings for every recipe in the
 * library. The index is cleared first so repeated calls are
 * idempotent.
 * @param {object} index - The vector index.
 * @param {Embedder} embedder - The embedder.
 * @param {object[]} recipes - Recipe summaries.
 * @returns {Promise<void>} Resolves when the index is populated.
 */
async function populateIndex (index, embedder, recipes) {
  index.clear()
  for (const recipe of recipes) {
    const text = embeddingText(recipe)
    const vector = await embedder.embed(text)
    index.add(recipe.id, vector)
  }
}

/**
 * Creates a fully-wired engine server. Runs the whole pipeline:
 * scans the library, builds the matcher, applies the middleware
 * decorators, and registers every route.
 *
 * The decorator order is `raw → rateLimited → authed → telemetry`.
 * On the request path this means rate limiting runs first, then
 * authentication, then telemetry, then the route handler. Rate
 * limiting first means brute-force attempts are throttled before
 * they consume auth work. Auth second means telemetry only records
 * requests that passed authentication. Telemetry closest to the
 * handler means it captures the match response after the handler
 * runs.
 *
 * The constructor is async because it scans the library on startup.
 * The returned `server` is a fully-wired server object; call
 * `server.listen(port)` to start it.
 * @param {object} config - The engine configuration.
 * @param {string} config.rootDir - The recipe library root directory.
 * @param {string} config.version - The engine version.
 * @param {string[]} config.tokens - Known instance tokens.
 * @param {Embedder} config.embedder - The embedder.
 * @param {object} config.index - The vector index.
 * @param {object} [config.rateLimit] - Rate limit configuration.
 *   Defaults to 120 requests per 60 seconds.
 * @param {number} [config.topK] - Candidates fetched from the index.
 * @param {object} [config.rankOptions] - Ranking options.
 * @param {Function} [config.disambiguator] - The disambiguator.
 * @param {TelemetrySink} [config.sink] - The telemetry sink. When
 *   omitted, telemetry is disabled.
 * @param {string[]} [config.exemptPaths] - Paths exempt from auth.
 * @returns {Promise<{ server: object, matcher: Matcher, library: object[] }>} The wired server and its dependencies.
 * @throws {Error} When the configuration is malformed.
 */
export async function createEngineServer (config) {
  if (config === null || typeof config !== 'object') {
    throw new Error('createEngineServer: config must be an object')
  }

  const {
    rootDir,
    version,
    tokens,
    embedder,
    index
  } = config

  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    throw new Error('createEngineServer: config.rootDir must be a non-empty string')
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('createEngineServer: config.version must be a non-empty string')
  }
  if (!Array.isArray(tokens) || tokens.length === 0) {
    throw new Error('createEngineServer: config.tokens must be a non-empty array')
  }
  if (embedder === null || typeof embedder !== 'object') {
    throw new Error('createEngineServer: config.embedder must be an object')
  }
  if (typeof embedder.embed !== 'function') {
    throw new Error('createEngineServer: config.embedder.embed must be a function')
  }
  if (index === null || typeof index !== 'object') {
    throw new Error('createEngineServer: config.index must be an object')
  }

  const rateLimitConfig = config.rateLimit === undefined
    ? DEFAULT_RATE_LIMIT
    : config.rateLimit
  if (rateLimitConfig === null || typeof rateLimitConfig !== 'object') {
    throw new Error('createEngineServer: config.rateLimit must be an object when provided')
  }

  const scan = await scanLibrary(rootDir)

  await populateIndex(index, embedder, scan.recipes)

  const matcherConfig = {
    embedder,
    index,
    recipes: scan.recipes
  }
  if (config.topK !== undefined) matcherConfig.topK = config.topK
  if (config.rankOptions !== undefined) matcherConfig.rankOptions = config.rankOptions
  if (config.disambiguator !== undefined) matcherConfig.disambiguator = config.disambiguator

  const matcher = createMatcher(matcherConfig)

  const limiter = createRateLimiter(rateLimitConfig)
  const authenticator = createTokenAuthenticator({ tokens })

  let layer = createServer()
  layer = createRateLimitedServer(layer, { limiter })
  layer = createAuthedServer(layer, {
    authenticator,
    exemptPaths: config.exemptPaths
  })

  if (config.sink !== undefined) {
    const telemetry = createTelemetry({
      sink: config.sink,
      engineVersion: version
    })
    layer = createTelemetryServer(layer, {
      telemetry,
      paths: ['/v1/match']
    })
  }

  registerMatchRoute(layer, { matcher })
  registerCompileRoute(layer, { rootDir })
  registerReadRoutes(layer, { rootDir, version })

  return { server: layer, matcher, library: scan.recipes }
}
