// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registers the POST /v1/match endpoint on the given server.
 *
 * Reads an intent from the request body, calls the matcher, and
 * returns the MatchResult. Malformed requests are rejected with the
 * standard error shape; matcher failures propagate to the server
 * scaffold, which writes a 500.
 * @param {object} server - The server created by `createServer`.
 * @param {object} deps - The endpoint's dependencies.
 * @param {Matcher} deps.matcher - The matcher to call.
 * @returns {void}
 * @throws {Error} When server or deps are malformed.
 */
export function registerMatchRoute (server, deps) {
  if (server === null || typeof server !== 'object') {
    throw new Error('registerMatchRoute: server must be an object')
  }
  if (typeof server.addRoute !== 'function') {
    throw new Error('registerMatchRoute: server.addRoute must be a function')
  }
  if (deps === null || typeof deps !== 'object') {
    throw new Error('registerMatchRoute: deps must be an object')
  }
  if (deps.matcher === null || typeof deps.matcher !== 'object') {
    throw new Error('registerMatchRoute: deps.matcher must be an object')
  }
  if (typeof deps.matcher.match !== 'function') {
    throw new Error('registerMatchRoute: deps.matcher.match must be a function')
  }

  const { matcher } = deps

  server.addRoute('POST', '/v1/match', async (ctx) => {
    const body = ctx.body
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      ctx.error(400, 'invalid_request', 'Request body must be a JSON object')
      return
    }

    const intent = body.intent
    if (typeof intent !== 'string' || intent.length === 0) {
      ctx.error(400, 'invalid_request', 'intent is required')
      return
    }

    const result = await matcher.match(intent)
    ctx.json(200, result)
  })
}
