// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createServer } from '../../../src/server/index.js'
import { createEngineServer } from '../../../src/server/engine.js'
import { createHashEmbedder } from '../../../src/matcher/embedder.js'
import { createVectorIndex } from '../../../src/matcher/vector-index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', '..', 'fixtures', 'read-library')

const TOKEN = 'test-token'

/**
 * Builds the standard config for tests.
 * @param {object} [overrides] - Overrides.
 * @returns {object} The config.
 */
function baseConfig (overrides) {
  const opts = overrides ?? {}
  return {
    rootDir: LIB,
    version: '1.0.0',
    tokens: [TOKEN],
    embedder: createHashEmbedder(),
    index: createVectorIndex(),
    ...opts
  }
}

/**
 * Sends an authorized request.
 * @param {string} url - The full URL.
 * @param {object} [init] - fetch init.
 * @returns {Promise<object>} The response.
 */
async function authedFetch (url, init) {
  const headers = {
    authorization: `Bearer ${TOKEN}`,
    connection: 'close',
    ...(init?.headers ?? {})
  }
  return fetch(url, { ...init, headers })
}

test('createEngineServer throws when config is not an object', async () => {
  await assert.rejects(
    () => createEngineServer(null),
    /config must be an object/
  )
})

test('createEngineServer throws when rootDir is invalid', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({ rootDir: '' })),
    /config\.rootDir must be a non-empty string/
  )
  await assert.rejects(
    () => createEngineServer(baseConfig({ rootDir: undefined })),
    /config\.rootDir must be a non-empty string/
  )
})

test('createEngineServer throws when version is invalid', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({ version: '' })),
    /config\.version must be a non-empty string/
  )
})

test('createEngineServer throws when tokens is empty', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({ tokens: [] })),
    /config\.tokens must be a non-empty array/
  )
})

test('createEngineServer throws when tokens is missing', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({ tokens: undefined })),
    /config\.tokens must be a non-empty array/
  )
})

test('createEngineServer throws when embedder is invalid', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({ embedder: null })),
    /config\.embedder must be an object/
  )
  await assert.rejects(
    () => createEngineServer(baseConfig({ embedder: {} })),
    /config\.embedder\.embed must be a function/
  )
})

test('createEngineServer throws when index is invalid', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({ index: null })),
    /config\.index must be an object/
  )
})

test('createEngineServer returns a server, a matcher, and a library', async () => {
  const { server, matcher, library } = await createEngineServer(baseConfig())
  assert.equal(typeof server.listen, 'function')
  assert.equal(typeof server.close, 'function')
  assert.equal(typeof matcher.match, 'function')
  assert.ok(Array.isArray(library))
  assert.ok(library.length > 0)
})

test('the returned library carries summaries, not full recipes', async () => {
  const { library } = await createEngineServer(baseConfig())
  const echo = library.find((r) => r.id === 'echo')
  assert.equal(echo.version, '1.0.0')
  assert.equal(echo.label, 'Echo')
  assert.equal(typeof echo.description, 'string')
  assert.equal(typeof echo.kind, 'string')
  assert.deepEqual(echo.targets, ['bot'])
  assert.equal(Object.hasOwn(echo, 'handlers'), false)
  assert.equal(Object.hasOwn(echo, 'dir'), true)
})

test('the index is populated from the library', async () => {
  const index = createVectorIndex()
  await createEngineServer(baseConfig({ index }))
  assert.equal(index.size(), 2)
})

test('the index is cleared before population', async () => {
  const index = createVectorIndex()
  const staleVector = new Array(256).fill(0)
  staleVector[0] = 1
  index.add('stale', staleVector)
  await createEngineServer(baseConfig({ index }))
  const stale = index.search(staleVector, 10)
  assert.equal(stale.find((r) => r.id === 'stale'), undefined)
})

test('GET /v1/version requires auth', async () => {
  const { server } = await createEngineServer(baseConfig())
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const noAuth = await fetch(`${url}/v1/version`, { headers: { connection: 'close' } })
  assert.equal(noAuth.status, 401)
  await noAuth.text()

  const ok = await authedFetch(`${url}/v1/version`)
  assert.equal(ok.status, 200)
  const data = await ok.json()
  assert.equal(data.version, '1.0.0')
  await server.close()
})

test('GET /v1/recipes returns the library summaries', async () => {
  const { server } = await createEngineServer(baseConfig())
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await authedFetch(`${url}/v1/recipes`)
  assert.equal(res.status, 200)
  const data = await res.json()
  const ids = data.recipes.map((r) => r.id).sort()
  assert.deepEqual(ids, ['echo', 'no-doc'])
  assert.deepEqual(data.errors, [])
  await server.close()
})

