// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createEngineServer } from '../../src/server/index.js'
import { createHashEmbedder } from '../../src/matcher/embedder.js'
import { createVectorIndex } from '../../src/matcher/vector-index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'fixtures', 'compiler-library')

const TOKEN = 'integration-token'
const VERSION = '0.0.0-test'

/**
 * Builds a fully-wired engine server against the compiler-library
 * fixture with no rate-limit tuning and no telemetry sink.
 * @returns {Promise<{ server: object, url: string }>} The server and
 *   its base URL.
 */
async function buildEngine () {
  const { server } = await createEngineServer({
    rootDir: LIB,
    version: VERSION,
    tokens: [TOKEN],
    embedder: createHashEmbedder(),
    index: createVectorIndex(),
    rankOptions: { threshold: 0.1 }
  })
  const { port, host } = await server.listen(0)
  return { server, url: `http://${host}:${port}` }
}

/**
 * Sends an authorized request.
 * @param {string} url - The full URL.
 * @param {object} [init] - fetch init.
 * @returns {Promise<Response>} The response.
 */
async function authedFetch (url, init) {
  const headers = {
    authorization: `Bearer ${TOKEN}`,
    ...(init?.headers ?? {})
  }
  return fetch(url, { ...init, headers })
}

test('the engine server re-exports createEngineServer', () => {
  assert.equal(typeof createEngineServer, 'function')
})

test('the full flow: match an intent, compile the matched recipe, and read the emitted source', async () => {
  const { server, url } = await buildEngine()

  const matchRes = await authedFetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'echo something back to me' })
  })
  assert.equal(matchRes.status, 200)
  const matchResult = await matchRes.json()
  assert.ok(['match', 'ambiguous', 'refusal'].includes(matchResult.kind))

  assert.equal(matchResult.kind, 'match')
  assert.equal(matchResult.recipeId, 'echo')

  const compileRes = await authedFetch(`${url}/v1/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipeId: matchResult.recipeId,
      recipeVersion: '1.0.0',
      slots: { greeting: 'hello from the test' },
      botId: 'com.example.echo',
      label: 'Echo'
    })
  })
  assert.equal(compileRes.status, 200)
  const script = await compileRes.json()
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'echo')
  assert.equal(script.composition.slots.greeting, 'hello from the test')

  assert.match(script.code, /SPDX-License-Identifier: AGPL-3\.0-or-later/)
  assert.match(script.code, /Recipe: echo@1\.0\.0/)
  assert.match(script.code, /import \{ defineBot \} from '@atoll\/bot'/)
  assert.match(script.code, /postResponse\.create\(/)
  assert.match(script.code, /id: "com\.example\.echo"/)
  assert.match(script.code, /hello from the test/)

  await server.close()
})

test('the version endpoint reports the engine version', async () => {
  const { server, url } = await buildEngine()
  const res = await authedFetch(`${url}/v1/version`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.version, VERSION)
  await server.close()
})

test('the recipes list endpoint reflects the library at construction', async () => {
  const { server, url } = await buildEngine()
  const res = await authedFetch(`${url}/v1/recipes`)
  assert.equal(res.status, 200)
  const data = await res.json()
  const ids = data.recipes.map((r) => r.id)
  assert.ok(ids.includes('echo'))
  assert.deepEqual(data.errors, [])
  await server.close()
})

test('the recipe detail endpoint returns the full recipe and markdown', async () => {
  const { server, url } = await buildEngine()
  const res = await authedFetch(`${url}/v1/recipes/echo`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.recipe.id, 'echo')
  assert.equal(data.recipe.version, '1.0.0')
  assert.ok(Object.hasOwn(data, 'markdown'))
  await server.close()
})

test('an unauthorized request is rejected before reaching the matcher', async () => {
  const { server, url } = await buildEngine()
  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'echo' })
  })
  assert.equal(res.status, 401)
  await server.close()
})

test('the emitted script parses as valid JavaScript when its imports are stubbed', async () => {
  const { server, url } = await buildEngine()
  const compileRes = await authedFetch(`${url}/v1/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipeId: 'echo',
      recipeVersion: '1.0.0',
      slots: { greeting: 'test' },
      botId: 'com.example.echo',
      label: 'Echo'
    })
  })
  const script = await compileRes.json()

  const encoded = Buffer.from(script.code, 'utf8').toString('base64')
  const build = new Function(`
    const defineBot = (config) => config
    const postResponse = { create: () => ({}) }
    const watchPattern = { create: () => ({}) }
    const scheduleTask = { create: () => ({}) }
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function('defineBot', 'postResponse', 'watchPattern', 'scheduleTask', cleaned)
    return fn(defineBot, postResponse, watchPattern, scheduleTask)
  `)
  const result = build()
  assert.ok(result)
  assert.equal(result.id, 'com.example.echo')
  assert.equal(result.label, 'Echo')
  assert.ok(Object.hasOwn(result, 'handlers'))

  await server.close()
})
