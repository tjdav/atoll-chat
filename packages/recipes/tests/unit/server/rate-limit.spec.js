// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createServer } from '../../../src/server/index.js'
import {
  createRateLimiter,
  createRateLimitedServer
} from '../../../src/server/rate-limit.js'

/**
 * A controllable clock for tests.
 * @returns {object} A `now` function and a `set` helper.
 */
function makeClock () {
  let current = 1_000_000
  return {
    now: () => current,
    set: (value) => { current = value },
    advance: (ms) => { current += ms }
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

test('createRateLimiter throws when config is not an object', () => {
  assert.throws(() => createRateLimiter(null), /config must be an object/)
  assert.throws(() => createRateLimiter('x'), /config must be an object/)
})

test('createRateLimiter throws when windowMs is invalid', () => {
  assert.throws(
    () => createRateLimiter({ windowMs: 0, max: 1 }),
    /windowMs must be a positive integer/
  )
  assert.throws(
    () => createRateLimiter({ windowMs: -1, max: 1 }),
    /windowMs must be a positive integer/
  )
  assert.throws(
    () => createRateLimiter({ windowMs: 1.5, max: 1 }),
    /windowMs must be a positive integer/
  )
})

test('createRateLimiter throws when max is invalid', () => {
  assert.throws(
    () => createRateLimiter({ windowMs: 1000, max: 0 }),
    /max must be a positive integer/
  )
  assert.throws(
    () => createRateLimiter({ windowMs: 1000, max: 1.5 }),
    /max must be a positive integer/
  )
})

test('createRateLimiter throws when now is not a function', () => {
  assert.throws(
    () => createRateLimiter({ windowMs: 1000, max: 1, now: 42 }),
    /now must be a function when provided/
  )
})

test('a fresh limiter allows the first request', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 3, now: clock.now })
  const result = limiter.check('a')
  assert.equal(result.allowed, true)
  assert.equal(result.remaining, 2)
})

test('the limiter allows up to max requests', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 3, now: clock.now })
  for (let i = 0; i < 3; i++) {
    const result = limiter.check('a')
    assert.equal(result.allowed, true)
  }
})

test('the limiter rejects the max-plus-one request', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 3, now: clock.now })
  limiter.check('a')
  limiter.check('a')
  limiter.check('a')
  const result = limiter.check('a')
  assert.equal(result.allowed, false)
  assert.equal(result.remaining, 0)
  assert.equal(result.retryAfterMs, 1000)
})

test('retryAfterMs decreases as time advances', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: clock.now })
  limiter.check('a')
  clock.advance(400)
  const result = limiter.check('a')
  assert.equal(result.allowed, false)
  assert.equal(result.retryAfterMs, 600)
})

test('the window resets after windowMs', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: clock.now })
  limiter.check('a')
  clock.advance(1000)
  const result = limiter.check('a')
  assert.equal(result.allowed, true)
})

test('separate keys have separate buckets', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: clock.now })
  limiter.check('a')
  const result = limiter.check('b')
  assert.equal(result.allowed, true)
})

test('the limiter throws when key is not a non-empty string', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: clock.now })
  assert.throws(() => limiter.check(''), /key must be a non-empty string/)
  assert.throws(() => limiter.check(42), /key must be a non-empty string/)
})

test('size reflects the number of active buckets', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 5, now: clock.now })
  assert.equal(limiter.size(), 0)
  limiter.check('a')
  limiter.check('b')
  assert.equal(limiter.size(), 2)
})

test('clear removes all buckets', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 5, now: clock.now })
  limiter.check('a')
  limiter.check('b')
  limiter.clear()
  assert.equal(limiter.size(), 0)
})

test('an expired bucket is removed on the next check after the window', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 5, now: clock.now })
  limiter.check('a')
  clock.advance(1000)
  limiter.check('b')
  assert.equal(limiter.size(), 1)
  clock.advance(1000)
  limiter.check('c')
  assert.equal(limiter.size(), 1)
})

test('sweep removes expired buckets explicitly', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 5, now: clock.now })
  limiter.check('a')
  limiter.check('b')
  assert.equal(limiter.size(), 2)
  clock.advance(1000)
  limiter.sweep()
  assert.equal(limiter.size(), 0)
})

test('an advanced window preserves buckets that are still live', () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 1000, max: 5, now: clock.now })
  limiter.check('a')
  clock.advance(500)
  limiter.check('b')
  clock.advance(600)
  limiter.check('c')
  assert.equal(limiter.size(), 2)
})

test('createRateLimitedServer throws when server is not an object', () => {
  assert.throws(
    () => createRateLimitedServer(null, { limiter: { check: () => ({ allowed: true }) } }),
    /server must be an object/
  )
})

test('createRateLimitedServer throws when server.addRoute is missing', () => {
  assert.throws(
    () => createRateLimitedServer({}, { limiter: { check: () => ({ allowed: true }) } }),
    /server\.addRoute must be a function/
  )
})

test('createRateLimitedServer throws when deps is not an object', () => {
  assert.throws(
    () => createRateLimitedServer({ addRoute: () => {} }, null),
    /deps must be an object/
  )
})

test('createRateLimitedServer throws when limiter is missing', () => {
  assert.throws(
    () => createRateLimitedServer({ addRoute: () => {} }, {}),
    /deps\.limiter must be an object/
  )
})

