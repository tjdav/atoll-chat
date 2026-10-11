// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compile } from '../../../src/compiler/index.js'
import { loadRecipeById } from '../../../src/recipe/library.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB_ROOT = join(HERE, '..', '..', '..', 'recipes')

/**
 * Compiles the keyword-alert recipe with a test slot value.
 * @param {string} keyword - The keyword to substitute.
 * @returns {Promise<object>} The BotScript.
 */
async function buildWith (keyword) {
  return compile(
    LIB_ROOT,
    {
      recipeId: 'keyword-alert',
      recipeVersion: '1.0.0',
      slots: { keyword }
    },
    {
      botId: 'com.example.keyword-alert',
      label: 'Keyword Alert'
    }
  )
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
  const script = await buildWith('urgent')
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'keyword-alert')
  assert.equal(script.composition.recipeVersion, '1.0.0')
  assert.equal(script.composition.target, 'bot')
})

test('the slot value is substituted into the watch-pattern config', async () => {
  const script = await buildWith('deadline')
  const handler = script.composition.handlers.message
  assert.equal(handler.config.pattern, 'deadline')
  assert.equal(handler.config.flags, 'i')
})

test('the slot value is substituted into the child text', async () => {
  const script = await buildWith('deadline')
  const child = script.composition.handlers.message.children[0]
  assert.match(child.config.text, /deadline/)
})

test('the composition carries the recipe capabilities', async () => {
  const script = await buildWith('urgent')
  assert.ok(script.composition.capabilities.includes('read_content'))
  assert.ok(script.composition.capabilities.includes('post_message'))
})

test('the emitted code contains the primitives the recipe uses', async () => {
  const script = await buildWith('urgent')
  assert.match(script.code, /watchPattern\.create\(/)
  assert.match(script.code, /postResponse\.create\(/)
  assert.match(script.code, /Recipe: keyword-alert@1\.0\.0/)
  assert.match(script.code, /id: "com\.example\.keyword-alert"/)
})

test('the emitted code carries the substituted slot value', async () => {
  const script = await buildWith('deadline')
  assert.match(script.code, /deadline/)
})

test('the emitted script parses as valid JavaScript when imports are stubbed', async () => {
  const script = await buildWith('urgent')
  const encoded = Buffer.from(script.code, 'utf8').toString('base64')
  const build = new Function(`
    const defineBot = (config) => config
    const watchPattern = { create: () => ({}) }
    const postResponse = { create: () => ({}) }
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function('defineBot', 'watchPattern', 'postResponse', cleaned)
    return fn(defineBot, watchPattern, postResponse)
  `)
  const result = build()
  assert.ok(result)
  assert.equal(result.id, 'com.example.keyword-alert')
  assert.ok(Object.hasOwn(result, 'handlers'))
  assert.ok(result.handlers.message)
})

test('the recipe compiles deterministically', async () => {
  const first = await buildWith('urgent')
  const second = await buildWith('urgent')
  assert.equal(first.code, second.code)
})
