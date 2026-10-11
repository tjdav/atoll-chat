// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createServer } from '../../../../src/server/index.js'
import { registerMatchRoute } from '../../../../src/server/routes/match.js'

/**
 * A stub matcher that returns a configured result and records
 * intents it was called with.
 * @param {object} result - The result to return.
 * @returns {object} A matcher-shaped object.
 */
function createStubMatcher (result) {
  const calls = []
  return {
    calls,
    async match (intent) {
      calls.push(intent)
      return result
    }
  }
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

test('registerMatchRoute throws when server is not an object', () => {
  assert.throws(
    () => registerMatchRoute(null, { matcher: { match: async () => ({}) } }),
    /server must be an object/
  )
})

test('registerMatchRoute throws when server.addRoute is missing', () => {
  assert.throws(
    () => registerMatchRoute({}, { matcher: { match: async () => ({}) } }),
    /server\.addRoute must be a function/
  )
})

test('registerMatchRoute throws when deps is not an object', () => {
  assert.throws(
    () => registerMatchRoute({ addRoute: () => {} }, null),
    /deps must be an object/
  )
})

test('registerMatchRoute throws when deps.matcher is not an object', () => {
  assert.throws(
    () => registerMatchRoute({ addRoute: () => {} }, { matcher: null }),
    /deps\.matcher must be an object/
  )
})

test('registerMatchRoute throws when deps.matcher.match is not a function', () => {
  assert.throws(
    () => registerMatchRoute({ addRoute: () => {} }, { matcher: {} }),
    /deps\.matcher\.match must be a function/
  )
})

test('a well-formed request returns the matcher result', async () => {
  const matcher = createStubMatcher({
    kind: 'match',
    recipeId: 'save',
    confidence: 0.9,
    candidates: [{ recipeId: 'save', score: 0.9 }]
  })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'save a bookmark' })
  })

  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.kind, 'match')
  assert.equal(data.recipeId, 'save')
  assert.equal(data.confidence, 0.9)
  await server.close()
})

test('the intent is passed to the matcher unchanged', async () => {
  const matcher = createStubMatcher({
    kind: 'refusal',
    reason: 'no match',
    suggestions: []
  })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'exact intent text' })
  })

  assert.deepEqual(matcher.calls, ['exact intent text'])
  await server.close()
})

test('a refusal result is returned unchanged', async () => {
  const matcher = createStubMatcher({
    kind: 'refusal',
    reason: 'no match',
    suggestions: [{ recipeId: 'save', score: 0.4 }]
  })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'something' })
  })

  const data = await res.json()
  assert.equal(data.kind, 'refusal')
  assert.equal(data.reason, 'no match')
  assert.equal(data.suggestions.length, 1)
  await server.close()
})

test('an ambiguous result is returned unchanged', async () => {
  const matcher = createStubMatcher({
    kind: 'ambiguous',
    candidates: [
      { recipeId: 'save', score: 0.8 },
      { recipeId: 'weather', score: 0.78 }
    ]
  })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'ambiguous' })
  })

  const data = await res.json()
  assert.equal(data.kind, 'ambiguous')
  assert.equal(data.candidates.length, 2)
  await server.close()
})

test('a missing intent returns 400 with the standard error shape', async () => {
  const matcher = createStubMatcher({ kind: 'refusal', reason: 'no', suggestions: [] })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  })

  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.error, 'invalid_request')
  assert.equal(data.message, 'intent is required')
  assert.deepEqual(data.details, {})
  assert.equal(matcher.calls.length, 0)
  await server.close()
})

test('an empty intent returns 400', async () => {
  const matcher = createStubMatcher({ kind: 'refusal', reason: 'no', suggestions: [] })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: '' })
  })

  assert.equal(res.status, 400)
  assert.equal(matcher.calls.length, 0)
  await server.close()
})

test('a non-string intent returns 400', async () => {
  const matcher = createStubMatcher({ kind: 'refusal', reason: 'no', suggestions: [] })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 42 })
  })

  assert.equal(res.status, 400)
  assert.equal(matcher.calls.length, 0)
  await server.close()
})

test('a body with no content-type is rejected as invalid', async () => {
  const matcher = createStubMatcher({ kind: 'refusal', reason: 'no', suggestions: [] })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{"intent":"x"}'
  })

  assert.equal(res.status, 400)
  assert.equal(matcher.calls.length, 0)
  await server.close()
})

test('a JSON array body is rejected as invalid', async () => {
  const matcher = createStubMatcher({ kind: 'refusal', reason: 'no', suggestions: [] })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '["intent"]'
  })

  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.message, 'Request body must be a JSON object')
  assert.equal(matcher.calls.length, 0)
  await server.close()
})

test('the context field is accepted and ignored', async () => {
  const matcher = createStubMatcher({
    kind: 'match',
    recipeId: 'save',
    confidence: 0.9,
    candidates: []
  })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'x', context: { locale: 'en' } })
  })

  assert.equal(res.status, 200)
  assert.equal(matcher.calls.length, 1)
  await server.close()
})

test('a matcher that throws produces a 500 through the server scaffold', async () => {
  const matcher = {
    async match () {
      throw new Error('matcher unavailable')
    }
  }
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'x' })
  })

  assert.equal(res.status, 500)
  const data = await res.json()
  assert.equal(data.error, 'internal_error')
  await server.close()
})

test('the route is only registered for POST', async () => {
  const matcher = createStubMatcher({ kind: 'refusal', reason: 'no', suggestions: [] })
  const server = createServer()
  registerMatchRoute(server, { matcher })
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`)
  assert.equal(res.status, 405)
  assert.match(res.headers.get('allow'), /POST/)
  await server.close()
})
