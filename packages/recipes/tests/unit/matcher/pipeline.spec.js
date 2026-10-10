// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createMatcher } from '../../../src/matcher/pipeline.js'

/**
 * A trivial embedder that returns a vector with a single 1 at the
 * position of the token's first letter. Not semantic; enough to
 * drive the pipeline in tests.
 * @returns {object} An embedder-shaped object.
 */
function createStubEmbedder () {
  return {
    dimensions () { return 8 },
    async embed (text) {
      const vec = new Array(8).fill(0)
      const code = text.toLowerCase().charCodeAt(0) - 97
      vec[((code % 8) + 8) % 8] = 1
      return vec
    }
  }
}

/**
 * A stub index that returns a configured list of results regardless
 * of the query.
 * @param {{ id: string, score: number }[]} results - The results.
 * @returns {object} An index-shaped object that records the last
 *   query and k.
 */
function createStubIndex (results) {
  const calls = []
  return {
    calls,
    async search (query, k) {
      calls.push({ query, k })
      return results.slice(0, k)
    }
  }
}

/**
 * A recipe summary.
 * @param {string} id - The id.
 * @returns {object} The summary.
 */
function recipe (id) {
  return { id, label: id, description: `${id} recipe` }
}

test('createMatcher throws when config is not a plain object', () => {
  assert.throws(() => createMatcher(null), /config must be a plain object/)
  assert.throws(() => createMatcher('x'), /config must be a plain object/)
  assert.throws(() => createMatcher([]), /config must be a plain object/)
})

test('createMatcher throws when embedder is missing', () => {
  assert.throws(
    () => createMatcher({ index: createStubIndex([]), recipes: [] }),
    /config\.embedder must be an object/
  )
})

test('createMatcher throws when embedder.embed is not a function', () => {
  assert.throws(
    () => createMatcher({ embedder: {}, index: createStubIndex([]), recipes: [] }),
    /config\.embedder\.embed must be a function/
  )
})

test('createMatcher throws when index is missing', () => {
  assert.throws(
    () => createMatcher({ embedder: createStubEmbedder(), recipes: [] }),
    /config\.index must be an object/
  )
})

test('createMatcher throws when index.search is not a function', () => {
  assert.throws(
    () => createMatcher({ embedder: createStubEmbedder(), index: {}, recipes: [] }),
    /config\.index\.search must be a function/
  )
})

test('createMatcher throws when recipes is not an array', () => {
  assert.throws(
    () => createMatcher({
      embedder: createStubEmbedder(),
      index: createStubIndex([]),
      recipes: 'nope'
    }),
    /config\.recipes must be an array/
  )
})

test('createMatcher throws when topK is not a positive integer', () => {
  const base = { embedder: createStubEmbedder(), index: createStubIndex([]), recipes: [] }
  assert.throws(() => createMatcher({ ...base, topK: 0 }), /topK must be a positive integer/)
  assert.throws(() => createMatcher({ ...base, topK: -1 }), /topK must be a positive integer/)
  assert.throws(() => createMatcher({ ...base, topK: 1.5 }), /topK must be a positive integer/)
  assert.throws(() => createMatcher({ ...base, topK: 'x' }), /topK must be a positive integer/)
})

test('createMatcher throws when disambiguator is not a function', () => {
  const base = { embedder: createStubEmbedder(), index: createStubIndex([]), recipes: [] }
  assert.throws(
    () => createMatcher({ ...base, disambiguator: 'x' }),
    /disambiguator must be a function when provided/
  )
})

test('createMatcher throws when a recipe has no id', () => {
  const base = { embedder: createStubEmbedder(), index: createStubIndex([]) }
  assert.throws(
    () => createMatcher({ ...base, recipes: [{}] }),
    /every recipe must have a non-empty id/
  )
})

test('match throws when intent is not a non-empty string', async () => {
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index: createStubIndex([]),
    recipes: []
  })
  await assert.rejects(() => matcher.match(''), /intent must be a non-empty string/)
  await assert.rejects(() => matcher.match(42), /intent must be a non-empty string/)
})

test('match returns refusal when the index returns nothing', async () => {
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index: createStubIndex([]),
    recipes: []
  })
  const result = await matcher.match('save a bookmark')
  assert.equal(result.kind, 'refusal')
  assert.deepEqual(result.suggestions, [])
})

test('match returns a match for a single candidate above threshold', async () => {
  const index = createStubIndex([{ id: 'save', score: 0.9 }])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save')]
  })
  const result = await matcher.match('save a bookmark')
  assert.equal(result.kind, 'match')
  assert.equal(result.recipeId, 'save')
  assert.equal(result.confidence, 0.9)
})

test('match returns a match for a clear winner', async () => {
  const index = createStubIndex([
    { id: 'save', score: 0.9 },
    { id: 'weather', score: 0.6 }
  ])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save'), recipe('weather')]
  })
  const result = await matcher.match('save a bookmark')
  assert.equal(result.kind, 'match')
  assert.equal(result.recipeId, 'save')
})

test('match returns ambiguous when two candidates are close', async () => {
  const index = createStubIndex([
    { id: 'save', score: 0.8 },
    { id: 'weather', score: 0.78 }
  ])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save'), recipe('weather')]
  })
  const result = await matcher.match('ambiguous')
  assert.equal(result.kind, 'ambiguous')
  assert.equal(result.candidates.length, 2)
})

