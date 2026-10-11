// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createServer } from '../../../src/server/index.js'
import {
  createTokenAuthenticator,
  createAuthedServer
} from '../../../src/server/auth.js'

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
 * Builds a fresh authed server around a raw server, with one route
 * at `/api`, the token `secret`, and no exempt paths.
 * @param {object} [options] - Overrides.
 * @param {string[]} [options.tokens] - Known tokens.
 * @param {string[]} [options.exemptPaths] - Exempt paths.
 * @returns {Promise<{ server: object, url: string, counter: { hits: number } }>} The
 *   authed server, its URL, and a mutable hit counter.
 */
async function makeServer (options) {
  const opts = options ?? {}
  const tokens = opts.tokens ?? ['secret']
  const authenticator = createTokenAuthenticator({ tokens })
  const raw = createServer()
  const authed = createAuthedServer(raw, {
    authenticator,
    exemptPaths: opts.exemptPaths
  })
  const counter = { hits: 0 }
  authed.addRoute('GET', '/api', (ctx) => {
    counter.hits++
    ctx.json(200, { ok: true })
  })
  const url = await start(authed)
  return { server: authed, url, counter }
}

test('createTokenAuthenticator throws when config is not an object', () => {
  assert.throws(() => createTokenAuthenticator(null), /config must be an object/)
  assert.throws(() => createTokenAuthenticator('x'), /config must be an object/)
})

test('createTokenAuthenticator throws when tokens is not an array', () => {
  assert.throws(
    () => createTokenAuthenticator({ tokens: 'x' }),
    /config\.tokens must be an array/
  )
})

test('createTokenAuthenticator throws on a non-string token', () => {
  assert.throws(
    () => createTokenAuthenticator({ tokens: ['a', 42] }),
    /every token must be a non-empty string/
  )
})

test('createTokenAuthenticator throws on an empty token', () => {
  assert.throws(
    () => createTokenAuthenticator({ tokens: ['a', ''] }),
    /every token must be a non-empty string/
  )
})

test('the authenticator accepts a valid token', async () => {
  const auth = createTokenAuthenticator({ tokens: ['abc'] })
  const result = await auth.authenticate({
    headers: { authorization: 'Bearer abc' }
  })
  assert.deepEqual(result, { valid: true })
})

test('the authenticator rejects a missing header', async () => {
  const auth = createTokenAuthenticator({ tokens: ['abc'] })
  const result = await auth.authenticate({ headers: {} })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'Missing token')
})

