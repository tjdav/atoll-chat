// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registers the POST /v1/llm/complete endpoint on the given server.
 *
 * The route forwards OpenAI-compatible chat completion requests to
 * the engine's configured upstream, adding the API key. The engine
 * owns the provider, the key, and (optionally) the model. Recipes
 * talk to the engine; the engine talks to the provider.
 *
 * When `deps.model` is configured, the body's `model` field is
 * overridden before forwarding. This lets the engine control which
 * model is billed.
 *
 * @param {object} server - The server created by `createServer`.
 * @param {object} deps - The endpoint's dependencies.
 * @param {string} deps.upstreamUrl - The upstream chat completions
 *   endpoint.
 * @param {string} deps.apiKey - The bearer token sent to the
 *   upstream.
 * @param {string} [deps.model] - When set, overrides the body's
 *   `model` field.
 * @param {Function} [deps.fetch] - The fetch implementation.
 *   Defaults to `globalThis.fetch`.
 * @returns {void}
 * @throws {Error} When server or deps are malformed.
 */
export function registerLlmRoute (server, deps) {
  if (server === null || typeof server !== 'object') {
    throw new Error('registerLlmRoute: server must be an object')
  }
  if (typeof server.addRoute !== 'function') {
    throw new Error('registerLlmRoute: server.addRoute must be a function')
  }
  if (deps === null || typeof deps !== 'object') {
    throw new Error('registerLlmRoute: deps must be an object')
  }

  const { upstreamUrl, apiKey } = deps
  const model = deps.model
  const fetchImpl = deps.fetch === undefined ? globalThis.fetch : deps.fetch

  if (typeof upstreamUrl !== 'string' || upstreamUrl.length === 0) {
    throw new Error('registerLlmRoute: deps.upstreamUrl must be a non-empty string')
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('registerLlmRoute: deps.apiKey must be a non-empty string')
  }
  if (model !== undefined && (typeof model !== 'string' || model.length === 0)) {
    throw new Error('registerLlmRoute: deps.model must be a non-empty string when provided')
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('registerLlmRoute: deps.fetch must be a function when provided')
  }

  server.addRoute('POST', '/v1/llm/complete', async (ctx) => {
    const body = ctx.body
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      ctx.error(400, 'invalid_request', 'Request body must be a JSON object')
      return
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      ctx.error(400, 'invalid_request', 'messages must be a non-empty array')
      return
    }

    const upstreamBody = { ...body }
    if (model !== undefined) {
      upstreamBody.model = model
    }

    let upstreamResponse
    try {
      upstreamResponse = await fetchImpl(upstreamUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(upstreamBody)
      })
    } catch (err) {
      ctx.error(502, 'upstream_unreachable', `Upstream request failed: ${err.message}`)
      return
    }

    const raw = await upstreamResponse.text()

    if (!upstreamResponse.ok) {
      ctx.error(502, 'upstream_error', `Upstream responded with status ${upstreamResponse.status}`, {
        status: upstreamResponse.status
      })
      return
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      ctx.error(502, 'upstream_invalid_json', 'Upstream response was not valid JSON')
      return
    }

    ctx.json(200, parsed)
  })
}