test('match filters candidates that are not in the recipe set', async () => {
  const index = createStubIndex([
    { id: 'save', score: 0.9 },
    { id: 'orphan', score: 0.85 }
  ])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save')]
  })
  const result = await matcher.match('save a bookmark')
  assert.equal(result.kind, 'match')
  assert.equal(result.recipeId, 'save')
  assert.equal(result.candidates.length, 1)
})

test('match passes topK to the index search', async () => {
  const index = createStubIndex([])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [],
    topK: 3
  })
  await matcher.match('anything')
  assert.equal(index.calls.length, 1)
  assert.equal(index.calls[0].k, 3)
})

test('match defaults topK to 10', async () => {
  const index = createStubIndex([])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: []
  })
  await matcher.match('anything')
  assert.equal(index.calls[0].k, 10)
})

test('match passes rankOptions through to rankCandidates', async () => {
  const index = createStubIndex([
    { id: 'save', score: 0.5 },
    { id: 'weather', score: 0.48 }
  ])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save'), recipe('weather')],
    rankOptions: { threshold: 0.4, margin: 0.01 }
  })
  const result = await matcher.match('x')
  assert.equal(result.kind, 'match')
  assert.equal(result.recipeId, 'save')
})

test('match calls the disambiguator on ambiguous results', async () => {
  const index = createStubIndex([
    { id: 'save', score: 0.8 },
    { id: 'weather', score: 0.78 }
  ])
  const calls = []
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save'), recipe('weather')],
    disambiguator: async (intent, candidates, recipes) => {
      calls.push({ intent, candidates, recipes })
      return {
        kind: 'match',
        recipeId: 'save',
        confidence: 0.9,
        candidates
      }
    }
  })
  const result = await matcher.match('pick one')
  assert.equal(result.kind, 'match')
  assert.equal(result.recipeId, 'save')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].intent, 'pick one')
  assert.equal(calls[0].candidates.length, 2)
  assert.equal(calls[0].recipes.length, 2)
  assert.equal(calls[0].recipes[0].id, 'save')
})

test('match does not call the disambiguator on a clear match', async () => {
  const index = createStubIndex([{ id: 'save', score: 0.9 }])
  let called = false
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save')],
    disambiguator: async () => {
      called = true
      return { kind: 'refusal', reason: 'no', suggestions: [] }
    }
  })
  await matcher.match('x')
  assert.equal(called, false)
})

test('match does not call the disambiguator on a refusal', async () => {
  const index = createStubIndex([{ id: 'save', score: 0.2 }])
  let called = false
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save')],
    disambiguator: async () => {
      called = true
      return { kind: 'refusal', reason: 'no', suggestions: [] }
    }
  })
  await matcher.match('x')
  assert.equal(called, false)
})

test('match returns the ambiguous result unchanged when no disambiguator is configured', async () => {
  const index = createStubIndex([
    { id: 'save', score: 0.8 },
    { id: 'weather', score: 0.78 }
  ])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save'), recipe('weather')]
  })
  const result = await matcher.match('x')
  assert.equal(result.kind, 'ambiguous')
})

test('match rejects when the disambiguator throws', async () => {
  const index = createStubIndex([
    { id: 'save', score: 0.8 },
    { id: 'weather', score: 0.78 }
  ])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save'), recipe('weather')],
    disambiguator: async () => {
      throw new Error('LLM unavailable')
    }
  })
  await assert.rejects(() => matcher.match('x'), /LLM unavailable/)
})

test('match rejects when the disambiguator returns an invalid shape', async () => {
  const index = createStubIndex([
    { id: 'save', score: 0.8 },
    { id: 'weather', score: 0.78 }
  ])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save'), recipe('weather')],
    disambiguator: async () => ({ nonsense: true })
  })
  await assert.rejects(
    () => matcher.match('x'),
    /disambiguator returned an invalid MatchResult/
  )
})

test('match returns the disambiguator refusal result when it declines to choose', async () => {
  const index = createStubIndex([
    { id: 'save', score: 0.8 },
    { id: 'weather', score: 0.78 }
  ])
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index,
    recipes: [recipe('save'), recipe('weather')],
    disambiguator: async () => ({
      kind: 'refusal',
      reason: 'neither matches',
      suggestions: [{ recipeId: 'save', score: 0.8 }]
    })
  })
  const result = await matcher.match('x')
  assert.equal(result.kind, 'refusal')
  assert.equal(result.reason, 'neither matches')
})

test('match embeds the intent exactly once per call', async () => {
  let embedCalls = 0
  const embedder = {
    dimensions () { return 4 },
    async embed (text) {
      embedCalls++
      return [1, 0, 0, 0]
    }
  }
  const matcher = createMatcher({
    embedder,
    index: createStubIndex([{ id: 'save', score: 0.9 }]),
    recipes: [recipe('save')]
  })
  await matcher.match('one')
  await matcher.match('two')
  assert.equal(embedCalls, 2)
})

test('the matcher returns an object with a match method', () => {
  const matcher = createMatcher({
    embedder: createStubEmbedder(),
    index: createStubIndex([]),
    recipes: []
  })
  assert.equal(typeof matcher.match, 'function')
})
