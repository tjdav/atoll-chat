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
 * Compiles the echo-command recipe.
 * @returns {Promise<object>} The BotScript.
 */
async function build () {
  return compile(
    LIB_ROOT,
    { recipeId: 'echo-command', recipeVersion: '1.0.0', slots: {} },
    { botId: 'com.example.echo-command', label: 'Echo' }
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

test('the recipe is present in the library', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'echo-command')
  assert.equal(recipe.id, 'echo-command')
  assert.equal(recipe.version, '1.0.0')
  assert.equal(recipe.kind, 'pure')
  assert.ok(Array.isArray(recipe.commands ? Object.keys(recipe.commands) : null))
})

test('the recipe declares exactly one command', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'echo-command')
  const names = Object.keys(recipe.commands)
  assert.deepEqual(names, ['echo'])
})

test('the command config matches the map key', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'echo-command')
  assert.equal(recipe.commands.echo.config.name, 'echo')
})

test('the command declares a required text argument', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'echo-command')
  const args = recipe.commands.echo.config.args
  assert.ok(args.text)
  assert.equal(args.text.type, 'string')
  assert.equal(args.text.required, true)
})

test('the recipe declares the capabilities its primitives require', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'echo-command')
  assert.ok(recipe.capabilities.includes('read_commands'))
  assert.ok(recipe.capabilities.includes('post_message'))
})

test('the recipe compiles without error', async () => {
  const script = await build()
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'echo-command')
  assert.equal(script.composition.target, 'bot')
  assert.ok(script.composition.commands)
  assert.ok(script.composition.commands.echo)
})

test('the composition carries the command alongside the install handler', async () => {
  const script = await build()
  assert.ok(script.composition.handlers.install)
  assert.ok(script.composition.commands.echo)
  assert.equal(script.composition.commands.echo.primitive, 'expose-command')
})

test('the emitted code contains a commands block and the asCommandDecl import', async () => {
  const script = await build()
  assert.match(script.code, /const commands = \{/)
  assert.match(script.code, /asCommandDecl\(/)
  assert.match(script.code, /"echo"/)
  assert.match(script.code, /"Repeat a message in the room\."/)
  assert.match(script.code, /Recipe: echo-command@1\.0\.0/)
  assert.match(script.code, /id: "com\.example\.echo-command"/)
})

test('the emitted bot exposes an echo command with a handler', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)
  assert.ok(config.commands.echo)
  assert.equal(typeof config.commands.echo.handler, 'function')
  assert.equal(config.commands.echo.description, 'Repeat a message in the room.')
})

test('the command handler passes the declared argument through to the child', async () => {
  const script = await build()
  const { config, ctx, posts } = loadEmittedBot(script.code)
  const reader = makeReader({ text: 'hello world' })
  await config.commands.echo.handler(ctx, reader)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'hello world')
})

test('the command handler returns a valid CommandResult', async () => {
  const script = await build()
  const { config, ctx } = loadEmittedBot(script.code)
  const reader = makeReader({ text: 'x' })
  const result = await config.commands.echo.handler(ctx, reader)
  assert.deepEqual(result, { type: 'none' })
})

test('the command handler reads only the declared argument keys', async () => {
  const script = await build()
  const { config, ctx } = loadEmittedBot(script.code)
  const reads = []
  const reader = {
    get (key) {
      reads.push(key)
      return 'x'
    }
  }
  await config.commands.echo.handler(ctx, reader)
  assert.deepEqual(reads, ['text'])
})

test('the emitted script compiles deterministically', async () => {
  const first = await build()
  const second = await build()
  assert.equal(first.code, second.code)
})

test('the recipes library scans cleanly with echo-command present', async () => {
  const { recipes, errors } = await scanLibrary(LIB_ROOT)
  const ids = recipes.map((r) => r.id).sort()
  assert.ok(ids.includes('echo-command'))
  assert.ok(ids.includes('keyword-alert'))
  assert.deepEqual(errors, [])
})
