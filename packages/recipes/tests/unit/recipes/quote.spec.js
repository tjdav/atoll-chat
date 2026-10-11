// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compile } from '../../../src/compiler/index.js'
import { loadRecipeById, scanLibrary } from '../../../src/recipe/library.js'
import { substitute } from '../../../src/lib/substitute.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB_ROOT = join(HERE, '..', '..', '..', 'recipes')

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
 * Loads the emitted bot.js source against stubbed primitives.
 * `httpFetch` returns whatever the configured `responses` map
 * contains for a URL. `replyLocal` and `exposeCommand` mirror the
 * real primitives.
 *
 * @param {string} code - The emitted bot.js source.
 * @param {Record<string, unknown>} responses - URL → response body.
 * @returns {{ config: object, fetches: string[] }} The bot config
 *   and a record of URLs the fetch stub was asked for.
 */
function loadEmittedBot (code, responses) {
  const fetches = []

  const defineBot = (config) => config

  const asCommandDecl = (name, description, argsDecl, handler) => {
    const decl = {
      name,
      args: argsDecl,
      handler: async (ctx, argsReader) => {
        const argsObject = {}
        for (const key of Object.keys(argsDecl ?? {})) {
          argsObject[key] = argsReader.get(key)
        }
        const result = await handler(ctx, { args: argsObject, command: name })
        if (result === undefined) {
          return { type: 'none' }
        }
        return result
      }
    }
    if (description !== undefined) {
      decl.description = description
    }
    return decl
  }

  const postResponse = {
    create (config, children) {
      return async (ctx, input) => {
        for (const child of children ?? []) {
          await child(ctx, input)
        }
      }
    }
  }

  const httpFetch = {
    create (config, children) {
      const responseMode = config.responseMode === undefined ? 'json' : config.responseMode
      return async (ctx, input) => {
        const url = substitute(config.url, input)
        fetches.push(url)
        if (!Object.hasOwn(responses, url)) {
          throw new Error(`http-fetch: no mock response for ${url}`)
        }
        const raw = responses[url]
        let output
        if (responseMode === 'status') {
          output = 200
        } else if (responseMode === 'text') {
          output = typeof raw === 'string' ? raw : JSON.stringify(raw)
        } else {
          output = typeof raw === 'string' ? JSON.parse(raw) : raw
        }
        let lastResult
        for (const child of children ?? []) {
          lastResult = await child(ctx, output)
        }
        return lastResult
      }
    }
  }

  const replyLocal = {
    create (config) {
      const text = config.text
      return async (ctx, input) => {
        const resolved = substitute(text, input)
        return { type: 'local_message', content: String(resolved) }
      }
    }
  }

  const exposeCommand = {
    create (config, children) {
      return async (ctx, input) => {
        let lastResult
        for (const child of children ?? []) {
          lastResult = await child(ctx, input)
        }
        return lastResult
      }
    }
  }

  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const buildFn = new Function(
    'defineBot',
    'asCommandDecl',
    'postResponse',
    'httpFetch',
    'replyLocal',
    'exposeCommand',
    `
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function(
      'defineBot',
      'asCommandDecl',
      'postResponse',
      'httpFetch',
      'replyLocal',
      'exposeCommand',
      cleaned
    )
    return fn(defineBot, asCommandDecl, postResponse, httpFetch, replyLocal, exposeCommand)
  `
  )

  const config = buildFn(defineBot, asCommandDecl, postResponse, httpFetch, replyLocal, exposeCommand)
  return { config, fetches }
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
  const script = await build('https://example.com/quotes')
  const fetchInstance = script.composition.commands.quote.children[0]
  assert.equal(fetchInstance.primitive, 'http-fetch')
  assert.equal(fetchInstance.config.url, 'https://example.com/quotes')
})

test('the recipe default endpoint is used when the slot is not provided', async () => {
  const script = await build()
  const fetchInstance = script.composition.commands.quote.children[0]
  assert.equal(fetchInstance.config.url, 'https://api.quotable.io/random')
})

test('the emitted code contains the expected primitives', async () => {
  const script = await build()
  assert.match(script.code, /const commands = \{/)
  assert.match(script.code, /httpFetch\.create\(/)
  assert.match(script.code, /replyLocal\.create\(/)
  assert.match(script.code, /asCommandDecl\(/)
  assert.match(script.code, /Recipe: quote@1\.0\.0/)
  assert.match(script.code, /id: "com\.example\.quote"/)
})

test('the emitted bot exposes the quote command with a handler', async () => {
  const script = await build('https://example.com/quotes')
  const { config } = loadEmittedBot(script.code, {})
  assert.ok(config.commands.quote)
  assert.equal(typeof config.commands.quote.handler, 'function')
  assert.equal(config.commands.quote.description, 'Fetch a random quote.')
})

test('the command handler fetches the configured URL and replies privately with content and author', async () => {
  const script = await build('https://example.com/quotes')
  const { config, fetches } = loadEmittedBot(script.code, {
    'https://example.com/quotes': {
      content: 'The only way out is through.',
      author: 'Robert Frost'
    }
  })

  const reader = makeReader({})
  const result = await config.commands.quote.handler({}, reader)

  assert.deepEqual(fetches, ['https://example.com/quotes'])
  assert.deepEqual(result, {
    type: 'local_message',
    content: '"The only way out is through." — Robert Frost'
  })
})

test('the command handler parses a JSON string body returned by the fetch stub', async () => {
  const script = await build('https://example.com/quotes')
  const { config } = loadEmittedBot(script.code, {
    'https://example.com/quotes': '{"content":"Short.","author":"Anonymous"}'
  })

  const result = await config.commands.quote.handler({}, makeReader({}))
  assert.deepEqual(result, {
    type: 'local_message',
    content: '"Short." — Anonymous'
  })
})

test('the command handler throws when the endpoint response lacks the expected fields', async () => {
  const script = await build('https://example.com/quotes')
  const { config } = loadEmittedBot(script.code, {
    'https://example.com/quotes': { other: 'shape' }
  })

  await assert.rejects(
    () => config.commands.quote.handler({}, makeReader({})),
    /path "content" is not resolvable/
  )
})

test('the command handler throws when the endpoint is unreachable in the stub', async () => {
  const script = await build('https://example.com/quotes')
  const { config } = loadEmittedBot(script.code, {})

  await assert.rejects(
    () => config.commands.quote.handler({}, makeReader({})),
    /no mock response for https:\/\/example\.com\/quotes/
  )
})

test('the emitted code is deterministic', async () => {
  const first = await build('https://example.com/quotes')
  const second = await build('https://example.com/quotes')
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
