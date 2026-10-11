// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createServer } from '../../../src/server/index.js'
import { registerMatchRoute } from '../../../src/server/routes/match.js'
import {
  createTelemetry,
  createTelemetryServer
} from '../../../src/server/telemetry.js'

/**
 * A sink that records every write.
 * @returns {object} The sink and its writes array.
 */
function makeSink () {
  const writes = []
  return {
    writes,
    async write (record) {
      writes.push(record)
    }
  }
}

/**
 * A controllable request-id generator and clock.
 * @returns {object} Generators.
 */
function makeGen () {
  let counter = 0
  return {
    requestId: () => `req_${++counter}`,
    now: () => 1_700_000_000_000
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

/**
 * Builds a matcher stub that returns a configured result.
 * @param {object} result - The result to return.
 * @returns {object} The matcher.
 */
function makeMatcher (result) {
  return { async match () { return result } }
}

/**
 * A standard match result.
 * @returns {object} A MatchResult.
 */
function matchResult () {
  return {
    kind: 'match',
    recipeId: 'save',
    confidence: 0.9,
    candidates: [{ recipeId: 'save', score: 0.9 }]
  }
}

test('createTelemetry throws when config is not an object', () => {
  assert.throws(() => createTelemetry(null), /config must be an object/)
  assert.throws(() => createTelemetry('x'), /config must be an object/)
})

test('createTelemetry throws when sink is missing', () => {
  assert.throws(
    () => createTelemetry({ engineVersion: '1.0.0' }),
    /config\.sink must be an object/
  )
})

test('createTelemetry throws when sink.write is missing', () => {
  assert.throws(
    () => createTelemetry({ sink: {}, engineVersion: '1.0.0' }),
    /config\.sink\.write must be a function/
  )
})

test('createTelemetry throws when engineVersion is invalid', () => {
  assert.throws(
    () => createTelemetry({ sink: { write: () => {} }, engineVersion: '' }),
    /config\.engineVersion must be a non-empty string/
  )
  assert.throws(
    () => createTelemetry({ sink: { write: () => {} } }),
    /config\.engineVersion must be a non-empty string/
  )
})

test('createTelemetry throws when requestId is not a function', () => {
  assert.throws(
    () => createTelemetry({
      sink: { write: () => {} },
      engineVersion: '1.0.0',
      requestId: 'x'
    }),
    /config\.requestId must be a function when provided/
  )
})

test('createTelemetry throws when now is not a function', () => {
  assert.throws(
    () => createTelemetry({
      sink: { write: () => {} },
      engineVersion: '1.0.0',
      now: 42
    }),
    /config\.now must be a function when provided/
  )
})

test('createTelemetryServer throws when server is not an object', () => {
  assert.throws(
    () => createTelemetryServer(null, { telemetry: { wrapHandler: () => {} } }),
    /server must be an object/
  )
})

test('createTelemetryServer throws when deps is not an object', () => {
  assert.throws(
    () => createTelemetryServer({ addRoute: () => {} }, null),
    /deps must be an object/
  )
})

test('createTelemetryServer throws when telemetry is missing', () => {
  assert.throws(
    () => createTelemetryServer({ addRoute: () => {} }, {}),
    /deps\.telemetry must be an object/
  )
})

test('createTelemetryServer throws when telemetry.wrapHandler is missing', () => {
  assert.throws(
    () => createTelemetryServer({ addRoute: () => {} }, { telemetry: {} }),
    /deps\.telemetry\.wrapHandler must be a function/
  )
})

test('createTelemetryServer throws when paths is not an array', () => {
  assert.throws(
    () => createTelemetryServer(
      { addRoute: () => {} },
      { telemetry: { wrapHandler: () => {} }, paths: 'x' }
    ),
    /deps\.paths must be an array when provided/
  )
})

test('createTelemetryServer throws on an invalid path', () => {
  assert.throws(
    () => createTelemetryServer(
      { addRoute: () => {} },
      { telemetry: { wrapHandler: () => {} }, paths: [''] }
    ),
    /every path must be a non-empty string/
  )
})

test('tier 0 does not call the sink', async () => {
  const sink = makeSink()
  const gen = makeGen()
  const telemetry = createTelemetry({
    sink,
    engineVersion: '1.0.0',
    requestId: gen.requestId,
    now: gen.now
  })
  const server = createServer()
  registerMatchRoute(
    createTelemetryServer(server, { telemetry }),
    { matcher: makeMatcher(matchResult()) }
  )
  const url = await start(server)

  await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'save a bookmark' })
  })

  assert.equal(sink.writes.length, 0)
  await server.close()
})

