// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compile } from '../../../src/compiler/index.js'
import { loadRecipeById, scanLibrary } from '../../../src/recipe/library.js'
import { substitute } from '../../../src/lib/substitute.js'
import { readPath } from '../../../src/lib/path.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB_ROOT = join(HERE, '..', '..', '..', 'recipes')

/**
 * Compiles the webhook-notify recipe with a test path.
 * @param {string} [path] - Webhook path override.
 * @returns {Promise<object>} The BotScript.
 */
async function build (path) {
  return compile(
    LIB_ROOT,
    {
      recipeId: 'webhook-notify',
      recipeVersion: '1.0.0',
      slots: path === undefined ? {} : { path }
    },
    { botId: 'com.example.webhook-notify', label: 'Webhook Notify' }
  )
}

/**
 * Loads the emitted bot.js source against stubbed primitives. The
 * stubs mirror the real primitives: `webhookReceive` dispatches the
 * payload, `transform` performs pick/json, `sendLocal` records calls.
 *
 * @param {string} code - The emitted bot.js source.
 * @returns {{ config: object, localMessages: object[] }} The bot
 *   config and a record of send-local calls.
 */
function loadEmittedBot (code) {
  const localMessages = []

  const defineBot = (config) => config

  const webhookReceive = {
    create (config, children) {
      const fallbackPath = config.path
      return async (ctx, input) => {
        if (!input || typeof input !== 'object') {
          return undefined
        }
        const body = input.body
        const headers = input.headers
        const payload = {
          path: typeof input.path === 'string' ? input.path : fallbackPath,
          body: typeof body === 'string' ? body : '',
          headers: headers && typeof headers === 'object' ? headers : {}
        }
        let lastResult
        for (const child of children ?? []) {
          lastResult = await child(ctx, payload)
        }
        return lastResult
      }
    }
  }

  const transform = {
    create (config, children) {
      const op = config.op
      const path = config.path
      return async (ctx, input) => {
        let output
        if (op === 'json') {
          output = JSON.parse(input)
        } else if (op === 'pick') {
          output = readPath(input, path)
        } else {
          throw new Error(`transform stub: unsupported op ${op}`)
        }
        let lastResult
        for (const child of children ?? []) {
          lastResult = await child(ctx, output)
        }
        return lastResult
      }
    }
  }

  const sendLocal = {
    create (config) {
      const text = config.text
      return async (ctx, input) => {
        const resolved = substitute(text, input)
        const opts = { text: String(resolved) }
        localMessages.push(opts)
        if (typeof ctx.sendLocal === 'function') {
          await ctx.sendLocal(opts)
        }
        return undefined
      }
    }
  }

  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const buildFn = new Function(
    'defineBot',
    'webhookReceive',
    'transform',
    'sendLocal',
    `
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import\\s*\\{[\\s\\S]*?\\}\\s*from\\s*['"]@atoll\\/bot['"]/, '')
      .replace(/import\\s*\\{[\\s\\S]*?\\}\\s*from\\s*['"]@atoll\\/recipes\\/primitives['"]/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function(
      'defineBot',
      'webhookReceive',
      'transform',
      'sendLocal',
      cleaned
    )
    return fn(defineBot, webhookReceive, transform, sendLocal)
  `
  )

  const config = buildFn(defineBot, webhookReceive, transform, sendLocal)
  return { config, localMessages }
}

test('the recipe is present in the library and validates', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'webhook-notify')
  assert.equal(recipe.id, 'webhook-notify')
  assert.equal(recipe.version, '1.0.0')
  assert.equal(recipe.kind, 'pure')
})

test('the recipe declares exactly one slot for the path', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'webhook-notify')
  assert.equal(recipe.slots.length, 1)
  assert.equal(recipe.slots[0].name, 'path')
  assert.equal(recipe.slots[0].type, 'string')
  assert.equal(recipe.slots[0].default, '/hooks/notify')
})

test('the recipe declares a webhook handler', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'webhook-notify')
  assert.ok(recipe.handlers.webhook)
  assert.equal(recipe.handlers.webhook.primitive, 'webhook-receive')
})

test('the recipe declares no commands and no triggers', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'webhook-notify')
  assert.equal(recipe.commands, undefined)
  assert.equal(recipe.triggers, undefined)
})

test('the recipe declares an empty capabilities array', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'webhook-notify')
  assert.deepEqual(recipe.capabilities, [])
})

