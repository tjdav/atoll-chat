// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createVectorIndex,
  cosineSimilarity,
  normalizeVector
} from '../../../src/matcher/vector-index.js'

test('normalizeVector returns a unit-length vector', () => {
  const result = normalizeVector([3, 4])
  assert.ok(Math.abs(result[0] - 0.6) < 1e-12)
  assert.ok(Math.abs(result[1] - 0.8) < 1e-12)
})

test('normalizeVector returns a new array, not the input', () => {
  const input = [1, 2, 3]
  const result = normalizeVector(input)
  assert.notEqual(result, input)
  assert.deepEqual(input, [1, 2, 3])
})

test('normalizeVector throws on empty array', () => {
  assert.throws(
    () => normalizeVector([]),
    /vector must be a non-empty array/
  )
})

test('normalizeVector throws on non-finite entries', () => {
  assert.throws(
    () => normalizeVector([1, NaN]),
    /vector must contain only finite numbers/
  )
  assert.throws(
    () => normalizeVector([Infinity]),
    /vector must contain only finite numbers/
  )
})

test('normalizeVector throws on zero magnitude', () => {
  assert.throws(
    () => normalizeVector([0, 0, 0]),
    /vector has zero magnitude/
  )
})

test('cosineSimilarity of identical unit vectors is 1', () => {
  const v = normalizeVector([1, 1, 1])
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-12)
})

test('cosineSimilarity of opposite unit vectors is -1', () => {
  const a = normalizeVector([1, 0])
  const b = normalizeVector([-1, 0])
  assert.ok(Math.abs(cosineSimilarity(a, b) + 1) < 1e-12)
})

test('cosineSimilarity of orthogonal unit vectors is 0', () => {
  const a = normalizeVector([1, 0])
  const b = normalizeVector([0, 1])
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-12)
})

test('cosineSimilarity throws on dimension mismatch', () => {
  assert.throws(
    () => cosineSimilarity([1, 0], [1, 0, 0]),
    /vectors must be the same length/
  )
})

test('a fresh index has size 0 and dimensions 0', () => {
  const index = createVectorIndex()
  assert.equal(index.size(), 0)
  assert.equal(index.dimensions(), 0)
})

test('add fixes the dimension on first insert', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0, 0])
  assert.equal(index.dimensions(), 3)
  assert.equal(index.size(), 1)
})

test('add with a different dimension throws', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0, 0])
  assert.throws(
    () => index.add('b', [1, 0]),
    /expected 3 dimensions, got 2/
  )
})

test('add with the same id overwrites the entry', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  index.add('a', [0, 1])
  assert.equal(index.size(), 1)
})

test('add throws when id is not a non-empty string', () => {
  const index = createVectorIndex()
  assert.throws(
    () => index.add('', [1]),
    /id must be a non-empty string/
  )
  assert.throws(
    () => index.add(42, [1]),
    /id must be a non-empty string/
  )
})

test('add normalizes the vector before storage', () => {
  const index = createVectorIndex()
  index.add('a', [3, 4])
  const results = index.search([3, 4], 1)
  assert.ok(Math.abs(results[0].score - 1) < 1e-12)
})

test('remove deletes an entry', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  index.add('b', [0, 1])
  index.remove('a')
  assert.equal(index.size(), 1)
  assert.equal(index.has('a'), false)
  assert.equal(index.has('b'), true)
})

test('remove silently ignores unknown ids', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  index.remove('missing')
  assert.equal(index.size(), 1)
})

test('has returns true for present entries and false otherwise', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  assert.equal(index.has('a'), true)
  assert.equal(index.has('b'), false)
})

test('search returns an empty array on an empty index', () => {
  const index = createVectorIndex()
  assert.deepEqual(index.search([1, 0], 5), [])
})

test('search returns results ordered by score descending', () => {
  const index = createVectorIndex()
  index.add('far', [0, 1])
  index.add('near', [1, 0])
  index.add('mid', [1, 1])
  const results = index.search([1, 0], 3)
  assert.equal(results[0].id, 'near')
  assert.equal(results[1].id, 'mid')
  assert.equal(results[2].id, 'far')
})

test('search respects k', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  index.add('b', [1, 1])
  index.add('c', [0, 1])
  const results = index.search([1, 0], 2)
  assert.equal(results.length, 2)
})

test('search with k larger than size returns all entries', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  index.add('b', [0, 1])
  const results = index.search([1, 0], 10)
  assert.equal(results.length, 2)
})

test('search breaks ties by id ascending', () => {
  const index = createVectorIndex()
  index.add('zebra', [1, 0])
  index.add('alpha', [1, 0])
  const results = index.search([1, 0], 2)
  assert.equal(results[0].id, 'alpha')
  assert.equal(results[1].id, 'zebra')
})

test('search throws when query dimension does not match', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0, 0])
  assert.throws(
    () => index.search([1, 0], 1),
    /expected 3 dimensions, got 2/
  )
})

test('search throws when k is not a positive integer', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  assert.throws(() => index.search([1, 0], 0), /k must be a positive integer/)
  assert.throws(() => index.search([1, 0], -1), /k must be a positive integer/)
  assert.throws(() => index.search([1, 0], 1.5), /k must be a positive integer/)
  assert.throws(() => index.search([1, 0], 'x'), /k must be a positive integer/)
})

test('search throws on a zero query vector', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  assert.throws(
    () => index.search([0, 0], 1),
    /vector has zero magnitude/
  )
})

test('clear empties the index and resets the dimension', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0, 0])
  index.clear()
  assert.equal(index.size(), 0)
  assert.equal(index.dimensions(), 0)
  index.add('b', [1, 0])
  assert.equal(index.dimensions(), 2)
})

test('search results carry id and score', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  const [result] = index.search([1, 0], 1)
  assert.equal(result.id, 'a')
  assert.equal(typeof result.score, 'number')
})

test('search is deterministic for identical inputs', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  index.add('b', [1, 1])
  index.add('c', [0, 1])
  const first = index.search([1, 0.5], 3)
  const second = index.search([1, 0.5], 3)
  assert.deepEqual(first, second)
})

test('the index does not return the internal vectors', () => {
  const index = createVectorIndex()
  index.add('a', [1, 0])
  const [result] = index.search([1, 0], 1)
  assert.equal(Object.hasOwn(result, 'vector'), false)
})

test('a query against a single-entry index returns that entry', () => {
  const index = createVectorIndex()
  index.add('only', [1, 0])
  const results = index.search([1, 0], 1)
  assert.equal(results.length, 1)
  assert.equal(results[0].id, 'only')
})