test('tier 1 calls the sink with a record that omits intentText', async () => {
  const sink = makeSink()
  const gen = makeGen()
  const telemetry = createTelemetry({
    sink,
    engineVersion: '1.0.0',
    requestId: gen.requestId,
    now: gen.now
  })
  const server = createServer()
  registerMatchRoute(
    createTelemetryServer(server, { telemetry }),
    { matcher: makeMatcher(matchResult()) }
  )
  const url = await start(server)

  await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-consent-tier': '1'
    },
    body: JSON.stringify({ intent: 'save a bookmark' })
  })

  assert.equal(sink.writes.length, 1)
  const record = sink.writes[0]
  assert.equal(Object.hasOwn(record, 'intentText'), false)
  assert.equal(record.matchKind, 'match')
  assert.equal(record.matchedRecipe, 'save')
  await server.close()
})

test('tier 2 calls the sink with the full record', async () => {
  const sink = makeSink()
  const gen = makeGen()
  const telemetry = createTelemetry({
    sink,
    engineVersion: '1.2.3',
    requestId: gen.requestId,
    now: gen.now
  })
  const server = createServer()
  registerMatchRoute(
    createTelemetryServer(server, { telemetry }),
    { matcher: makeMatcher(matchResult()) }
  )
  const url = await start(server)

  await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-consent-tier': '2'
    },
    body: JSON.stringify({ intent: 'save a bookmark' })
  })

  assert.equal(sink.writes.length, 1)
  const record = sink.writes[0]
  assert.equal(record.intentText, 'save a bookmark')
  assert.equal(record.matchKind, 'match')
  assert.equal(record.matchedRecipe, 'save')
  assert.equal(record.matchConfidence, 0.9)
  assert.equal(record.engineVersion, '1.2.3')
  assert.equal(record.requestId, 'req_1')
  assert.equal(record.createdAt, new Date(1_700_000_000_000).toISOString())
  assert.deepEqual(record.candidates, [{ recipeId: 'save', score: 0.9 }])
  await server.close()
})

test('a refusal produces a record with matchKind "refusal"', async () => {
  const sink = makeSink()
  const gen = makeGen()
  const telemetry = createTelemetry({
    sink,
    engineVersion: '1.0.0',
    requestId: gen.requestId,
    now: gen.now
  })
  const server = createServer()
  registerMatchRoute(
    createTelemetryServer(server, { telemetry }),
    {
      matcher: makeMatcher({
        kind: 'refusal',
        reason: 'no match',
        suggestions: [{ recipeId: 'save', score: 0.4 }]
      })
    }
  )
  const url = await start(server)

  await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-consent-tier': '2'
    },
    body: JSON.stringify({ intent: 'something odd' })
  })

  const record = sink.writes[0]
  assert.equal(record.matchKind, 'refusal')
  assert.equal(Object.hasOwn(record, 'matchedRecipe'), false)
  assert.equal(Object.hasOwn(record, 'matchConfidence'), false)
  assert.deepEqual(record.candidates, [{ recipeId: 'save', score: 0.4 }])
  await server.close()
})

test('an ambiguous result produces a record with matchKind "ambiguous"', async () => {
  const sink = makeSink()
  const gen = makeGen()
  const telemetry = createTelemetry({
    sink,
    engineVersion: '1.0.0',
    requestId: gen.requestId,
    now: gen.now
  })
  const server = createServer()
  registerMatchRoute(
    createTelemetryServer(server, { telemetry }),
    {
      matcher: makeMatcher({
        kind: 'ambiguous',
        candidates: [
          { recipeId: 'save', score: 0.8 },
          { recipeId: 'weather', score: 0.78 }
        ]
      })
    }
  )
  const url = await start(server)

  await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-consent-tier': '2'
    },
    body: JSON.stringify({ intent: 'pick one' })
  })

  const record = sink.writes[0]
  assert.equal(record.matchKind, 'ambiguous')
  assert.equal(record.candidates.length, 2)
  await server.close()
})

