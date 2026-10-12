// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createServer } from '../../../../src/server/index.js'
import { registerCompileRoute } from '../../../../src/server/routes/compile.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', '..', '..', 'fixtures', 'compiler-library')

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
 * Sends a compile request.
 * @param {string} url - The base URL.
 * @param {object} body - The request body.
 * @returns {Promise<object>} The response.
 */
async function post (url, body) {
  return fetch(`${url}/v1/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

/**
 * A well-formed request body for the echo fixture.
 * @returns {object} The body.
 */
function validBody () {
  return {
    recipeId: 'echo',
    recipeVersion: '1.0.0',
    slots: { greeting: 'hello' },
    botId: 'com.example.echo',
    label: 'Echo Bot'
  }
}

test('registerCompileRoute throws when server is not an object', () => {
  assert.throws(
    () => registerCompileRoute(null, { rootDir: '/x' }),
    /server must be an object/
  )
})

test('registerCompileRoute throws when server.addRoute is missing', () => {
  assert.throws(
    () => registerCompileRoute({}, { rootDir: '/x' }),
    /server\.addRoute must be a function/
  )
})

test('registerCompileRoute throws when deps is not an object', () => {
  assert.throws(
    () => registerCompileRoute({ addRoute: () => {} }, null),
    /deps must be an object/
  )
})

test('registerCompileRoute throws when rootDir is invalid', () => {
  assert.throws(
    () => registerCompileRoute({ addRoute: () => {} }, { rootDir: '' }),
    /deps\.rootDir must be a non-empty string/
  )
  assert.throws(
    () => registerCompileRoute({ addRoute: () => {} }, {}),
    /deps\.rootDir must be a non-empty string/
  )
})

test('a well-formed request returns 200 with a BotScript', async () => {
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, validBody())
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(typeof data.code, 'string')
  assert.equal(typeof data.composition, 'object')
  assert.equal(data.composition.recipeId, 'echo')
  assert.match(data.code, /SPDX-License-Identifier/)
  await server.close()
})

test('the emitted code carries the recipe provenance', async () => {
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, validBody())
  const data = await res.json()
  assert.match(data.code, /Recipe: echo@1\.0\.0/)
  await server.close()
})

test('the composition carries the resolved slots', async () => {
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, validBody())
  const data = await res.json()
  assert.equal(data.composition.slots.greeting, 'hello')
  await server.close()
})

test('slots is optional and defaults to an empty object', async () => {
  const body = validBody()
  delete body.slots
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.composition.slots.greeting, 'hi')
  await server.close()
})

test('optional apiVersion and hostApi are passed through', async () => {
  const body = validBody()
  body.apiVersion = '2.0.0'
  body.hostApi = '^2.0'
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  const data = await res.json()
  assert.match(data.code, /apiVersion: "2\.0\.0"/)
  assert.match(data.code, /hostApi: "\^2\.0"/)
  await server.close()
})

test('optional avatar is passed through', async () => {
  const body = validBody()
  body.avatar = { emoji: '🔖' }
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  const data = await res.json()
  assert.match(data.code, /avatar:/)
  assert.match(data.code, /🔖/)
  await server.close()
})

test('a missing recipeId returns 400', async () => {
  const body = validBody()
  delete body.recipeId
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.error, 'invalid_request')
  assert.equal(data.message, 'recipeId is required')
  await server.close()
})

test('a missing recipeVersion returns 400', async () => {
  const body = validBody()
  delete body.recipeVersion
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.message, 'recipeVersion is required')
  await server.close()
})

test('a missing botId returns 400', async () => {
  const body = validBody()
  delete body.botId
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.message, 'botId is required')
  await server.close()
})

test('a missing label returns 400', async () => {
  const body = validBody()
  delete body.label
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.message, 'label is required')
  await server.close()
})

test('a non-object slots returns 400', async () => {
  const body = validBody()
  body.slots = []
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.message, 'slots must be a plain object when provided')
  await server.close()
})

test('a non-object avatar returns 400', async () => {
  const body = validBody()
  body.avatar = '🔖'
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.message, 'avatar must be a plain object when provided')
  await server.close()
})

test('a non-string apiVersion returns 400', async () => {
  const body = validBody()
  body.apiVersion = 2
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.message, 'apiVersion must be a string when provided')
  await server.close()
})

test('a non-string hostApi returns 400', async () => {
  const body = validBody()
  body.hostApi = 2
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.message, 'hostApi must be a string when provided')
  await server.close()
})

test('a JSON array body returns 400', async () => {
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await fetch(`${url}/v1/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '[]'
  })
  assert.equal(res.status, 400)
  const data = await res.json()
  assert.equal(data.message, 'Request body must be a JSON object')
  await server.close()
})

test('a missing recipe returns 422 with compile_failed', async () => {
  const body = validBody()
  body.recipeId = 'not-a-recipe'
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 422)
  const data = await res.json()
  assert.equal(data.error, 'compile_failed')
  assert.match(data.message, /cannot load recipe/)
  await server.close()
})

test('a version mismatch returns 422', async () => {
  const body = validBody()
  body.recipeVersion = '9.9.9'
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 422)
  const data = await res.json()
  assert.equal(data.error, 'compile_failed')
  assert.match(data.message, /version mismatch/)
  await server.close()
})

test('the route is only registered for POST', async () => {
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const res = await fetch(`${url}/v1/compile`)
  assert.equal(res.status, 405)
  assert.match(res.headers.get('allow'), /POST/)
  await server.close()
})

test('compile is deterministic across identical requests', async () => {
  const server = createServer()
  registerCompileRoute(server, { rootDir: LIB })
  const url = await start(server)

  const first = await (await post(url, validBody())).json()
  const second = await (await post(url, validBody())).json()
  assert.equal(first.code, second.code)
  await server.close()
})

test('registerCompileRoute throws when llmProxyUrl is not a non-empty string', () => {
  assert.throws(
    () => registerCompileRoute({ addRoute: () => {} }, { rootDir: LIB, llmProxyUrl: '' }),
    /deps\.llmProxyUrl must be a non-empty string when provided/
  )
  assert.throws(
    () => registerCompileRoute({ addRoute: () => {} }, { rootDir: LIB, llmProxyUrl: 42 }),
    /deps\.llmProxyUrl must be a non-empty string when provided/
  )
})

test('the compile route passes llmProxyUrl to the compiler', async () => {
  const server = createServer()
  registerCompileRoute(server, {
    rootDir: LIB,
    llmProxyUrl: 'https://engine.example.com/v1/llm/complete'
  })
  const url = await start(server)

  const res = await post(url, validBody())
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(typeof data.code, 'string')
  await server.close()
})
