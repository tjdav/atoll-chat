// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compile } from '../../../src/compiler/index.js'
import { loadRecipeById, scanLibrary } from '../../../src/recipe/library.js'
import { loadEmittedBot } from './_helpers/load-emitted-bot.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB_ROOT = join(HERE, '..', '..', '..', 'recipes')

const TEST_ENDPOINT = 'https://example.com/quotes'

/**
 * Compiles the quote recipe with a test endpoint.
 * @param {string} [endpoint] - Endpoint override.
 * @returns {Promise<object>} The BotScript.
 */
async function build (endpoint) {
  return compile(
    LIB_ROOT,
    {
      recipeId: 'quote',
      recipeVersion: '1.0.0',
      slots: endpoint === undefined ? {} : { endpoint }
    },
    { botId: 'com.example.quote', label: 'Quote' }
  )
}

/**
 * Builds a Response-shaped object for the shared helper's fetch stub.
 * @param {unknown} body - The response body. Objects are JSON-encoded.
 * @param {number} [status] - HTTP status. Defaults to 200.
 * @returns {object} A Response-shaped object.
 */
function makeResponse (body, status) {
  const resolvedStatus = status === undefined ? 200 : status
  return {
    ok: resolvedStatus >= 200 && resolvedStatus < 300,
    status: resolvedStatus,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  }
}

/**
 * Builds a mock ArgsReader.
 * @param {Record<string, unknown>} values - The backing values.
 * @returns {object} A reader-shaped object.
 */
function makeReader (values) {
  return { get: (key) => values[key] }
}

test('the recipe is present in the library and validates', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'quote')
  assert.equal(recipe.id, 'quote')
  assert.equal(recipe.version, '1.0.0')
  assert.equal(recipe.kind, 'pure')
})

test('the recipe declares exactly one slot for the endpoint', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'quote')
  assert.equal(recipe.slots.length, 1)
  assert.equal(recipe.slots[0].name, 'endpoint')
  assert.equal(recipe.slots[0].type, 'string')
  assert.equal(recipe.slots[0].default, 'https://api.quotable.io/random')
})

test('the recipe declares the quote command', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'quote')
  const names = Object.keys(recipe.commands)
  assert.deepEqual(names, ['quote'])
  assert.equal(recipe.commands.quote.config.name, 'quote')
})

test('the recipe declares the capabilities its primitives require', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'quote')
  assert.ok(recipe.capabilities.includes('read_commands'))
  assert.ok(recipe.capabilities.includes('post_message'))
})

test('the recipe compiles without error', async () => {
  const script = await build()
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'quote')
  assert.ok(script.composition.commands.quote)
})

test('the slot value is substituted into the http-fetch config at compose time', async () => {
  const script = await build(TEST_ENDPOINT)
  const fetchInstance = script.composition.commands.quote.children[0]
  assert.equal(fetchInstance.primitive, 'http-fetch')
  assert.equal(fetchInstance.config.url, TEST_ENDPOINT)
})

test('the recipe default endpoint is used when the slot is not provided', async () => {
  const script = await build()
  const fetchInstance = script.composition.commands.quote.children[0]
  assert.equal(fetchInstance.config.url, 'https://api.quotable.io/random')
})