test('the authenticator rejects a header with no scheme', async () => {
  const auth = createTokenAuthenticator({ tokens: ['abc'] })
  const result = await auth.authenticate({
    headers: { authorization: 'abc' }
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'Malformed Authorization header')
})

test('the authenticator rejects a wrong scheme', async () => {
  const auth = createTokenAuthenticator({ tokens: ['abc'] })
  const result = await auth.authenticate({
    headers: { authorization: 'Basic abc' }
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'Malformed Authorization header')
})

test('the authenticator rejects an empty token', async () => {
  const auth = createTokenAuthenticator({ tokens: ['abc'] })
  const result = await auth.authenticate({
    headers: { authorization: 'Bearer ' }
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'Malformed Authorization header')
})

test('the authenticator is case-insensitive on the scheme', async () => {
  const auth = createTokenAuthenticator({ tokens: ['abc'] })
  for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
    const result = await auth.authenticate({
      headers: { authorization: `${scheme} abc` }
    })
    assert.deepEqual(result, { valid: true })
  }
})

test('the authenticator is case-sensitive on the token', async () => {
  const auth = createTokenAuthenticator({ tokens: ['ABC'] })
  const result = await auth.authenticate({
    headers: { authorization: 'Bearer abc' }
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'Invalid token')
})

test('the authenticator rejects an unknown token', async () => {
  const auth = createTokenAuthenticator({ tokens: ['abc'] })
  const result = await auth.authenticate({
    headers: { authorization: 'Bearer wrong' }
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'Invalid token')
})

test('the authenticator accepts any of multiple tokens', async () => {
  const auth = createTokenAuthenticator({ tokens: ['a', 'b', 'c'] })
  for (const token of ['a', 'b', 'c']) {
    const result = await auth.authenticate({
      headers: { authorization: `Bearer ${token}` }
    })
    assert.deepEqual(result, { valid: true })
  }
})

test('the authenticator does not throw on tokens of differing lengths', async () => {
  const auth = createTokenAuthenticator({ tokens: ['short'] })
  const result = await auth.authenticate({
    headers: { authorization: 'Bearer a-much-longer-token-than-the-known-one' }
  })
  assert.equal(result.valid, false)
})

test('the authenticator copies the token list at construction', async () => {
  const tokens = ['abc']
  const auth = createTokenAuthenticator({ tokens })
  tokens.push('def')
  const result = await auth.authenticate({
    headers: { authorization: 'Bearer def' }
  })
  assert.equal(result.valid, false)
})

test('createAuthedServer throws when server is not an object', () => {
  assert.throws(
    () => createAuthedServer(null, { authenticator: { authenticate: async () => ({ valid: true }) } }),
    /server must be an object/
  )
})

test('createAuthedServer throws when server.addRoute is missing', () => {
  assert.throws(
    () => createAuthedServer({}, { authenticator: { authenticate: async () => ({ valid: true }) } }),
    /server\.addRoute must be a function/
  )
})

test('createAuthedServer throws when deps is not an object', () => {
  assert.throws(
    () => createAuthedServer({ addRoute: () => {} }, null),
    /deps must be an object/
  )
})

test('createAuthedServer throws when authenticator is missing', () => {
  assert.throws(
    () => createAuthedServer({ addRoute: () => {} }, {}),
    /deps\.authenticator must be an object/
  )
})

test('createAuthedServer throws when authenticator.authenticate is missing', () => {
  assert.throws(
    () => createAuthedServer({ addRoute: () => {} }, { authenticator: {} }),
    /deps\.authenticator\.authenticate must be a function/
  )
})

test('createAuthedServer throws when exemptPaths is not an array', () => {
  assert.throws(
    () => createAuthedServer(
      { addRoute: () => {} },
      { authenticator: { authenticate: async () => ({ valid: true }) }, exemptPaths: 'x' }
    ),
    /deps\.exemptPaths must be an array when provided/
  )
})

test('createAuthedServer throws on an invalid exempt path', () => {
  assert.throws(
    () => createAuthedServer(
      { addRoute: () => {} },
      { authenticator: { authenticate: async () => ({ valid: true }) }, exemptPaths: [''] }
    ),
    /every exempt path must be a non-empty string/
  )
})

test('a request without a token gets 401', async () => {
  const { server, url, counter } = await makeServer()
  const res = await fetch(`${url}/api`)
  assert.equal(res.status, 401)
  const data = await res.json()
  assert.equal(data.error, 'unauthorized')
  assert.equal(data.message, 'Missing token')
  assert.equal(counter.hits, 0)
  await server.close()
})

test('a request with a wrong token gets 401', async () => {
  const { server, url, counter } = await makeServer()
  const res = await fetch(`${url}/api`, {
    headers: { authorization: 'Bearer wrong' }
  })
  assert.equal(res.status, 401)
  const data = await res.json()
  assert.equal(data.message, 'Invalid token')
  assert.equal(counter.hits, 0)
  await server.close()
})

test('a request with a malformed header gets 401', async () => {
  const { server, url, counter } = await makeServer()
  const res = await fetch(`${url}/api`, {
    headers: { authorization: 'secret' }
  })
  assert.equal(res.status, 401)
  const data = await res.json()
  assert.equal(data.message, 'Malformed Authorization header')
  assert.equal(counter.hits, 0)
  await server.close()
})

test('a request with a valid token reaches the handler', async () => {
  const { server, url, counter } = await makeServer()
  const res = await fetch(`${url}/api`, {
    headers: { authorization: 'Bearer secret' }
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.deepEqual(data, { ok: true })
  assert.equal(counter.hits, 1)
  await server.close()
})

test('exempt paths bypass the token check', async () => {
  const { server, url, counter } = await makeServer({
    exemptPaths: ['/api']
  })
  const res = await fetch(`${url}/api`)
  assert.equal(res.status, 200)
  assert.equal(counter.hits, 1)
  await server.close()
})

test('exempt path matching is exact, not prefix', async () => {
  const raw = createServer()
  const auth = createTokenAuthenticator({ tokens: ['secret'] })
  const authed = createAuthedServer(raw, {
    authenticator: auth,
    exemptPaths: ['/api']
  })
  authed.addRoute('GET', '/api/private', (ctx) => { ctx.json(200, { ok: true }) })
  const url = await start(authed)
  const res = await fetch(`${url}/api/private`)
  assert.equal(res.status, 401)
  await authed.close()
})

test('every route registered through the wrapper is authed', async () => {
  const raw = createServer()
  const auth = createTokenAuthenticator({ tokens: ['secret'] })
  const authed = createAuthedServer(raw, { authenticator: auth })
  authed.addRoute('GET', '/a', (ctx) => { ctx.json(200, { route: 'a' }) })
  authed.addRoute('GET', '/b', (ctx) => { ctx.json(200, { route: 'b' }) })
  const url = await start(authed)

  const a = await fetch(`${url}/a`)
  const b = await fetch(`${url}/b`)
  assert.equal(a.status, 401)
  assert.equal(b.status, 401)

  const a2 = await fetch(`${url}/a`, { headers: { authorization: 'Bearer secret' } })
  const b2 = await fetch(`${url}/b`, { headers: { authorization: 'Bearer secret' } })
  assert.equal(a2.status, 200)
  assert.equal(b2.status, 200)
  await authed.close()
})

test('the wrapper passes listen through', async () => {
  const raw = createServer()
  const auth = createTokenAuthenticator({ tokens: ['secret'] })
  const authed = createAuthedServer(raw, { authenticator: auth })
  const { port, host } = await authed.listen(0)
  assert.ok(port > 0)
  assert.equal(typeof host, 'string')
  await authed.close()
})

test('the wrapper passes address through', async () => {
  const raw = createServer()
  const auth = createTokenAuthenticator({ tokens: ['secret'] })
  const authed = createAuthedServer(raw, { authenticator: auth })
  assert.equal(authed.address(), null)
  await authed.listen(0)
  assert.ok(authed.address() !== null)
  await authed.close()
  assert.equal(authed.address(), null)
})

test('the wrapper passes close through and is idempotent', async () => {
  const raw = createServer()
  const auth = createTokenAuthenticator({ tokens: ['secret'] })
  const authed = createAuthedServer(raw, { authenticator: auth })
  await authed.close()
  await authed.listen(0)
  await authed.close()
  await authed.close()
})

test('the underlying server is not double-wrapped', async () => {
  const raw = createServer()
  let callCount = 0
  const auth = {
    async authenticate () {
      callCount++
      return { valid: true }
    }
  }
  const authed = createAuthedServer(raw, { authenticator: auth })
  authed.addRoute('GET', '/api', (ctx) => { ctx.json(200, { ok: true }) })
  const url = await start(authed)
  await fetch(`${url}/api`)
  assert.equal(callCount, 1)
  await authed.close()
})

test('the handler runs after a successful auth, with an unmodified ctx', async () => {
  const raw = createServer()
  const auth = createTokenAuthenticator({ tokens: ['secret'] })
  const authed = createAuthedServer(raw, { authenticator: auth })
  let capturedPath = null
  authed.addRoute('GET', '/items/:id', (ctx) => {
    capturedPath = ctx.params.id
    ctx.json(200, { ok: true })
  })
  const url = await start(authed)
  await fetch(`${url}/items/abc`, { headers: { authorization: 'Bearer secret' } })
  assert.equal(capturedPath, 'abc')
  await authed.close()
})
