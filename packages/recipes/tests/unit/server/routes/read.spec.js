// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createServer } from '../../../../src/server/index.js'
import { registerReadRoutes } from '../../../../src/server/routes/read.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', '..', '..', 'fixtures', 'read-library')

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
 * Registers the read routes on a fresh server and starts it.
 * @returns {Promise<{ server: object, url: string }>} The server and
 *   its base URL.
 */
async function makeServer () {
  const server = createServer()
  registerReadRoutes(server, { rootDir: LIB, version: '1.2.3' })
  const url = await start(server)
  return { server, url }
}

test('registerReadRoutes throws when server is not an object', () => {
  assert.throws(
    () => registerReadRoutes(null, { rootDir: '/x', version: '1.0.0' }),
    /server must be an object/
  )
})

test('registerReadRoutes throws when server.addRoute is missing', () => {
  assert.throws(
    () => registerReadRoutes({}, { rootDir: '/x', version: '1.0.0' }),
    /server\.addRoute must be a function/
  )
})

test('registerReadRoutes throws when deps is not an object', () => {
  assert.throws(
    () => registerReadRoutes({ addRoute: () => {} }, null),
    /deps must be an object/
  )
})

test('registerReadRoutes throws when rootDir is invalid', () => {
  assert.throws(
    () => registerReadRoutes({ addRoute: () => {} }, { rootDir: '', version: '1.0.0' }),
    /deps\.rootDir must be a non-empty string/
  )
  assert.throws(
    () => registerReadRoutes({ addRoute: () => {} }, { version: '1.0.0' }),
    /deps\.rootDir must be a non-empty string/
  )
})

test('registerReadRoutes throws when version is invalid', () => {
  assert.throws(
    () => registerReadRoutes({ addRoute: () => {} }, { rootDir: '/x', version: '' }),
    /deps\.version must be a non-empty string/
  )
  assert.throws(
    () => registerReadRoutes({ addRoute: () => {} }, { rootDir: '/x' }),
    /deps\.version must be a non-empty string/
  )
})

test('GET /v1/version returns the engine version', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/version`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.deepEqual(data, { version: '1.2.3' })
  await server.close()
})

test('GET /v1/recipes returns summaries for every valid recipe', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes`)
  assert.equal(res.status, 200)
  const data = await res.json()
  const ids = data.recipes.map((r) => r.id).sort()
  assert.deepEqual(ids, ['echo', 'no-doc'])
  await server.close()
})

test('GET /v1/recipes summaries carry the public fields', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes`)
  const data = await res.json()
  const echo = data.recipes.find((r) => r.id === 'echo')
  assert.equal(echo.version, '1.0.0')
  assert.equal(echo.label, 'Echo')
  assert.equal(typeof echo.description, 'string')
  assert.equal(echo.kind, 'pure')
  assert.deepEqual(echo.targets, ['bot'])
  await server.close()
})

test('GET /v1/recipes summaries omit the internal dir field', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes`)
  const data = await res.json()
  for (const recipe of data.recipes) {
    assert.equal(Object.hasOwn(recipe, 'dir'), false)
  }
  await server.close()
})

test('GET /v1/recipes returns an empty errors array for a clean library', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes`)
  const data = await res.json()
  assert.deepEqual(data.errors, [])
  await server.close()
})

test('GET /v1/recipes returns 405 for POST', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes`, { method: 'POST' })
  assert.equal(res.status, 405)
  assert.match(res.headers.get('allow'), /GET/)
  await server.close()
})

test('GET /v1/recipes/:id returns the full recipe and markdown', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes/echo`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.recipe.id, 'echo')
  assert.equal(data.recipe.version, '1.0.0')
  assert.equal(typeof data.recipe.handlers, 'object')
  assert.equal(typeof data.markdown, 'string')
  assert.match(data.markdown, /# Echo/)
  await server.close()
})

test('GET /v1/recipes/:id returns markdown: null when no recipe.md is present', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes/no-doc`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.recipe.id, 'no-doc')
  assert.equal(data.markdown, null)
  await server.close()
})

test('GET /v1/recipes/:id returns 404 for an unknown id', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes/does-not-exist`)
  assert.equal(res.status, 404)
  const data = await res.json()
  assert.equal(data.error, 'recipe_not_found')
  assert.match(data.message, /does-not-exist/)
  await server.close()
})

test('GET /v1/recipes/:id returns 400 for an id that fails the pattern', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes/Not-Valid`)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.error, 'invalid_request')
  await server.close()
})

test('GET /v1/recipes/:id returns 400 for an id with an underscore', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes/has_underscore`)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.error, 'invalid_request')
  await server.close()
})

test('GET /v1/recipes/:id does not leak the internal library path on 404', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes/missing`)
  const data = await res.json()
  assert.doesNotMatch(data.message, /read-library/)
  assert.doesNotMatch(data.message, /recipe\.json/)
  await server.close()
})

test('GET /v1/version returns 405 for POST', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/version`, { method: 'POST' })
  assert.equal(res.status, 405)
  assert.match(res.headers.get('allow'), /GET/)
  await server.close()
})

test('GET /v1/recipes/:id returns 405 for POST', async () => {
  const { server, url } = await makeServer()
  const res = await fetch(`${url}/v1/recipes/echo`, { method: 'POST' })
  assert.equal(res.status, 405)
  assert.match(res.headers.get('allow'), /GET/)
  await server.close()
})

test('all three endpoints coexist on the same server', async () => {
  const { server, url } = await makeServer()
  const [v, list, detail] = await Promise.all([
    fetch(`${url}/v1/version`).then((r) => r.json()),
    fetch(`${url}/v1/recipes`).then((r) => r.json()),
    fetch(`${url}/v1/recipes/echo`).then((r) => r.json())
  ])
  assert.equal(v.version, '1.2.3')
  assert.equal(list.recipes.length, 2)
  assert.equal(detail.recipe.id, 'echo')
  await server.close()
})