test('createRateLimitedServer throws when limiter.check is missing', () => {
  assert.throws(
    () => createRateLimitedServer({ addRoute: () => {} }, { limiter: {} }),
    /deps\.limiter\.check must be a function/
  )
})

test('createRateLimitedServer throws when keyExtractor is invalid', () => {
  const limiter = { check: () => ({ allowed: true }) }
  assert.throws(
    () => createRateLimitedServer(
      { addRoute: () => {} },
      { limiter, keyExtractor: 'x' }
    ),
    /deps\.keyExtractor must be a function when provided/
  )
})

test('a request within the limit passes through', async () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 60000, max: 3, now: clock.now })
  const raw = createServer()
  const limited = createRateLimitedServer(raw, { limiter })
  limited.addRoute('GET', '/api', (ctx) => { ctx.json(200, { ok: true }) })
  const url = await start(limited)

  const res = await fetch(`${url}/api`)
  assert.equal(res.status, 200)
  await limited.close()
})

test('a request over the limit gets 429 with Retry-After', async () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 60000, max: 2, now: clock.now })
  const raw = createServer()
  const limited = createRateLimitedServer(raw, { limiter })
  limited.addRoute('GET', '/api', (ctx) => { ctx.json(200, { ok: true }) })
  const url = await start(limited)

  await fetch(`${url}/api`)
  await fetch(`${url}/api`)
  const res = await fetch(`${url}/api`)
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('retry-after'), '60')
  const data = await res.json()
  assert.equal(data.error, 'rate_limited')
  assert.equal(data.message, 'Too many requests')
  await limited.close()
})

test('Retry-After rounds up to the nearest second', async () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: clock.now })
  const raw = createServer()
  const limited = createRateLimitedServer(raw, { limiter })
  limited.addRoute('GET', '/api', (ctx) => { ctx.json(200, { ok: true }) })
  const url = await start(limited)

  await fetch(`${url}/api`)
  clock.advance(58500)
  const res = await fetch(`${url}/api`)
  assert.equal(res.status, 429)
  assert.equal(res.headers.get('retry-after'), '2')
  await limited.close()
})

test('a request with a bearer token uses the token as the key', async () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: clock.now })
  const raw = createServer()
  const limited = createRateLimitedServer(raw, { limiter })
  limited.addRoute('GET', '/api', (ctx) => { ctx.json(200, { ok: true }) })
  const url = await start(limited)

  const a = await fetch(`${url}/api`, { headers: { authorization: 'Bearer token-a' } })
  const b = await fetch(`${url}/api`, { headers: { authorization: 'Bearer token-b' } })
  const c = await fetch(`${url}/api`, { headers: { authorization: 'Bearer token-a' } })
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.equal(c.status, 429)
  await limited.close()
})

test('a request without a token uses the anonymous bucket', async () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: clock.now })
  const raw = createServer()
  const limited = createRateLimitedServer(raw, { limiter })
  limited.addRoute('GET', '/api', (ctx) => { ctx.json(200, { ok: true }) })
  const url = await start(limited)

  const a = await fetch(`${url}/api`)
  const b = await fetch(`${url}/api`)
  assert.equal(a.status, 200)
  assert.equal(b.status, 429)
  await limited.close()
})

test('a malformed Authorization header shares the anonymous bucket', async () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: clock.now })
  const raw = createServer()
  const limited = createRateLimitedServer(raw, { limiter })
  limited.addRoute('GET', '/api', (ctx) => { ctx.json(200, { ok: true }) })
  const url = await start(limited)

  const a = await fetch(`${url}/api`, { headers: { authorization: 'not-a-bearer-token' } })
  const b = await fetch(`${url}/api`)
  assert.equal(a.status, 200)
  assert.equal(b.status, 429)
  await limited.close()
})

test('a custom key extractor is honored', async () => {
  const clock = makeClock()
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: clock.now })
  const raw = createServer()
  const limited = createRateLimitedServer(raw, {
    limiter,
    keyExtractor: (ctx) => ctx.headers['x-tenant'] ?? 'default'
  })
  limited.addRoute('GET', '/api', (ctx) => { ctx.json(200, { ok: true }) })
  const url = await start(limited)

  const a = await fetch(`${url}/api`, { headers: { 'x-tenant': 'acme' } })
  const b = await fetch(`${url}/api`, { headers: { 'x-tenant': 'beta' } })
  const c = await fetch(`${url}/api`, { headers: { 'x-tenant': 'acme' } })
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.equal(c.status, 429)
  await limited.close()
})

test('the wrapper passes listen through', async () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: Date.now })
  const raw = createServer()
  const limited = createRateLimitedServer(raw, { limiter })
  const { port, host } = await limited.listen(0)
  assert.ok(port > 0)
  assert.equal(typeof host, 'string')
  await limited.close()
})

test('the wrapper passes address through', async () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: Date.now })
  const raw = createServer()
  const limited = createRateLimitedServer(raw, { limiter })
  assert.equal(limited.address(), null)
  await limited.listen(0)
  assert.ok(limited.address() !== null)
  await limited.close()
})

test('the wrapper passes close through', async () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, now: Date.now })
  const raw = createServer()
  const limited = createRateLimitedServer(raw, { limiter })
  await limited.close()
  await limited.listen(0)
  await limited.close()
})