test('the recipe compiles without error', async () => {
  const script = await build()
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'webhook-notify')
  assert.equal(script.composition.target, 'bot')
  assert.deepEqual(script.composition.capabilities, [])
})

test('the slot is substituted into the webhook path config at compose time', async () => {
  const script = await build('/custom/path')
  const handler = script.composition.handlers.webhook
  assert.equal(handler.primitive, 'webhook-receive')
  assert.equal(handler.config.path, '/custom/path')
  assert.equal(handler.config.method, 'POST')
})

test('the recipe default path is used when the slot is not provided', async () => {
  const script = await build()
  const handler = script.composition.handlers.webhook
  assert.equal(handler.config.path, '/hooks/notify')
})

test('the composition nests transform and send-local under the webhook trigger', async () => {
  const script = await build()
  const handler = script.composition.handlers.webhook
  assert.equal(handler.children.length, 1)
  const pick = handler.children[0]
  assert.equal(pick.primitive, 'transform')
  assert.equal(pick.config.op, 'pick')
  assert.equal(pick.config.path, 'body')
  assert.equal(pick.children.length, 1)
  const json = pick.children[0]
  assert.equal(json.primitive, 'transform')
  assert.equal(json.config.op, 'json')
  assert.equal(json.children.length, 1)
  const notify = json.children[0]
  assert.equal(notify.primitive, 'send-local')
  assert.equal(notify.config.text, 'Webhook received: {{message}}')
})

test('the emitted code contains the expected primitives', async () => {
  const script = await build()
  assert.match(script.code, /webhookReceive\.create\(/)
  assert.match(script.code, /transform\.create\(/)
  assert.match(script.code, /sendLocal\.create\(/)
  assert.match(script.code, /Recipe: webhook-notify@1\.0\.0/)
  assert.match(script.code, /id: "com\.example\.webhook-notify"/)
  assert.doesNotMatch(script.code, /const commands = \{/)
})

test('the emitted bot exposes the webhook handler', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)
  assert.ok(config.handlers.webhook)
  assert.equal(typeof config.handlers.webhook, 'function')
})

test('a webhook hit delivers the message field to the owner via send-local', async () => {
  const script = await build()
  const { config, localMessages } = loadEmittedBot(script.code)

  const payload = {
    path: '/hooks/notify',
    body: JSON.stringify({ message: 'Deploy succeeded' }),
    headers: { 'content-type': 'application/json' }
  }
  await config.handlers.webhook({}, payload)

  assert.equal(localMessages.length, 1)
  assert.equal(localMessages[0].text, 'Webhook received: Deploy succeeded')
})

test('a webhook hit ignores extra fields in the JSON body', async () => {
  const script = await build()
  const { config, localMessages } = loadEmittedBot(script.code)

  await config.handlers.webhook({}, {
    path: '/hooks/notify',
    body: JSON.stringify({ message: 'Hi', service: 'api', ts: 12345 }),
    headers: {}
  })

  assert.equal(localMessages.length, 1)
  assert.equal(localMessages[0].text, 'Webhook received: Hi')
})

test('a webhook hit throws when the body is not valid JSON', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)

  await assert.rejects(
    () => config.handlers.webhook({}, {
      path: '/hooks/notify',
      body: 'not json',
      headers: {}
    }),
    /JSON/
  )
})

test('a webhook hit throws when the JSON body has no message field', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)

  await assert.rejects(
    () => config.handlers.webhook({}, {
      path: '/hooks/notify',
      body: JSON.stringify({ other: 'field' }),
      headers: {}
    }),
    /path "message" is not resolvable/
  )
})

test('a webhook hit with no body throws', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)

  await assert.rejects(
    () => config.handlers.webhook({}, { path: '/hooks/notify', headers: {} }),
    /JSON/
  )
})

test('the emitted code is deterministic', async () => {
  const first = await build()
  const second = await build()
  assert.equal(first.code, second.code)
})

test('the library scans cleanly with webhook-notify present', async () => {
  const { recipes, errors } = await scanLibrary(LIB_ROOT)
  const ids = recipes.map((r) => r.id).sort()
  assert.ok(ids.includes('webhook-notify'))
  assert.ok(ids.includes('keyword-alert'))
  assert.ok(ids.includes('echo-command'))
  assert.ok(ids.includes('notes'))
  assert.ok(ids.includes('quote'))
  assert.deepEqual(errors, [])
})
