// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createEngineServer } from '../../src/server/index.js'
import { createHashEmbedder } from '../../src/matcher/embedder.js'
import { createVectorIndex } from '../../src/matcher/vector-index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB_ROOT = join(HERE, '..', '..', 'recipes')

const TOKEN = 'library-integration-token'
const VERSION = '0.0.0-test'

/**
 * Builds a fully-wired engine server against the shipped recipe
 * library.
 * @returns {Promise<{ server: object, url: string }>} The server and
 *   its base URL.
 */
async function buildEngine () {
  const { server } = await createEngineServer({
    rootDir: LIB_ROOT,
    version: VERSION,
    tokens: [TOKEN],
    embedder: createHashEmbedder(),
    index: createVectorIndex()
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

/**
 * Returns true when a recipe summary declares no required slot
 * without a default.
 *
 * The read endpoint does not include slot declarations in its
 * summary. The test fetches the full recipe for each id to make
 * this determination.
 * @param {object} recipe - The full recipe.
 * @returns {boolean} True when the recipe can compile with no slots.
 */
function hasRequiredSlots (recipe) {
  for (const slot of recipe.slots) {
    if (slot.required === true && !Object.hasOwn(slot, 'default')) {
      return true
    }
  }
  return false
}

test('the library scans cleanly through the engine constructor', async () => {
  const { server, url } = await buildEngine()
  const res = await authedFetch(`${url}/v1/recipes`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.deepEqual(data.errors, [])
  assert.ok(data.recipes.length >= 8)
  await server.close()
})

test('the library contains the expected recipe ids', async () => {
  const { server, url } = await buildEngine()
  const res = await authedFetch(`${url}/v1/recipes`)
  const data = await res.json()
  const ids = data.recipes.map((r) => r.id).sort()
  for (const expected of [
    'daily-reminder',
    'echo-command',
    'keyword-alert',
    'notes',
    'quote',
    'room-topic',
    'sticky',
    'webhook-notify'
  ]) {
    assert.ok(ids.includes(expected), `expected ${expected} in library`)
  }
  await server.close()
})

test('every recipe detail request returns a full recipe', async () => {
  const { server, url } = await buildEngine()
  const list = await (await authedFetch(`${url}/v1/recipes`)).json()

  for (const summary of list.recipes) {
    const res = await authedFetch(`${url}/v1/recipes/${summary.id}`)
    assert.equal(res.status, 200, `${summary.id} should return 200`)
    const data = await res.json()
    assert.equal(data.recipe.id, summary.id)
    assert.equal(data.recipe.version, summary.version)
    assert.ok(Array.isArray(data.recipe.slots))
  }
  await server.close()
})

test('every recipe without required slots compiles', async () => {
  const { server, url } = await buildEngine()
  const list = await (await authedFetch(`${url}/v1/recipes`)).json()

  const compiled = []
  const skipped = []

  for (const summary of list.recipes) {
    const detail = await (await authedFetch(`${url}/v1/recipes/${summary.id}`)).json()
    if (hasRequiredSlots(detail.recipe)) {
      skipped.push(summary.id)
      continue
    }

    const res = await authedFetch(`${url}/v1/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipeId: summary.id,
        recipeVersion: summary.version,
        slots: {},
        botId: `com.example.${summary.id}`,
        label: summary.label
      })
    })

    const bodyText = await res.text()
    assert.equal(
      res.status,
      200,
      `${summary.id} should compile; got ${res.status}: ${bodyText}`
    )
    const data = JSON.parse(bodyText)
    assert.equal(typeof data.code, 'string')
    assert.equal(data.composition.recipeId, summary.id)
    compiled.push(summary.id)
  }

  assert.ok(compiled.length >= 7, `expected at least 7 compilable recipes, got ${compiled.length}`)
  assert.ok(skipped.includes('daily-reminder'), 'daily-reminder requires a slot')
  await server.close()
})

test('every compiled recipe emits parseable JavaScript', async () => {
  const { server, url } = await buildEngine()
  const list = await (await authedFetch(`${url}/v1/recipes`)).json()

  for (const summary of list.recipes) {
    const detail = await (await authedFetch(`${url}/v1/recipes/${summary.id}`)).json()
    if (hasRequiredSlots(detail.recipe)) {
      continue
    }

    const res = await authedFetch(`${url}/v1/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipeId: summary.id,
        recipeVersion: summary.version,
        slots: {},
        botId: `com.example.${summary.id}`,
        label: summary.label
      })
    })
    const data = await res.json()

    const encoded = Buffer.from(data.code, 'utf8').toString('base64')
    const buildFn = new Function(`
      const defineBot = (config) => config
      const stub = { create: () => (() => {}) }
      const asCommandDecl = (name, description, argsDecl, handler) => ({ name, description, argsDecl, handler })
      const src = Buffer.from('${encoded}', 'base64').toString('utf8')
      const cleaned = src
        .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
        .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
        .replace('export default defineBot', 'return defineBot')
      const fn = new Function(
        'defineBot',
        'asCommandDecl',
        'postResponse',
        'sendLocal',
        'replyLocal',
        'watchPattern',
        'keyedStore',
        'exposeCommand',
        'scheduleTask',
        'webhookReceive',
        'httpFetch',
        'settingsRead',
        'settingsWrite',
        'transform',
        'llmComplete',
        cleaned
      )
      return fn(
        defineBot,
        asCommandDecl,
        stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub
      )
    `)

    const parsed = buildFn()
    assert.ok(parsed, `${summary.id} should parse as JavaScript`)
    assert.equal(parsed.id, `com.example.${summary.id}`)
  }
  await server.close()
})

test('each compiled recipe preserves the recipe provenance comment', async () => {
  const { server, url } = await buildEngine()
  const list = await (await authedFetch(`${url}/v1/recipes`)).json()

  for (const summary of list.recipes) {
    const detail = await (await authedFetch(`${url}/v1/recipes/${summary.id}`)).json()
    if (hasRequiredSlots(detail.recipe)) {
      continue
    }

    const res = await authedFetch(`${url}/v1/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipeId: summary.id,
        recipeVersion: summary.version,
        slots: {},
        botId: `com.example.${summary.id}`,
        label: summary.label
      })
    })
    const data = await res.json()
    assert.match(
      data.code,
      new RegExp(`Recipe: ${summary.id}@${summary.version.replace(/\./g, '\\.')}`)
    )
  }
  await server.close()
})

test('the match endpoint reaches the library', async () => {
  const { server, url } = await buildEngine()
  const res = await authedFetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'echo a message back to me' })
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.ok(['match', 'ambiguous', 'refusal'].includes(data.kind))
  await server.close()
})

test('two engine instances against the same library produce identical compilations', async () => {
  const a = await buildEngine()
  const b = await buildEngine()

  const body = JSON.stringify({
    recipeId: 'echo-command',
    recipeVersion: '1.0.0',
    slots: {},
    botId: 'com.example.echo-command',
    label: 'Echo'
  })

  const first = await (await authedFetch(`${a.url}/v1/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  })).json()
  const second = await (await authedFetch(`${b.url}/v1/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  })).json()

  assert.equal(first.code, second.code)
  await a.server.close()
  await b.server.close()
})
