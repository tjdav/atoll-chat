// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  rankCandidates,
  DEFAULT_THRESHOLD,
  DEFAULT_MARGIN
} from '../../../src/matcher/rank.js'

/**
 * Builds a candidate list from a plain object mapping.
 * @param {Record<string, number>} scores - recipeId to score.
 * @returns {object[]} The candidates.
 */
function candidates (scores) {
  return Object.keys(scores).map((recipeId) => ({ recipeId, score: scores[recipeId] }))
}

test('constants are exported with their default values', () => {
  assert.equal(DEFAULT_THRESHOLD, 0.55)
  assert.equal(DEFAULT_MARGIN, 0.05)
})

test('empty candidates produce a refusal with empty suggestions', () => {
  const result = rankCandidates([])
  assert.equal(result.kind, 'refusal')
  assert.equal(typeof result.reason, 'string')
  assert.deepEqual(result.suggestions, [])
})

test('single candidate above threshold produces a match', () => {
  const result = rankCandidates(candidates({ a: 0.9 }))
  assert.equal(result.kind, 'match')
  assert.equal(result.recipeId, 'a')
  assert.equal(result.confidence, 0.9)
  assert.equal(result.candidates.length, 1)
})

test('single candidate below threshold produces a refusal', () => {
  const result = rankCandidates(candidates({ a: 0.3 }))
  assert.equal(result.kind, 'refusal')
  assert.equal(result.suggestions.length, 1)
  assert.equal(result.suggestions[0].recipeId, 'a')
})

test('candidate exactly at threshold is included', () => {
  const result = rankCandidates(candidates({ a: 0.55 }))
  assert.equal(result.kind, 'match')
  assert.equal(result.recipeId, 'a')
})

test('clear winner above threshold produces a match', () => {
  const result = rankCandidates(candidates({ a: 0.9, b: 0.7 }))
  assert.equal(result.kind, 'match')
  assert.equal(result.recipeId, 'a')
})

test('two close candidates produce an ambiguous result', () => {
  const result = rankCandidates(candidates({ a: 0.8, b: 0.78 }))
  assert.equal(result.kind, 'ambiguous')
  assert.equal(result.candidates.length, 2)
  const ids = result.candidates.map((c) => c.recipeId).sort()
  assert.deepEqual(ids, ['a', 'b'])
})

test('gap exactly at margin produces a match', () => {
  const result = rankCandidates(candidates({ a: 0.8, b: 0.75 }))
  assert.equal(result.kind, 'match')
  assert.equal(result.recipeId, 'a')
})

test('gap just below margin produces an ambiguous result', () => {
  const result = rankCandidates(candidates({ a: 0.8, b: 0.76 }))
  assert.equal(result.kind, 'ambiguous')
})

test('candidates below threshold are filtered before ranking', () => {
  const result = rankCandidates(candidates({ a: 0.9, b: 0.3 }))
  assert.equal(result.kind, 'match')
  assert.equal(result.recipeId, 'a')
  assert.equal(result.candidates.length, 1)
})

test('candidates are sorted by score descending in the result', () => {
  const result = rankCandidates(candidates({ a: 0.95, b: 0.85, c: 0.8 }))
  assert.equal(result.kind, 'match')
  assert.equal(result.candidates[0].recipeId, 'a')
  assert.equal(result.candidates[1].recipeId, 'b')
  assert.equal(result.candidates[2].recipeId, 'c')
})

test('refusal suggestions carry up to three candidates', () => {
  const result = rankCandidates(candidates({ a: 0.4, b: 0.3, c: 0.2, d: 0.1 }))
  assert.equal(result.kind, 'refusal')
  assert.equal(result.suggestions.length, 3)
  assert.deepEqual(result.suggestions.map((s) => s.recipeId), ['a', 'b', 'c'])
})

