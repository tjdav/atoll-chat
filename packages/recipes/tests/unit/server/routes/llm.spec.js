// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createServer } from '../../../../src/server/index.js'
import { registerLlmRoute } from '../../../../src/server/routes/llm.js'

const UPSTREAM = 'https://upstream.example.com/v1/chat/completions'
const API_KEY = 'test-api-key'

/**
 * Builds a Response-shaped object.
 * @param {unknown} body - The response body. Objects are JSON-encoded.
 * @param {number} [status] - HTTP status. Defaults to 200.
 * @returns {object} A Response-shaped object.
 */
function makeResponse (body, status) {
  const resolvedStatus = status === undefined ? 200 : status
  return {
    ok: resolvedStatus >= 200 && resolvedStatus < 300,
    status: resolvedStatus,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  }
}

/**
 * Builds a fetch stub that records calls and returns a configured
 * response or throws a configured error.
 * @param {object} config - Stub config.
 * @param {object} [config.response] - The Response to return.
 * @param {Error} [config.error] - The error to throw.
 * @returns {{ fetch: Function, calls: object[] }} The stub and a
 *   mutable array of fetch calls.
 */
function makeFetchStub (config) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (config.error) {
      throw config.error
    }
    return config.response
  }
  return { fetch, calls }
}

/**
 * Starts a server on an ephemeral port and returns its base URL.
 * @param {object} server - The server.
 * @returns {Promise<string>} The base URL.
 */
async function start (server) {
  const { port, host } = await server.listen(0)
  return `http://${host}:${port}`
}

/**
 * Posts a request to the LLM endpoint.
 * @param {string} url - The base URL.
 * @param {unknown} body - The request body.
 * @returns {Promise<Response>} The response.
 */
async function post (url, body) {
  return fetch(`${url}/v1/llm/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

/**
 * A minimal valid request body.
 * @returns {object} The body.
 */
function validBody () {
  return {
    model: 'glm-4.5-flash',
    temperature: 0.1,
    messages: [{ role: 'user', content: 'Say hi.' }]
  }
}

test('registerLlmRoute throws when server is not an object', () => {
  assert.throws(
    () => registerLlmRoute(null, { upstreamUrl: UPSTREAM, apiKey: API_KEY }),
    /server must be an object/
  )
})

test('registerLlmRoute throws when server.addRoute is missing', () => {
  assert.throws(
    () => registerLlmRoute({}, { upstreamUrl: UPSTREAM, apiKey: API_KEY }),
    /server\.addRoute must be a function/
  )
})

test('registerLlmRoute throws when deps is not an object', () => {
  assert.throws(
    () => registerLlmRoute({ addRoute: () => {} }, null),
    /deps must be an object/
  )
})

test('registerLlmRoute throws when upstreamUrl is invalid', () => {
  assert.throws(
    () => registerLlmRoute({ addRoute: () => {} }, { apiKey: API_KEY }),
    /deps\.upstreamUrl must be a non-empty string/
  )
  assert.throws(
    () => registerLlmRoute({ addRoute: () => {} }, { upstreamUrl: '', apiKey: API_KEY }),
    /deps\.upstreamUrl must be a non-empty string/
  )
})

test('registerLlmRoute throws when apiKey is invalid', () => {
  assert.throws(
    () => registerLlmRoute({ addRoute: () => {} }, { upstreamUrl: UPSTREAM }),
    /deps\.apiKey must be a non-empty string/
  )
  assert.throws(
    () => registerLlmRoute({ addRoute: () => {} }, { upstreamUrl: UPSTREAM, apiKey: '' }),
    /deps\.apiKey must be a non-empty string/
  )
})

test('registerLlmRoute throws when model is not a string', () => {
  assert.throws(
    () => registerLlmRoute(
      { addRoute: () => {} },
      { upstreamUrl: UPSTREAM, apiKey: API_KEY, model: 42 }
    ),
    /deps\.model must be a non-empty string when provided/
  )
})

test('registerLlmRoute throws when fetch is not a function', () => {
  assert.throws(
    () => registerLlmRoute(
      { addRoute: () => {} },
      { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: 'not a function' }
    ),
    /deps\.fetch must be a function when provided/
  )
})

test('a well-formed request is forwarded and the response returned', async () => {
  const { fetch: fetchStub, calls } = makeFetchStub({
    response: makeResponse({ choices: [{ message: { content: 'hi' } }] })
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  const res = await post(url, validBody())

  assert.equal(res.status, 200)
  const data = await res.json()
  assert.deepEqual(data, { choices: [{ message: { content: 'hi' } }] })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, UPSTREAM)
  assert.equal(calls[0].init.method, 'POST')
  await server.close()
})

test('the Authorization header carries the api key', async () => {
  const { fetch: fetchStub, calls } = makeFetchStub({
    response: makeResponse({ choices: [] })
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  await post(url, validBody())

  assert.equal(calls[0].init.headers.authorization, `Bearer ${API_KEY}`)
  await server.close()
})

test('the request body is forwarded with model and messages intact', async () => {
  const { fetch: fetchStub, calls } = makeFetchStub({
    response: makeResponse({ choices: [] })
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  const body = validBody()
  await post(url, body)

  const forwarded = JSON.parse(calls[0].init.body)
  assert.equal(forwarded.model, 'glm-4.5-flash')
  assert.equal(forwarded.temperature, 0.1)
  assert.deepEqual(forwarded.messages, body.messages)
  await server.close()
})

test('the response_format field is forwarded when present', async () => {
  const { fetch: fetchStub, calls } = makeFetchStub({
    response: makeResponse({ choices: [] })
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  const body = validBody()
  body.response_format = { type: 'json_object' }
  await post(url, body)

  const forwarded = JSON.parse(calls[0].init.body)
  assert.deepEqual(forwarded.response_format, { type: 'json_object' })
  await server.close()
})

test('when deps.model is configured, the body model is overridden', async () => {
  const { fetch: fetchStub, calls } = makeFetchStub({
    response: makeResponse({ choices: [] })
  })
  const server = createServer()
  registerLlmRoute(server, {
    upstreamUrl: UPSTREAM,
    apiKey: API_KEY,
    model: 'engine-chosen-model',
    fetch: fetchStub
  })
  const url = await start(server)

  await post(url, validBody())

  const forwarded = JSON.parse(calls[0].init.body)
  assert.equal(forwarded.model, 'engine-chosen-model')
  await server.close()
})

test('a non-object body returns 400', async () => {
  const { fetch: fetchStub } = makeFetchStub({
    response: makeResponse({ choices: [] })
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  const res = await fetch(`${url}/v1/llm/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '[]'
  })

  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.error, 'invalid_request')
  assert.equal(data.message, 'Request body must be a JSON object')
  await server.close()
})