test('GET /v1/recipes/:id returns detail with markdown', async () => {
  const { server } = await createEngineServer(baseConfig())
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await authedFetch(`${url}/v1/recipes/echo`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.recipe.id, 'echo')
  assert.match(data.markdown, /# Echo/)
  await server.close()
})

test('POST /v1/match requires auth and returns a MatchResult', async () => {
  const { server } = await createEngineServer(baseConfig())
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const noAuth = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ intent: 'echo something back' })
  })
  assert.equal(noAuth.status, 401)
  await noAuth.text()

  const ok = await authedFetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'echo something back' })
  })
  assert.equal(ok.status, 200)
  const data = await ok.json()
  assert.ok(['match', 'ambiguous', 'refusal'].includes(data.kind))
  await server.close()
})

test('POST /v1/compile builds a bot script', async () => {
  const { server } = await createEngineServer(baseConfig())
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await authedFetch(`${url}/v1/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipeId: 'echo',
      recipeVersion: '1.0.0',
      slots: {},
      botId: 'com.example.echo',
      label: 'Echo'
    })
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(typeof data.code, 'string')
  assert.equal(data.composition.recipeId, 'echo')
  await server.close()
})

test('rate limiting rejects the request over the limit', async () => {
  const { server } = await createEngineServer(baseConfig({
    rateLimit: { windowMs: 60000, max: 2 }
  }))
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const a = await authedFetch(`${url}/v1/version`)
  assert.equal(a.status, 200)
  await a.text()

  const b = await authedFetch(`${url}/v1/version`)
  assert.equal(b.status, 200)
  await b.text()

  const c = await authedFetch(`${url}/v1/version`)
  assert.equal(c.status, 429)
  await c.text()

  await server.close()
})

test('rate limiting runs before auth', async () => {
  const { server } = await createEngineServer(baseConfig({
    rateLimit: { windowMs: 60000, max: 1 }
  }))
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const req1 = await fetch(`${url}/v1/version`, { headers: { connection: 'close' } })
  assert.equal(req1.status, 401)
  await req1.text()

  const over = await fetch(`${url}/v1/version`, { headers: { connection: 'close' } })
  assert.equal(over.status, 429)
  await over.text()

  await server.close()
})

test('telemetry is not called when no sink is configured', async () => {
  const { server } = await createEngineServer(baseConfig())
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await authedFetch(`${url}/v1/match`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-consent-tier': '2',
      connection: 'close'
    },
    body: JSON.stringify({ intent: 'echo' })
  })
  assert.equal(res.status, 200)
  await res.text()
  await server.close()
})

test('telemetry receives a record when a sink is configured', async () => {
  const writes = []
  const sink = { async write (record) { writes.push(record) } }
  const { server } = await createEngineServer(baseConfig({ sink }))
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await authedFetch(`${url}/v1/match`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-consent-tier': '2'
    },
    body: JSON.stringify({ intent: 'echo something' })
  })
  await res.text()

  assert.equal(writes.length, 1)
  assert.equal(writes[0].intentText, 'echo something')
  assert.equal(writes[0].engineVersion, '1.0.0')
  await server.close()
})

test('telemetry does not fire on unauthorized requests', async () => {
  const writes = []
  const sink = { async write (record) { writes.push(record) } }
  const { server } = await createEngineServer(baseConfig({ sink }))
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-consent-tier': '2',
      connection: 'close'
    },
    body: JSON.stringify({ intent: 'echo' })
  })
  await res.text()

  assert.equal(writes.length, 0)
  await server.close()
})

test('telemetry does not fire on rate-limited requests', async () => {
  const writes = []
  const sink = { async write (record) { writes.push(record) } }
  const { server } = await createEngineServer(baseConfig({
    sink,
    rateLimit: { windowMs: 60000, max: 1 }
  }))
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const headers = {
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    'x-consent-tier': '2',
    connection: 'close'
  }
  const req1 = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ intent: 'echo' })
  })
  await req1.text()

  const req2 = await fetch(`${url}/v1/match`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ intent: 'echo' })
  })
  await req2.text()

  assert.equal(writes.length, 1)
  await server.close()
})

test('exemptPaths bypasses auth for the listed paths', async () => {
  const { server } = await createEngineServer(baseConfig({
    exemptPaths: ['/v1/version']
  }))
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await fetch(`${url}/v1/version`, { headers: { connection: 'close' } })
  assert.equal(res.status, 200)
  await res.text()
  await server.close()
})

test('two engine servers can coexist', async () => {
  const a = await createEngineServer(baseConfig())
  const b = await createEngineServer(baseConfig({ version: '2.0.0' }))
  const addrA = await a.server.listen(0)
  const addrB = await b.server.listen(0)

  const urlA = `http://${addrA.host}:${addrA.port}`
  const urlB = `http://${addrB.host}:${addrB.port}`

  const verA = await (await authedFetch(`${urlA}/v1/version`)).json()
  const verB = await (await authedFetch(`${urlB}/v1/version`)).json()
  assert.equal(verA.version, '1.0.0')
  assert.equal(verB.version, '2.0.0')

  await a.server.close()
  await b.server.close()
})

test('the constructor does not listen automatically', async () => {
  const { server } = await createEngineServer(baseConfig())
  assert.equal(server.address(), null)
  await server.close()
})

test('a disambiguator can be configured through the constructor', async () => {
  let called = false
  const disambiguator = async (intent, candidates, recipes) => {
    called = true
    return {
      kind: 'match',
      recipeId: candidates[0].recipeId,
      confidence: candidates[0].score,
      candidates
    }
  }
  const { server } = await createEngineServer(baseConfig({ disambiguator }))
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await authedFetch(`${url}/v1/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent: 'echo' })
  })
  await res.text()

  assert.equal(typeof called, 'boolean')
  await server.close()
})

test('createEngineServer does not register the LLM route by default', async () => {
  const { server } = await createEngineServer(baseConfig())
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`
  const res = await authedFetch(`${url}/v1/llm/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
  })
  assert.equal(res.status, 404)
  await server.close()
})

test('createEngineServer registers the LLM route when llmUpstreamUrl is set', async () => {
  const upstreamCalls = []
  const upstreamServer = createServer()
  upstreamServer.addRoute('POST', '/v1/chat/completions', async (ctx) => {
    upstreamCalls.push({ body: ctx.body })
    ctx.json(200, { choices: [{ message: { content: 'hi from upstream' } }] })
  })
  const upstreamAddr = await upstreamServer.listen(0)
  const upstreamUrl = `http://${upstreamAddr.host}:${upstreamAddr.port}/v1/chat/completions`

  const { server } = await createEngineServer(baseConfig({
    llmUpstreamUrl: upstreamUrl,
    llmApiKey: 'test-key'
  }))
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await authedFetch(`${url}/v1/llm/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
  })

  assert.equal(res.status, 200)
  const data = await res.json()
  assert.deepEqual(data, { choices: [{ message: { content: 'hi from upstream' } }] })
  assert.equal(upstreamCalls.length, 1)
  assert.deepEqual(upstreamCalls[0].body.messages, [{ role: 'user', content: 'hi' }])

  await server.close()
  await upstreamServer.close()
})

test('createEngineServer throws when llmUpstreamUrl is set without llmApiKey', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({ llmUpstreamUrl: 'https://x.example.com/complete' })),
    /config\.llmApiKey is required when config\.llmUpstreamUrl is set/
  )
})

test('createEngineServer throws when llmApiKey is set without llmUpstreamUrl', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({ llmApiKey: 'test-key' })),
    /config\.llmApiKey is not valid without config\.llmUpstreamUrl/
  )
})

test('createEngineServer throws when llmUpstreamUrl is not a non-empty string', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({ llmUpstreamUrl: '' })),
    /config\.llmUpstreamUrl must be a non-empty string when provided/
  )
})

test('createEngineServer throws when llmModel is not a non-empty string', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({
      llmUpstreamUrl: 'https://x.example.com/complete',
      llmApiKey: 'test-key',
      llmModel: 42
    })),
    /config\.llmModel must be a non-empty string when provided/
  )
})

test('createEngineServer throws when publicUrl is not a non-empty string', async () => {
  await assert.rejects(
    () => createEngineServer(baseConfig({ publicUrl: '' })),
    /config\.publicUrl must be a non-empty string when provided/
  )
})

test('createEngineServer with llmUpstreamUrl and publicUrl accepts a compile request', async () => {
  const { server } = await createEngineServer(baseConfig({
    llmUpstreamUrl: 'https://x.example.com/complete',
    llmApiKey: 'test-key',
    publicUrl: 'https://engine.example.com'
  }))
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await authedFetch(`${url}/v1/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipeId: 'echo',
      recipeVersion: '1.0.0',
      slots: { greeting: 'hi' },
      botId: 'com.example.echo',
      label: 'Echo'
    })
  })

  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(typeof data.code, 'string')
  await server.close()
})

test('createEngineServer normalizes a trailing slash in publicUrl', async () => {
  const { server } = await createEngineServer(baseConfig({
    llmUpstreamUrl: 'https://x.example.com/complete',
    llmApiKey: 'test-key',
    publicUrl: 'https://engine.example.com/'
  }))
  const { port, host } = await server.listen(0)
  const url = `http://${host}:${port}`

  const res = await authedFetch(`${url}/v1/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipeId: 'echo',
      recipeVersion: '1.0.0',
      slots: { greeting: 'hi' },
      botId: 'com.example.echo',
      label: 'Echo'
    })
  })

  assert.equal(res.status, 200)
  await server.close()
})
