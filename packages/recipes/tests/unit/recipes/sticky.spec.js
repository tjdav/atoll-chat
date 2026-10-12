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
 * Compiles the sticky recipe.
 * @returns {Promise<object>} The BotScript.
 */
async function build () {
  return compile(
    LIB_ROOT,
    { recipeId: 'sticky', recipeVersion: '1.0.0', slots: {} },
    { botId: 'com.example.sticky', label: 'Sticky' }
  )
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
  const recipe = await loadRecipeById(LIB_ROOT, 'sticky')
  assert.equal(recipe.id, 'sticky')
  assert.equal(recipe.version, '1.0.0')
  assert.equal(recipe.kind, 'pure')
})

test('the recipe declares a user-scoped message setting', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'sticky')
  assert.ok(recipe.settings)
  assert.ok(recipe.settings.message)
  assert.equal(recipe.settings.message.type, 'text')
  assert.equal(recipe.settings.message.scope, 'user')
  assert.equal(recipe.settings.message.default, 'Sticky is ready.')
})

test('the recipe declares the say command', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'sticky')
  const names = Object.keys(recipe.commands)
  assert.deepEqual(names, ['say'])
  assert.equal(recipe.commands.say.config.name, 'say')
})

test('the recipe declares the capabilities its primitives require', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'sticky')
  assert.ok(recipe.capabilities.includes('read_commands'))
  assert.ok(recipe.capabilities.includes('post_message'))
})

test('the recipe compiles without error', async () => {
  const script = await build()
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'sticky')
  assert.ok(script.composition.commands.say)
})

test('the composition carries the settings declaration', async () => {
  const script = await build()
  assert.ok(script.composition.settings)
  assert.ok(script.composition.settings.message)
  assert.equal(script.composition.settings.message.type, 'text')
})

test('the composition nests settings-read and post-response under the say command', async () => {
  const script = await build()
  const say = script.composition.commands.say
  assert.equal(say.children.length, 1)
  const read = say.children[0]
  assert.equal(read.primitive, 'settings-read')
  assert.equal(read.config.key, 'message')
  assert.equal(read.children.length, 1)
  const post = read.children[0]
  assert.equal(post.primitive, 'post-response')
  assert.equal(post.config.text, '{{.}}')
})

test('the emitted code contains a settings block', async () => {
  const script = await build()
  assert.match(script.code, /settings: \{/)
  assert.match(script.code, /"message"/)
  assert.match(script.code, /"Message"/)
  assert.match(script.code, /"default": "Sticky is ready\."/)
})

test('the emitted code contains the expected primitives', async () => {
  const script = await build()
  assert.match(script.code, /settingsRead\.create\(/)
  assert.match(script.code, /postResponse\.create\(/)
  assert.match(script.code, /asCommandDecl\(/)
  assert.match(script.code, /Recipe: sticky@1\.0\.0/)
  assert.match(script.code, /id: "com\.example\.sticky"/)
})

test('the emitted bot config carries the settings', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)
  assert.ok(config.settings)
  assert.ok(config.settings.message)
  assert.equal(config.settings.message.type, 'text')
})

test('the emitted bot exposes the say command with a handler', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code, { settings: { message: 'Hello world' } })
  assert.ok(config.commands.say)
  assert.equal(typeof config.commands.say.handler, 'function')
  assert.equal(config.commands.say.description, 'Post the configured message to the room.')
})

test('the say command posts the configured message', async () => {
  const script = await build()
  const { config, ctx, posts } = loadEmittedBot(script.code, {
    settings: { message: 'Deploy day!' }
  })
  const result = await config.commands.say.handler(ctx, makeReader({}))
  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'Deploy day!')
  assert.deepEqual(result, { type: 'none' })
})

test('the say command reads only the message setting', async () => {
  const script = await build()
  const { config, ctx } = loadEmittedBot(script.code, { settings: { message: 'x' } })
  const reads = []
  const originalGet = ctx.settings.get
  ctx.settings.get = async (key, opts) => {
    reads.push(key)
    return originalGet.call(ctx.settings, key, opts)
  }
  await config.commands.say.handler(ctx, makeReader({}))
  assert.deepEqual(reads, ['message'])
})

test('the say command throws when the setting value is empty', async () => {
  const script = await build()
  const { config, ctx } = loadEmittedBot(script.code, { settings: { message: '' } })
  await assert.rejects(
    () => config.commands.say.handler(ctx, makeReader({})),
    /resolved text is empty/
  )
})

test('the say command throws when the setting is undefined', async () => {
  const script = await build()
  const { config, ctx } = loadEmittedBot(script.code)
  await assert.rejects(
    () => config.commands.say.handler(ctx, makeReader({})),
    /resolved text is empty/
  )
})

test('the install handler posts a fixed public message', async () => {
  const script = await build()
  const { config, ctx, posts } = loadEmittedBot(script.code, { settings: { message: 'Hello' } })
  await config.handlers.install(ctx, {})
  assert.equal(posts.length, 1)
  assert.match(posts[0].text, /Sticky is ready/)
  assert.doesNotMatch(posts[0].text, /Hello/)
})

test('the emitted code is deterministic', async () => {
  const first = await build()
  const second = await build()
  assert.equal(first.code, second.code)
})

test('the library scans cleanly with sticky present', async () => {
  const { recipes, errors } = await scanLibrary(LIB_ROOT)
  const ids = recipes.map((r) => r.id).sort()
  assert.ok(ids.includes('sticky'))
  assert.ok(ids.includes('keyword-alert'))
  assert.ok(ids.includes('echo-command'))
  assert.ok(ids.includes('notes'))
  assert.ok(ids.includes('quote'))
  assert.ok(ids.includes('webhook-notify'))
  assert.deepEqual(errors, [])
})