test('a body with no messages returns 400', async () => {
  const { fetch: fetchStub, calls } = makeFetchStub({
    response: makeResponse({ choices: [] })
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  const res = await post(url, { model: 'm' })

  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.message, 'messages must be a non-empty array')
  assert.equal(calls.length, 0)
  await server.close()
})

test('a body with empty messages returns 400', async () => {
  const { fetch: fetchStub, calls } = makeFetchStub({
    response: makeResponse({ choices: [] })
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  const res = await post(url, { model: 'm', messages: [] })

  assert.equal(res.status, 400)
  assert.equal(calls.length, 0)
  await server.close()
})

test('a fetch error returns 502 with upstream_unreachable', async () => {
  const { fetch: fetchStub } = makeFetchStub({
    error: new Error('connection refused')
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  const res = await post(url, validBody())

  assert.equal(res.status, 502)
  const data = await res.json()
  assert.equal(data.error, 'upstream_unreachable')
  assert.match(data.message, /connection refused/)
  await server.close()
})

test('a non-2xx upstream response returns 502 with the status in details', async () => {
  const { fetch: fetchStub } = makeFetchStub({
    response: makeResponse('rate limited', 429)
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  const res = await post(url, validBody())

  assert.equal(res.status, 502)
  const data = await res.json()
  assert.equal(data.error, 'upstream_error')
  assert.equal(data.details.status, 429)
  await server.close()
})

test('a non-JSON upstream response returns 502 with upstream_invalid_json', async () => {
  const { fetch: fetchStub } = makeFetchStub({
    response: makeResponse('not json at all')
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  const res = await post(url, validBody())

  assert.equal(res.status, 502)
  const data = await res.json()
  assert.equal(data.error, 'upstream_invalid_json')
  await server.close()
})

test('the route is only registered for POST', async () => {
  const { fetch: fetchStub } = makeFetchStub({
    response: makeResponse({ choices: [] })
  })
  const server = createServer()
  registerLlmRoute(server, { upstreamUrl: UPSTREAM, apiKey: API_KEY, fetch: fetchStub })
  const url = await start(server)

  const res = await fetch(`${url}/v1/llm/complete`)

  assert.equal(res.status, 405)
  assert.match(res.headers.get('allow'), /POST/)
  await server.close()
})
