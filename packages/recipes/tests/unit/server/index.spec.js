// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createServer } from '../../../src/server/index.js'

/**
 * Starts a server on an ephemeral port and returns its base URL.
 * @param {object} server - The server.
 * @returns {Promise<string>} The base URL.
 */
async function start (server) {
  const { port, host } = await server.listen(0)
  return `http://${host}:${port}`
}

test('createServer throws on invalid bodyLimit', () => {
  assert.throws(() => createServer({ bodyLimit: 0 }), /bodyLimit must be a positive integer/)
  assert.throws(() => createServer({ bodyLimit: -1 }), /bodyLimit must be a positive integer/)
  assert.throws(() => createServer({ bodyLimit: 1.5 }), /bodyLimit must be a positive integer/)
  assert.throws(() => createServer({ bodyLimit: 'x' }), /bodyLimit must be a positive integer/)
})

test('address returns null before listen', () => {
  const server = createServer()
  assert.equal(server.address(), null)
})

test('listen resolves with the bound address', async () => {
  const server = createServer()
  const { port, host } = await server.listen(0)
  assert.ok(port > 0)
  assert.equal(typeof host, 'string')
  assert.deepEqual(server.address(), { port, host })
  await server.close()
})

test('listen throws on an invalid port', async () => {
  const server = createServer()
  await assert.rejects(() => server.listen(-1), /port must be a non-negative integer/)
  await assert.rejects(() => server.listen(1.5), /port must be a non-negative integer/)
})

test('listen throws when already listening', async () => {
  const server = createServer()
  await server.listen(0)
  await assert.rejects(() => server.listen(0), /already listening/)
  await server.close()
})

test('close is a no-op when not listening', async () => {
  const server = createServer()
  await server.close()
})

test('a GET route responds with the handler output', async () => {
  const server = createServer()
  server.addRoute('GET', '/hello', (ctx) => {
    ctx.json(200, { ok: true })
  })
  const url = await start(server)
  const res = await fetch(`${url}/hello`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  await server.close()
})

test('the response carries a json content-type', async () => {
  const server = createServer()
  server.addRoute('GET', '/x', (ctx) => {
    ctx.json(200, {})
  })
  const url = await start(server)
  const res = await fetch(`${url}/x`)
  assert.match(res.headers.get('content-type'), /application\/json/)
  await server.close()
})

test('a POST route reads the JSON body', async () => {
  const server = createServer()
  server.addRoute('POST', '/echo', (ctx) => {
    ctx.json(200, { received: ctx.body })
  })
  const url = await start(server)
  const res = await fetch(`${url}/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' })
  })
  assert.deepEqual(await res.json(), { received: { hello: 'world' } })
  await server.close()
})

test('body is undefined when the content-type is not JSON', async () => {
  const server = createServer()
  server.addRoute('POST', '/x', (ctx) => {
    ctx.json(200, { body: ctx.body ?? null })
  })
  const url = await start(server)
  const res = await fetch(`${url}/x`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'plain text'
  })
  assert.deepEqual(await res.json(), { body: null })
  await server.close()
})

test('path params are captured', async () => {
  const server = createServer()
  server.addRoute('GET', '/items/:id', (ctx) => {
    ctx.json(200, { id: ctx.params.id })
  })
  const url = await start(server)
  const res = await fetch(`${url}/items/abc`)
  assert.deepEqual(await res.json(), { id: 'abc' })
  await server.close()
})

test('query params are parsed', async () => {
  const server = createServer()
  server.addRoute('GET', '/x', (ctx) => {
    ctx.json(200, { q: ctx.query })
  })
  const url = await start(server)
  const res = await fetch(`${url}/x?a=1&b=two`)
  assert.deepEqual(await res.json(), { q: { a: '1', b: 'two' } })
  await server.close()
})

test('the error helper writes the standard shape', async () => {
  const server = createServer()
  server.addRoute('GET', '/x', (ctx) => {
    ctx.error(400, 'invalid_input', 'Bad input', { field: 'name' })
  })
  const url = await start(server)
  const res = await fetch(`${url}/x`)
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), {
    error: 'invalid_input',
    message: 'Bad input',
    details: { field: 'name' }
  })
  await server.close()
})

test('the error helper defaults details to an empty object', async () => {
  const server = createServer()
  server.addRoute('GET', '/x', (ctx) => {
    ctx.error(400, 'invalid_input', 'Bad input')
  })
  const url = await start(server)
  const res = await fetch(`${url}/x`)
  const data = await res.json()
  assert.deepEqual(data.details, {})
  await server.close()
})

test('the text helper writes a plain text response', async () => {
  const server = createServer()
  server.addRoute('GET', '/x', (ctx) => {
    ctx.text(200, 'hello')
  })
  const url = await start(server)
  const res = await fetch(`${url}/x`)
  assert.match(res.headers.get('content-type'), /text\/plain/)
  assert.equal(await res.text(), 'hello')
  await server.close()
})

test('an unknown path returns 404 with the standard shape', async () => {
  const server = createServer()
  const url = await start(server)
  const res = await fetch(`${url}/missing`)
  assert.equal(res.status, 404)
  const data = await res.json()
  assert.equal(data.error, 'not_found')
  await server.close()
})

test('a path with the wrong method returns 405 with an Allow header', async () => {
  const server = createServer()
  server.addRoute('GET', '/x', (ctx) => { ctx.text(200, 'ok') })
  const url = await start(server)
  const res = await fetch(`${url}/x`, { method: 'POST' })
  assert.equal(res.status, 405)
  assert.match(res.headers.get('allow'), /GET/)
  const data = await res.json()
  assert.equal(data.error, 'method_not_allowed')
  await server.close()
})

test('a handler that throws produces a 500', async () => {
  const server = createServer()
  server.addRoute('GET', '/x', () => {
    throw new Error('boom')
  })
  const url = await start(server)
  const res = await fetch(`${url}/x`)
  assert.equal(res.status, 500)
  const data = await res.json()
  assert.equal(data.error, 'internal_error')
  await server.close()
})

test('a handler that writes nothing produces a 500', async () => {
  const server = createServer()
  server.addRoute('GET', '/x', () => {})
  const url = await start(server)
  const res = await fetch(`${url}/x`)
  assert.equal(res.status, 500)
  await server.close()
})

test('a request body over the limit produces a 413', async () => {
  const server = createServer({ bodyLimit: 32 })
  server.addRoute('POST', '/x', (ctx) => {
    ctx.json(200, { ok: true })
  })
  const url = await start(server)
  const res = await fetch(`${url}/x`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(200) })
  })
  assert.equal(res.status, 413)
  await server.close()
})

test('the server closes cleanly after a request', async () => {
  const server = createServer()
  server.addRoute('GET', '/x', (ctx) => { ctx.text(200, 'ok') })
  const url = await start(server)
  await fetch(`${url}/x`)
  await server.close()
  assert.equal(server.address(), null)
})

test('multiple routes can be registered and matched independently', async () => {
  const server = createServer()
  server.addRoute('GET', '/a', (ctx) => { ctx.json(200, { route: 'a' }) })
  server.addRoute('POST', '/b', (ctx) => { ctx.json(200, { route: 'b' }) })
  const url = await start(server)
  const a = await (await fetch(`${url}/a`)).json()
  const b = await (await fetch(`${url}/b`, { method: 'POST' })).json()
  assert.deepEqual(a, { route: 'a' })
  assert.deepEqual(b, { route: 'b' })
  await server.close()
})
