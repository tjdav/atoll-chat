// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { scanLibrary, loadRecipeById } from '../../../src/recipe/library.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_LIBRARY = join(HERE, '..', '..', 'fixtures', 'library')

test('scanLibrary returns summaries for every valid recipe', async () => {
  const { recipes } = await scanLibrary(FIXTURE_LIBRARY)
  const ids = recipes.map((r) => r.id)
  assert.deepEqual(ids, ['alpha', 'beta', 'gamma'])
})

test('scanLibrary sorts recipes by id', async () => {
  const { recipes } = await scanLibrary(FIXTURE_LIBRARY)
  for (let i = 1; i < recipes.length; i++) {
    assert.ok(recipes[i - 1].id.localeCompare(recipes[i].id) <= 0)
  }
})

test('scanLibrary summaries carry id, version, label, description, kind, targets, dir', async () => {
  const { recipes } = await scanLibrary(FIXTURE_LIBRARY)
  const alpha = recipes.find((r) => r.id === 'alpha')
  assert.equal(alpha.version, '1.0.0')
  assert.equal(alpha.label, 'Alpha')
  assert.match(alpha.description, /first fixture/)
  assert.equal(alpha.kind, 'pure')
  assert.deepEqual(alpha.targets, ['bot'])
  assert.equal(typeof alpha.dir, 'string')
  assert.ok(alpha.dir.endsWith('alpha'))
})

test('scanLibrary defaults targets to ["bot"] when the recipe omits it', async () => {
  const { recipes } = await scanLibrary(FIXTURE_LIBRARY)
  const alpha = recipes.find((r) => r.id === 'alpha')
  assert.deepEqual(alpha.targets, ['bot'])
})

test('scanLibrary collects errors for invalid recipes', async () => {
  const { errors } = await scanLibrary(FIXTURE_LIBRARY)
  assert.equal(errors.length, 1)
  assert.match(errors[0].path, /broken/)
  assert.match(errors[0].message, /invalid recipe/)
})

test('scanLibrary skips directories without a recipe.json', async () => {
  const { recipes, errors } = await scanLibrary(FIXTURE_LIBRARY)
  const names = recipes.map((r) => r.id)
  assert.ok(!names.includes('notes'))
  assert.equal(errors.length, 1)
})

test('scanLibrary skips files at the library root', async () => {
  const { recipes } = await scanLibrary(FIXTURE_LIBRARY)
  assert.equal(recipes.length, 3)
})

test('scanLibrary throws when rootDir is not a string', async () => {
  await assert.rejects(
    () => scanLibrary(42),
    /rootDir must be a non-empty string/
  )
})

test('scanLibrary throws when rootDir is empty', async () => {
  await assert.rejects(
    () => scanLibrary(''),
    /rootDir must be a non-empty string/
  )
})

test('scanLibrary throws when rootDir does not exist', async () => {
  await assert.rejects(
    () => scanLibrary(join(FIXTURE_LIBRARY, 'does-not-exist')),
    /is not a directory/
  )
})

test('scanLibrary throws when rootDir is a file', async () => {
  const filePath = join(FIXTURE_LIBRARY, 'alpha', 'recipe.json')
  await assert.rejects(
    () => scanLibrary(filePath),
    /is not a directory/
  )
})

test('loadRecipeById loads a recipe by id', async () => {
  const recipe = await loadRecipeById(FIXTURE_LIBRARY, 'alpha')
  assert.equal(recipe.id, 'alpha')
  assert.equal(recipe.version, '1.0.0')
  assert.ok(recipe.handlers.install)
})

test('loadRecipeById throws when the id does not match the pattern', async () => {
  await assert.rejects(
    () => loadRecipeById(FIXTURE_LIBRARY, 'Alpha'),
    /id must match/
  )
  await assert.rejects(
    () => loadRecipeById(FIXTURE_LIBRARY, 'alpha_1'),
    /id must match/
  )
  await assert.rejects(
    () => loadRecipeById(FIXTURE_LIBRARY, '1alpha'),
    /id must match/
  )
})

test('loadRecipeById throws when the recipe does not exist', async () => {
  await assert.rejects(
    () => loadRecipeById(FIXTURE_LIBRARY, 'missing'),
    /loadRecipeById: recipe "missing"/
  )
})

test('loadRecipeById error names both id and path on validation failure', async () => {
  await assert.rejects(
    () => loadRecipeById(FIXTURE_LIBRARY, 'broken'),
    (err) => {
      assert.match(err.message, /recipe "broken"/)
      assert.match(err.message, /invalid recipe/)
      return true
    }
  )
})

test('loadRecipeById throws when rootDir is not a non-empty string', async () => {
  await assert.rejects(
    () => loadRecipeById('', 'alpha'),
    /rootDir must be a non-empty string/
  )
  await assert.rejects(
    () => loadRecipeById(42, 'alpha'),
    /rootDir must be a non-empty string/
  )
})

test('loadRecipeById resolves relative rootDir to absolute paths', async () => {
  const recipe = await loadRecipeById(FIXTURE_LIBRARY, 'beta')
  assert.equal(recipe.id, 'beta')
  assert.equal(recipe.version, '2.1.0')
})

test('scanLibrary and loadRecipeById agree on the recipe set', async () => {
  const { recipes } = await scanLibrary(FIXTURE_LIBRARY)
  for (const summary of recipes) {
    const full = await loadRecipeById(FIXTURE_LIBRARY, summary.id)
    assert.equal(full.id, summary.id)
    assert.equal(full.version, summary.version)
  }
})
