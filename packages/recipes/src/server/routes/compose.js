// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Returns true when the value is a plain object.
 * @param {unknown} value - The value to test.
 * @returns {boolean} True when the value is a non-null non-array
 *   object.
 */
function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validates the compose request body. Returns null when valid, or
 * a human-readable message when not.
 * @param {unknown} body - The request body.
 * @returns {string | null} The error message, or null when valid.
 */
function validateBody (body) {
  if (!isPlainObject(body)) {
    return 'Request body must be a JSON object'
  }
  if (typeof body.intent !== 'string' || body.intent.length === 0) {
    return 'intent is required'
  }
  if (typeof body.botId !== 'string' || body.botId.length === 0) {
    return 'botId is required'
  }
  if (typeof body.label !== 'string' || body.label.length === 0) {
    return 'label is required'
  }
  return null
}

/**
 * Register the POST /v1/compose route.
 * @param {object} server - The server created by `createServer`.
 * @param {object} deps - The endpoint's dependencies.
 * @param {(intent: string, options: object) => Promise<import('../../types.js').ComposeBotResult>} deps.composeBot - The
 *   composer function.
 * @param {object} deps.composeBotOptions - The composer's bound
 *   options: { registry, library, llm }.
 * @param {(composition: import('../../types.js').Composition, options: object) => string} deps.emit - The
 *   emitter function.
 * @param {string} [deps.llmProxyUrl] - Forwarded to emit.
 * @param {string} [deps.composerVersion] - Forwarded to emit.
 * @returns {void}
 * @throws {Error} When server or deps are malformed.
 */
export function registerComposeRoute (server, deps) {
  if (server === null || typeof server !== 'object') {
    throw new Error('registerComposeRoute: server must be an object')
  }
  if (typeof server.addRoute !== 'function') {
    throw new Error('registerComposeRoute: server.addRoute must be a function')
  }
  if (deps === null || typeof deps !== 'object') {
    throw new Error('registerComposeRoute: deps must be an object')
  }
  if (typeof deps.composeBot !== 'function') {
    throw new Error('registerComposeRoute: deps.composeBot must be a function')
  }
  if (deps.composeBotOptions === null || typeof deps.composeBotOptions !== 'object') {
    throw new Error('registerComposeRoute: deps.composeBotOptions must be an object')
  }
  if (typeof deps.emit !== 'function') {
    throw new Error('registerComposeRoute: deps.emit must be a function')
  }
  if (deps.llmProxyUrl !== undefined && (typeof deps.llmProxyUrl !== 'string' || deps.llmProxyUrl.length === 0)) {
    throw new Error('registerComposeRoute: deps.llmProxyUrl must be a non-empty string when provided')
  }
  if (deps.composerVersion !== undefined && (typeof deps.composerVersion !== 'string' || deps.composerVersion.length === 0)) {
    throw new Error('registerComposeRoute: deps.composerVersion must be a non-empty string when provided')
  }

  server.addRoute('POST', '/v1/compose', async (ctx) => {
    try {
      const body = ctx.body
      const validationError = validateBody(body)
      if (validationError !== null) {
        ctx.error(400, 'invalid_request', validationError)
        return
      }

      const result = await deps.composeBot(body.intent, deps.composeBotOptions)

      if (result.kind === 'refusal') {
        ctx.json(200, {
          kind: 'refusal',
          reason: result.reason,
          message: result.message,
          ...(result.errors !== undefined ? { errors: result.errors } : {})
        })
        return
      }

      const emitOptions = {
        botId: body.botId,
        label: body.label
      }
      if (deps.llmProxyUrl !== undefined) {
        emitOptions.llmProxyUrl = deps.llmProxyUrl
      }
      if (deps.composerVersion !== undefined) {
        emitOptions.composerVersion = deps.composerVersion
      }

      let code
      try {
        code = deps.emit(result.composition, emitOptions)
      } catch (err) {
        ctx.error(422, 'emit_failed', err.message)
        return
      }

      ctx.json(200, {
        kind: 'composed',
        code,
        composition: result.composition
      })
    } catch (err) {
      ctx.error(500, 'internal_error', err.message)
    }
  })
}
