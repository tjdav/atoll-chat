// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseRecipe, loadRecipeFile } from '../../../src/recipe/load.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '..', '..', 'fixtures', 'recipes')

/**
 * A minimal valid recipe, as an object. Used to build JSON text
 * inline for the parse tests.
 * @returns {object} A valid recipe.
 */
function validRecipeObject () {
  return {
    id: 'inline-fixture',
    version: '1.0.0',
    label: 'Inline Fixture',
    description: 'A minimal valid recipe.',
    kind: 'pure',
    capabilities: ['post_message'],
    slots: [],
    handlers: {
      install: {
        id: 'install-hook',
        primitive: 'post-response',
        config: { text: 'Hello.' }
      }
    }
  }
}

test('parseRecipe returns a validated recipe from valid JSON text', () => {
  const text = JSON.stringify(validRecipeObject())
  const recipe = parseRecipe(text)
  assert.equal(recipe.id, 'inline-fixture')
  assert.equal(recipe.version, '1.0.0')
  assert.equal(recipe.kind, 'pure')
})

test('parseRecipe throws when text is not a string', () => {
  assert.throws(
    () => parseRecipe(42),
    /text must be a string/
  )
})

test('parseRecipe throws on invalid JSON', () => {
  assert.throws(
    () => parseRecipe('{ not json }'),
    /invalid JSON/
  )
})

test('parseRecipe throws on JSON that is not an object', () => {
  assert.throws(
    () => parseRecipe('"just a string"'),
    /invalid recipe/
  )
})

test('parseRecipe throws on a recipe missing required fields', () => {
  assert.throws(
    () => parseRecipe('{"id":"x"}'),
    (err) => {
      assert.match(err.message, /invalid recipe/)
      assert.match(err.message, /1\./)
      assert.match(err.message, /version is required/)
      return true
    }
  )
})

test('parseRecipe error lists every validation error', () => {
  const text = JSON.stringify({ id: 'x' })
  try {
    parseRecipe(text)
    assert.fail('expected parseRecipe to throw')
  } catch (err) {
    const lines = err.message.split('\n')
    assert.ok(lines.length > 1)
    assert.match(err.message, /version is required/)
    assert.match(err.message, /label is required/)
    assert.match(err.message, /kind is required/)
  }
})

test('parseRecipe does not mutate the input object after parsing', () => {
  const obj = validRecipeObject()
  const text = JSON.stringify(obj)
  const before = JSON.stringify(obj)
  parseRecipe(text)
  assert.equal(JSON.stringify(obj), before)
})

test('loadRecipeFile loads a valid fixture', async () => {
  const path = join(FIXTURES, 'valid', 'recipe.json')
  const recipe = await loadRecipeFile(path)
  assert.equal(recipe.id, 'valid-fixture')
  assert.equal(recipe.version, '1.0.0')
})

test('loadRecipeFile throws with the path when the file is missing', async () => {
  const path = join(FIXTURES, 'does-not-exist', 'recipe.json')
  await assert.rejects(
    () => loadRecipeFile(path),
    (err) => {
      assert.match(err.message, /cannot read/)
      assert.match(err.message, /does-not-exist/)
      return true
    }
  )
})

test('loadRecipeFile throws with the path on invalid JSON', async () => {
  const path = join(FIXTURES, 'invalid-json', 'recipe.json')
  await assert.rejects(
    () => loadRecipeFile(path),
    (err) => {
      assert.match(err.message, /invalid-json/)
      assert.match(err.message, /invalid JSON/)
      return true
    }
  )
})

test('loadRecipeFile throws with the path on invalid shape', async () => {
  const path = join(FIXTURES, 'invalid-shape', 'recipe.json')
  await assert.rejects(
    () => loadRecipeFile(path),
    (err) => {
      assert.match(err.message, /invalid-shape/)
      assert.match(err.message, /invalid recipe/)
      return true
    }
  )
})

test('loadRecipeFile throws when filePath is not a non-empty string', async () => {
  await assert.rejects(
    () => loadRecipeFile(''),
    /filePath must be a non-empty string/
  )
  await assert.rejects(
    () => loadRecipeFile(42),
    /filePath must be a non-empty string/
  )
})