test('refusal suggestions are sorted by score descending', () => {
  const result = rankCandidates(candidates({ a: 0.3, b: 0.5, c: 0.4 }))
  assert.equal(result.kind, 'refusal')
  assert.deepEqual(result.suggestions.map((s) => s.recipeId), ['b', 'c', 'a'])
})

test('three candidates all within margin produce an ambiguous result with all three', () => {
  const result = rankCandidates(candidates({ a: 0.8, b: 0.78, c: 0.77 }))
  assert.equal(result.kind, 'ambiguous')
  assert.equal(result.candidates.length, 3)
})

test('third candidate outside margin is excluded from ambiguous result', () => {
  const result = rankCandidates(candidates({ a: 0.8, b: 0.78, c: 0.6 }))
  assert.equal(result.kind, 'ambiguous')
  assert.equal(result.candidates.length, 2)
  const ids = result.candidates.map((c) => c.recipeId).sort()
  assert.deepEqual(ids, ['a', 'b'])
})

test('the input array is not mutated', () => {
  const input = candidates({ a: 0.5, b: 0.9, c: 0.7 })
  const before = JSON.stringify(input)
  rankCandidates(input)
  assert.equal(JSON.stringify(input), before)
})

test('the returned candidate list is a fresh array', () => {
  const input = candidates({ a: 0.9 })
  const result = rankCandidates(input)
  assert.notEqual(result.candidates, input)
})

test('a custom threshold overrides the default', () => {
  const result = rankCandidates(candidates({ a: 0.5 }), { threshold: 0.4 })
  assert.equal(result.kind, 'match')
})

test('a custom threshold can push a match into a refusal', () => {
  const result = rankCandidates(candidates({ a: 0.9 }), { threshold: 0.95 })
  assert.equal(result.kind, 'refusal')
})

test('a custom margin overrides the default', () => {
  const result = rankCandidates(candidates({ a: 0.8, b: 0.78 }), { margin: 0.01 })
  assert.equal(result.kind, 'match')
})

test('rankCandidates throws when candidates is not an array', () => {
  assert.throws(
    () => rankCandidates(null),
    /candidates must be an array/
  )
  assert.throws(
    () => rankCandidates('nope'),
    /candidates must be an array/
  )
})

test('rankCandidates throws when a candidate is malformed', () => {
  assert.throws(
    () => rankCandidates([{ recipeId: 'a' }]),
    /every candidate must have a recipeId string and a finite score/
  )
  assert.throws(
    () => rankCandidates([{ score: 0.9 }]),
    /every candidate must have a recipeId string and a finite score/
  )
  assert.throws(
    () => rankCandidates([{ recipeId: 'a', score: 'high' }]),
    /every candidate must have a recipeId string and a finite score/
  )
  assert.throws(
    () => rankCandidates([{ recipeId: 'a', score: NaN }]),
    /every candidate must have a recipeId string and a finite score/
  )
  assert.throws(
    () => rankCandidates([{ recipeId: 'a', score: Infinity }]),
    /every candidate must have a recipeId string and a finite score/
  )
})

test('rankCandidates throws when threshold is not a finite number', () => {
  assert.throws(
    () => rankCandidates([], { threshold: 'x' }),
    /options\.threshold must be a finite number/
  )
  assert.throws(
    () => rankCandidates([], { threshold: NaN }),
    /options\.threshold must be a finite number/
  )
})

test('rankCandidates throws when margin is negative', () => {
  assert.throws(
    () => rankCandidates([], { margin: -0.1 }),
    /options\.margin must be a non-negative finite number/
  )
})

test('rankCandidates throws when margin is not a finite number', () => {
  assert.throws(
    () => rankCandidates([], { margin: 'x' }),
    /options\.margin must be a non-negative finite number/
  )
})

test('rankCandidates is deterministic for identical input', () => {
  const input = candidates({ a: 0.8, b: 0.78, c: 0.6, d: 0.5 })
  const first = rankCandidates(input)
  const second = rankCandidates(input)
  assert.deepEqual(first, second)
})
