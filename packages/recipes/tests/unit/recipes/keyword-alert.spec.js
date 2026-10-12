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

/**
 * Compiles the keyword-alert recipe with a test keyword.
 * @param {string} [keyword] - Keyword override.
 * @returns {Promise<object>} The BotScript.
 */
async function build (keyword) {
  return compile(
    LIB_ROOT,
    {
      recipeId: 'keyword-alert',
      recipeVersion: '1.0.0',
      slots: keyword === undefined ? {} : { keyword }
    },
    { botId: 'com.example.keyword-alert', label: 'Keyword Alert' }
  )
}

/**
 * Builds a synthetic message event.
 * @param {string} plaintext - The message text.
 * @returns {object} An event-shaped object.
 */
function makeEvent (plaintext) {
  return {
    id: 'e_1',
    type: 'message.new',
    roomId: 'r_default',
    timestamp: '2026-01-01T00:00:00.000Z',
    data: {
      id: 'm_1',
      senderUserId: 'u_1',
      senderClientId: 'c_1',
      createdAt: '2026-01-01T00:00:00.000Z',
      plaintext,
      attachments: [],
      replyTo: null
    }
  }
}

/**
 * Builds a synthetic observer-mode event with no plaintext.
 * @returns {object} An event-shaped object.
 */
function makeObserverEvent () {
  return {
    id: 'e_2',
    type: 'message.new',
    roomId: 'r_default',
    timestamp: '2026-01-01T00:00:00.000Z',
    data: {
      id: 'm_2',
      senderUserId: 'u_1',
      senderClientId: 'c_1',
      createdAt: '2026-01-01T00:00:00.000Z',
      sizeBytes: 512
    }
  }
}

test('the recipe is present in the library', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'keyword-alert')
  assert.equal(recipe.id, 'keyword-alert')
  assert.equal(recipe.version, '1.0.0')
  assert.equal(recipe.kind, 'pure')
  assert.equal(typeof recipe.label, 'string')
  assert.equal(typeof recipe.description, 'string')
})

test('the recipe declares the expected capabilities', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'keyword-alert')
  assert.ok(recipe.capabilities.includes('read_content'))
  assert.ok(recipe.capabilities.includes('post_message'))
})

test('the recipe declares exactly one slot', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'keyword-alert')
  assert.equal(recipe.slots.length, 1)
  assert.equal(recipe.slots[0].name, 'keyword')
  assert.equal(recipe.slots[0].type, 'string')
})

test('the recipe has a message handler using watch-pattern', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'keyword-alert')
  assert.ok(recipe.handlers.message)
  assert.equal(recipe.handlers.message.primitive, 'watch-pattern')
  assert.equal(recipe.handlers.message.children.length, 1)
  assert.equal(recipe.handlers.message.children[0].primitive, 'post-response')
})

test('the recipe compiles without error', async () => {
  const script = await build('urgent')
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'keyword-alert')
  assert.equal(script.composition.recipeVersion, '1.0.0')
  assert.equal(script.composition.target, 'bot')
})

test('the slot value is substituted into the watch-pattern config', async () => {
  const script = await build('deadline')
  const handler = script.composition.handlers.message
  assert.equal(handler.config.pattern, 'deadline')
  assert.equal(handler.config.flags, 'i')
})

test('the slot value is substituted into the child text', async () => {
  const script = await build('deadline')
  const child = script.composition.handlers.message.children[0]
  assert.match(child.config.text, /deadline/)
})

test('the composition carries the recipe capabilities', async () => {
  const script = await build('urgent')
  assert.ok(script.composition.capabilities.includes('read_content'))
  assert.ok(script.composition.capabilities.includes('post_message'))
})

test('the emitted code contains the primitives the recipe uses', async () => {
  const script = await build('urgent')
  assert.match(script.code, /watchPattern\.create\(/)
  assert.match(script.code, /postResponse\.create\(/)
  assert.match(script.code, /Recipe: keyword-alert@1\.0\.0/)
  assert.match(script.code, /id: "com\.example\.keyword-alert"/)
  assert.doesNotMatch(script.code, /const commands = \{/)
  assert.doesNotMatch(script.code, /const triggers = \[/)
})

test('the emitted code carries the substituted slot value', async () => {
  const script = await build('deadline')
  assert.match(script.code, /deadline/)
})

test('the emitted bot exposes the message handler as a function', async () => {
  const script = await build('urgent')
  const { config } = loadEmittedBot(script.code)
  assert.ok(config.handlers)
  assert.equal(typeof config.handlers.message, 'function')
})

test('a message containing the keyword posts the alert', async () => {
  const script = await build('urgent')
  const { config, ctx, posts } = loadEmittedBot(script.code)
  await config.handlers.message(ctx, makeEvent('This is urgent, please look'))
  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'Keyword detected: urgent')
})

test('matching is case-insensitive', async () => {
  const script = await build('urgent')
  const { config, ctx, posts } = loadEmittedBot(script.code)
  await config.handlers.message(ctx, makeEvent('URGENT: server is down'))
  assert.equal(posts.length, 1)
  assert.match(posts[0].text, /urgent/)
})

test('a message without the keyword does not post', async () => {
  const script = await build('urgent')
  const { config, ctx, posts } = loadEmittedBot(script.code)
  await config.handlers.message(ctx, makeEvent('nothing to see here'))
  assert.equal(posts.length, 0)
})

test('observer-mode events with no plaintext are ignored', async () => {
  const script = await build('urgent')
  const { config, ctx, posts } = loadEmittedBot(script.code)
  await config.handlers.message(ctx, makeObserverEvent())
  assert.equal(posts.length, 0)
})

test('an event with no data is ignored', async () => {
  const script = await build('urgent')
  const { config, ctx, posts } = loadEmittedBot(script.code)
  await config.handlers.message(ctx, { id: 'e_3', type: 'message.new' })
  assert.equal(posts.length, 0)
})

test('an undefined input is ignored', async () => {
  const script = await build('urgent')
  const { config, ctx, posts } = loadEmittedBot(script.code)
  await config.handlers.message(ctx, undefined)
  assert.equal(posts.length, 0)
})

test('the emitted script parses as valid JavaScript when its imports are stubbed', async () => {
  const script = await build('urgent')
  const encoded = Buffer.from(script.code, 'utf8').toString('base64')
  const buildFn = new Function(`
    const defineBot = (config) => config
    const watchPattern = { create: () => (() => {}) }
    const postResponse = { create: () => (() => {}) }
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function('defineBot', 'watchPattern', 'postResponse', cleaned)
    return fn(defineBot, watchPattern, postResponse)
  `)
  const result = buildFn()
  assert.ok(result)
  assert.equal(result.id, 'com.example.keyword-alert')
})

test('the recipe compiles deterministically', async () => {
  const first = await build('urgent')
  const second = await build('urgent')
  assert.equal(first.code, second.code)
})

test('the library scans cleanly with keyword-alert present', async () => {
  const { recipes, errors } = await scanLibrary(LIB_ROOT)
  const ids = recipes.map((r) => r.id).sort()
  assert.ok(ids.includes('keyword-alert'))
  assert.ok(ids.includes('echo-command'))
  assert.deepEqual(errors, [])
})
