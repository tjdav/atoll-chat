// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createHashEmbedder,
  DEFAULT_EMBEDDING_DIMENSIONS
} from '../../../src/matcher/embedder.js'

test('DEFAULT_EMBEDDING_DIMENSIONS is 256', () => {
  assert.equal(DEFAULT_EMBEDDING_DIMENSIONS, 256)
})

test('a fresh embedder has the expected shape', () => {
  const embedder = createHashEmbedder()
  assert.equal(typeof embedder.dimensions, 'function')
  assert.equal(typeof embedder.embed, 'function')
})

test('the default embedder has dimensions 256', () => {
  const embedder = createHashEmbedder()
  assert.equal(embedder.dimensions(), 256)
})

test('custom dimensions are honored', () => {
  const embedder = createHashEmbedder({ dimensions: 64 })
  assert.equal(embedder.dimensions(), 64)
})

test('createHashEmbedder throws on invalid dimensions', () => {
  assert.throws(() => createHashEmbedder({ dimensions: 0 }), /dimensions must be a positive integer/)
  assert.throws(() => createHashEmbedder({ dimensions: -1 }), /dimensions must be a positive integer/)
  assert.throws(() => createHashEmbedder({ dimensions: 1.5 }), /dimensions must be a positive integer/)
  assert.throws(() => createHashEmbedder({ dimensions: 'x' }), /dimensions must be a positive integer/)
})

test('embed returns a vector of the declared dimension', async () => {
  const embedder = createHashEmbedder({ dimensions: 32 })
  const vector = await embedder.embed('hello world')
  assert.equal(vector.length, 32)
})

test('embed returns a unit-length vector', async () => {
  const embedder = createHashEmbedder()
  const vector = await embedder.embed('hello world')
  let sum = 0
  for (const x of vector) sum += x * x
  assert.ok(Math.abs(Math.sqrt(sum) - 1) < 1e-12)
})

test('embed is deterministic for identical text', async () => {
  const embedder = createHashEmbedder()
  const first = await embedder.embed('hello world')
  const second = await embedder.embed('hello world')
  assert.deepEqual(first, second)
})

test('embed produces different vectors for different texts', async () => {
  const embedder = createHashEmbedder()
  const a = await embedder.embed('save bookmarks')
  const b = await embedder.embed('weather forecast')
  let same = true
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) { same = false; break }
  }
  assert.equal(same, false)
})

test('embed is case-insensitive', async () => {
  const embedder = createHashEmbedder()
  const a = await embedder.embed('Hello World')
  const b = await embedder.embed('hello world')
  assert.deepEqual(a, b)
})

test('embed ignores punctuation', async () => {
  const embedder = createHashEmbedder()
  const a = await embedder.embed('hello, world!')
  const b = await embedder.embed('hello world')
  assert.deepEqual(a, b)
})

test('embed throws on non-string input', async () => {
  const embedder = createHashEmbedder()
  await assert.rejects(
    () => embedder.embed(42),
    /text must be a string/
  )
})

test('embed throws when the text produces no tokens', async () => {
  const embedder = createHashEmbedder()
  await assert.rejects(
    () => embedder.embed('   !!!   '),
    /text produced no tokens/
  )
})

test('embed throws on empty string', async () => {
  const embedder = createHashEmbedder()
  await assert.rejects(
    () => embedder.embed(''),
    /text produced no tokens/
  )
})

test('similar texts produce similar vectors', async () => {
  const embedder = createHashEmbedder({ dimensions: 128 })
  const a = await embedder.embed('save bookmarks to the room')
  const b = await embedder.embed('save bookmark to this room')
  const c = await embedder.embed('random unrelated phrase')
  let dotAB = 0
  let dotAC = 0
  for (let i = 0; i < a.length; i++) {
    dotAB += a[i] * b[i]
    dotAC += a[i] * c[i]
  }
  assert.ok(dotAB > dotAC)
})

test('the returned vector is a fresh array per call', async () => {
  const embedder = createHashEmbedder()
  const a = await embedder.embed('hello world')
  const b = await embedder.embed('hello world')
  assert.notEqual(a, b)
})

test('embed works with a single character', async () => {
  const embedder = createHashEmbedder()
  const vector = await embedder.embed('a')
  assert.equal(vector.length, 256)
})

test('a single-token text produces a one-hot vector', async () => {
  const embedder = createHashEmbedder({ dimensions: 64 })
  const vector = await embedder.embed('hello')
  const nonZero = vector.filter((x) => x !== 0)
  assert.equal(nonZero.length, 1)
  assert.ok(Math.abs(Math.abs(nonZero[0]) - 1) < 1e-12)
})

test('the embedder is usable with the vector index', async () => {
  const { createVectorIndex } = await import('../../../src/matcher/vector-index.js')
  const embedder = createHashEmbedder({ dimensions: 64 })
  const index = createVectorIndex()
  index.add('save', await embedder.embed('save a bookmark'))
  index.add('weather', await embedder.embed('weather forecast'))
  const results = index.search(await embedder.embed('save a bookmark'), 1)
  assert.equal(results[0].id, 'save')
})