test('the emitted code contains the expected primitives', async () => {
  const script = await build(TEST_ENDPOINT)
  assert.match(script.code, /const commands = \{/)
  assert.match(script.code, /httpFetch\.create\(/)
  assert.match(script.code, /replyLocal\.create\(/)
  assert.match(script.code, /asCommandDecl\(/)
  assert.match(script.code, /Recipe: quote@1\.0\.0/)
  assert.match(script.code, /id: "com\.example\.quote"/)
})

test('the emitted bot exposes the quote command with a handler', async () => {
  const script = await build(TEST_ENDPOINT)
  const { config } = loadEmittedBot(script.code, { responses: {} })
  assert.ok(config.commands.quote)
  assert.equal(typeof config.commands.quote.handler, 'function')
  assert.equal(config.commands.quote.description, 'Fetch a random quote.')
})

test('the command handler fetches the configured URL and replies privately with content and author', async () => {
  const script = await build(TEST_ENDPOINT)
  const { config, ctx, fetches } = loadEmittedBot(script.code, {
    responses: {
      [TEST_ENDPOINT]: makeResponse({
        content: 'The only way out is through.',
        author: 'Robert Frost'
      })
    }
  })
  const reader = makeReader({})
  const result = await config.commands.quote.handler(ctx, reader)
  assert.equal(fetches.length, 1)
  assert.equal(fetches[0].url, TEST_ENDPOINT)
  assert.deepEqual(result, {
    type: 'local_message',
    content: '"The only way out is through." — Robert Frost'
  })
})

test('the command handler parses a JSON string body returned by the fetch stub', async () => {
  const script = await build(TEST_ENDPOINT)
  const { config, ctx } = loadEmittedBot(script.code, {
    responses: {
      [TEST_ENDPOINT]: makeResponse('{"content":"Short.","author":"Anonymous"}')
    }
  })
  const result = await config.commands.quote.handler(ctx, makeReader({}))
  assert.deepEqual(result, {
    type: 'local_message',
    content: '"Short." — Anonymous'
  })
})

test('the command handler throws when the endpoint response lacks the expected fields', async () => {
  const script = await build(TEST_ENDPOINT)
  const { config, ctx } = loadEmittedBot(script.code, {
    responses: {
      [TEST_ENDPOINT]: makeResponse({ other: 'shape' })
    }
  })
  await assert.rejects(
    () => config.commands.quote.handler(ctx, makeReader({})),
    /path "content" is not resolvable/
  )
})

test('the command handler throws when the endpoint is not configured in the stub', async () => {
  const script = await build(TEST_ENDPOINT)
  const { config, ctx } = loadEmittedBot(script.code, { responses: {} })
  await assert.rejects(
    () => config.commands.quote.handler(ctx, makeReader({})),
    /no mock response for https:\/\/example\.com\/quotes/
  )
})

test('the command handler throws on a non-2xx response', async () => {
  const script = await build(TEST_ENDPOINT)
  const { config, ctx } = loadEmittedBot(script.code, {
    responses: {
      [TEST_ENDPOINT]: makeResponse('Not found', 404)
    }
  })
  await assert.rejects(
    () => config.commands.quote.handler(ctx, makeReader({})),
    /request failed with status 404/
  )
})

test('the command handler throws on a malformed JSON body', async () => {
  const script = await build(TEST_ENDPOINT)
  const { config, ctx } = loadEmittedBot(script.code, {
    responses: {
      [TEST_ENDPOINT]: makeResponse('not json')
    }
  })
  await assert.rejects(
    () => config.commands.quote.handler(ctx, makeReader({})),
    /response is not valid JSON/
  )
})

test('the install handler posts a fixed public message', async () => {
  const script = await build(TEST_ENDPOINT)
  const { config, ctx, posts } = loadEmittedBot(script.code, { responses: {} })
  await config.handlers.install(ctx, {})
  assert.equal(posts.length, 1)
  assert.match(posts[0].text, /Quote is ready/)
})

test('the emitted code is deterministic', async () => {
  const first = await build(TEST_ENDPOINT)
  const second = await build(TEST_ENDPOINT)
  assert.equal(first.code, second.code)
})

test('the library scans cleanly with quote present', async () => {
  const { recipes, errors } = await scanLibrary(LIB_ROOT)
  const ids = recipes.map((r) => r.id).sort()
  assert.ok(ids.includes('quote'))
  assert.ok(ids.includes('keyword-alert'))
  assert.ok(ids.includes('echo-command'))
  assert.ok(ids.includes('notes'))
  assert.deepEqual(errors, [])
})