test('a 400 response is not recorded', async () => {
  const sink = makeSink()
  const gen = makeGen()
  const telemetry = createTelemetry({
    sink,
    engineVersion: '1.0.0',
    requestId: gen.requestId,
    now: gen.now
  })
  const server = createServer()
  registerMatchRoute(
    createTelemetryServer(server, { telemetry }),
    { matcher: makeMatcher(matchResult()) }
  )
  const url = await start(server)

  await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-consent-tier': '2'
    },
    body: JSON.stringify({})
  })

  assert.equal(sink.writes.length, 0)
  await server.close()
})

test('a malformed x-consent-tier is treated as tier 0', async () => {
  const sink = makeSink()
  const gen = makeGen()
  const telemetry = createTelemetry({
    sink,
    engineVersion: '1.0.0',
    requestId: gen.requestId,
    now: gen.now
  })
  const server = createServer()
  registerMatchRoute(
    createTelemetryServer(server, { telemetry }),
    { matcher: makeMatcher(matchResult()) }
  )
  const url = await start(server)

  for (const value of ['0', '3', 'x', 'abc', '1.5', '']) {
    await fetch(`${url}/v1/match`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-consent-tier': value
      },
      body: JSON.stringify({ intent: 'x' })
    })
  }

  assert.equal(sink.writes.length, 0)
  await server.close()
})

test('a sink that throws does not break the response', async () => {
  const gen = makeGen()
  const sink = {
    async write () {
      throw new Error('sink unavailable')
    }
  }
  const telemetry = createTelemetry({
    sink,
    engineVersion: '1.0.0',
    requestId: gen.requestId,
    now: gen.now
  })
  const server = createServer()
  registerMatchRoute(
    createTelemetryServer(server, { telemetry }),
    { matcher: makeMatcher(matchResult()) }
  )
  const url = await start(server)

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-consent-tier': '2'
    },
    body: JSON.stringify({ intent: 'x' })
  })

  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.kind, 'match')
  await server.close()
})

test('only routes in paths are instrumented', async () => {
  const sink = makeSink()
  const gen = makeGen()
  const telemetry = createTelemetry({
    sink,
    engineVersion: '1.0.0',
    requestId: gen.requestId,
    now: gen.now
  })
  const server = createServer()
  const wrapped = createTelemetryServer(server, { telemetry })
  wrapped.addRoute('GET', '/other', (ctx) => { ctx.json(200, { kind: 'match' }) })
  registerMatchRoute(wrapped, { matcher: makeMatcher(matchResult()) })
  const url = await start(server)

  await fetch(`${url}/other`, {
    headers: { 'x-consent-tier': '2' }
  })
  assert.equal(sink.writes.length, 0)

  await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-consent-tier': '2'
    },
    body: JSON.stringify({ intent: 'x' })
  })
  assert.equal(sink.writes.length, 1)
  await server.close()
})

test('the wrapper restores ctx.json after handling', async () => {
  const sink = makeSink()
  const gen = makeGen()
  const telemetry = createTelemetry({
    sink,
    engineVersion: '1.0.0',
    requestId: gen.requestId,
    now: gen.now
  })
  const server = createServer()
  const wrapped = createTelemetryServer(server, { telemetry })
  let jsonAfterHandler = null
  wrapped.addRoute('POST', '/v1/match', async (ctx) => {
    jsonAfterHandler = ctx.json
    ctx.json(200, { kind: 'refusal', reason: 'test', suggestions: [] })
  })
  const url = await start(server)

  await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'x' })
  })

  assert.equal(typeof jsonAfterHandler, 'function')
  await server.close()
})

test('the wrapper passes listen, address, and close through', async () => {
  const telemetry = createTelemetry({
    sink: { write: () => {} },
    engineVersion: '1.0.0'
  })
  const server = createServer()
  const wrapped = createTelemetryServer(server, { telemetry })
  assert.equal(wrapped.address(), null)
  const { port } = await wrapped.listen(0)
  assert.ok(port > 0)
  assert.ok(wrapped.address() !== null)
  await wrapped.close()
})
