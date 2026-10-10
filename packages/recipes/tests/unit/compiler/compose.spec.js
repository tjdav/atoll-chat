// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compose } from '../../../src/compiler/compose.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', '..', 'fixtures', 'composer-library')

/**
 * Builds a well-formed Instantiation for the delta recipe.
 * @param {Record<string, unknown>} [slots] - Slot overrides.
 * @returns {object} The instantiation.
 */
function deltaInstantiation (slots) {
  return {
    recipeId: 'delta',
    recipeVersion: '1.0.0',
    slots: slots ?? {}
  }
}

test('compose returns a Composition with the expected top-level shape', async () => {
  const inst = deltaInstantiation({ prefix: 'p' })
  const composition = await compose(LIB, inst)
  assert.equal(composition.recipeId, 'delta')
  assert.equal(composition.recipeVersion, '1.0.0')
  assert.equal(composition.target, 'bot')
  assert.deepEqual(composition.capabilities, ['read_content'])
  assert.equal(typeof composition.handlers, 'object')
  assert.ok(Array.isArray(composition.triggers))
})

test('compose preserves handlers with no slot references', async () => {
  const inst = deltaInstantiation({ prefix: 'p' })
  const composition = await compose(LIB, inst)
  assert.equal(composition.handlers.message.config.pattern, 'delta')
  assert.equal(composition.handlers.message.primitive, 'watch-pattern')
})

test('compose substitutes a single-token string preserving type', async () => {
  const inst = deltaInstantiation({ prefix: 'p', count: 7 })
  const composition = await compose(LIB, inst)
  const value = composition.handlers.message.children[0].config.value
  assert.equal(value.count, 7)
  assert.equal(typeof value.count, 'number')
})

test('compose substitutes a mixed string coercing to string', async () => {
  const inst = deltaInstantiation({ prefix: 'my', count: 2 })
  const composition = await compose(LIB, inst)
  const key = composition.handlers.message.children[0].config.key
  assert.equal(key, 'my:{{match}}')
})

test('compose preserves input substitution tokens', async () => {
  const inst = deltaInstantiation({ prefix: 'p', count: 1 })
  const composition = await compose(LIB, inst)
  const key = composition.handlers.message.children[0].config.key
  assert.match(key, /\{\{match\}\}/)
})

test('compose walks arrays and preserves element types', async () => {
  const inst = deltaInstantiation({ prefix: 'z', count: 9 })
  const composition = await compose(LIB, inst)
  const list = composition.handlers.message.children[0].config.value.list
  assert.equal(list[0], 'z')
  assert.equal(list[1], 9)
  assert.equal(typeof list[1], 'number')
})

test('compose leaves plain strings untouched', async () => {
  const inst = deltaInstantiation({ prefix: 'p' })
  const composition = await compose(LIB, inst)
  const tag = composition.handlers.message.children[0].config.value.tag
  assert.equal(tag, 'delta')
})

test('compose uses a slot default when the value is not provided', async () => {
  const inst = deltaInstantiation({ prefix: 'p' })
  const composition = await compose(LIB, inst)
  assert.equal(composition.slots.count, 3)
  assert.equal(composition.handlers.message.children[0].config.value.count, 3)
})

test('compose overrides a slot default when a value is provided', async () => {
  const inst = deltaInstantiation({ prefix: 'p', count: 42 })
  const composition = await compose(LIB, inst)
  assert.equal(composition.slots.count, 42)
})

test('compose drops undeclared values from the instantiation', async () => {
  const inst = deltaInstantiation({ prefix: 'p', extraneous: 'ignored' })
  const composition = await compose(LIB, inst)
  assert.equal(Object.hasOwn(composition.slots, 'extraneous'), false)
})

test('compose throws when a slot is required and not provided', async () => {
  const inst = deltaInstantiation({})
  await assert.rejects(
    () => compose(LIB, inst),
    /slot "prefix" is required and has no default/
  )
})

test('compose resolves trigger configs the same way as handlers', async () => {
  const inst = deltaInstantiation({ prefix: 'p' })
  const composition = await compose(LIB, inst)
  assert.equal(composition.triggers[0].config.name, 'delta-run')
  assert.equal(composition.triggers[0].primitive, 'schedule-task')
})

test('compose omits triggers when the recipe has none', async () => {
  const inst = {
    recipeId: 'multi',
    recipeVersion: '1.0.0',
    slots: {}
  }
  await assert.rejects(
    () => compose(LIB, inst),
    /multi-target recipes are not supported in v1/
  )
})

test('compose throws on a version mismatch', async () => {
  const inst = {
    recipeId: 'delta',
    recipeVersion: '9.9.9',
    slots: { prefix: 'p' }
  }
  await assert.rejects(
    () => compose(LIB, inst),
    /version mismatch: requested 9\.9\.9, got 1\.0\.0/
  )
})

test('compose throws when the recipe does not exist', async () => {
  const inst = {
    recipeId: 'not-there',
    recipeVersion: '1.0.0',
    slots: {}
  }
  await assert.rejects(
    () => compose(LIB, inst),
    /cannot load recipe "not-there"/
  )
})

test('compose throws on a multi-target recipe', async () => {
  const inst = {
    recipeId: 'multi',
    recipeVersion: '1.0.0',
    slots: {}
  }
  await assert.rejects(
    () => compose(LIB, inst),
    /multi-target recipes are not supported in v1/
  )
})

test('compose throws when rootDir is not a non-empty string', async () => {
  await assert.rejects(
    () => compose('', deltaInstantiation({ prefix: 'p' })),
    /rootDir must be a non-empty string/
  )
  await assert.rejects(
    () => compose(42, deltaInstantiation({ prefix: 'p' })),
    /rootDir must be a non-empty string/
  )
})

test('compose throws when the instantiation is not an object', async () => {
  await assert.rejects(
    () => compose(LIB, null),
    /instantiation must be an object/
  )
  await assert.rejects(
    () => compose(LIB, 'nope'),
    /instantiation must be an object/
  )
})

test('compose throws when recipeId is missing', async () => {
  await assert.rejects(
    () => compose(LIB, { recipeVersion: '1.0.0', slots: {} }),
    /instantiation\.recipeId must be a non-empty string/
  )
})

test('compose throws when recipeVersion is missing', async () => {
  await assert.rejects(
    () => compose(LIB, { recipeId: 'delta', slots: {} }),
    /instantiation\.recipeVersion must be a non-empty string/
  )
})

test('compose throws when slots is not a plain object', async () => {
  await assert.rejects(
    () => compose(LIB, { recipeId: 'delta', recipeVersion: '1.0.0', slots: [] }),
    /instantiation\.slots must be a plain object/
  )
  await assert.rejects(
    () => compose(LIB, { recipeId: 'delta', recipeVersion: '1.0.0', slots: null }),
    /instantiation\.slots must be a plain object/
  )
})

test('compose does not mutate the recipe object in memory', async () => {
  const inst = deltaInstantiation({ prefix: 'p', count: 5 })
  const first = await compose(LIB, inst)
  const second = await compose(LIB, inst)
  assert.deepEqual(first, second)
})

test('compose passes recipe settings through when present', async () => {
  const inst = deltaInstantiation({ prefix: 'p' })
  const composition = await compose(LIB, inst)
  assert.equal(Object.hasOwn(composition, 'settings'), false)
})
