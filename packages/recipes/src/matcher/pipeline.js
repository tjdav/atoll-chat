// SPDX-License-Identifier: AGPL-3.0-or-later

import { rankCandidates } from './rank.js'

const DEFAULT_TOP_K = 10

/**
 * Returns true when a value is a valid MatchResult shape.
 * @param {unknown} value - The value to test.
 * @returns {boolean} True when valid.
 */
function isMatchResult (value) {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const kind = value.kind
  if (kind === 'match') {
    return typeof value.recipeId === 'string' &&
      typeof value.confidence === 'number' &&
      Array.isArray(value.candidates)
  }
  if (kind === 'ambiguous') {
    return Array.isArray(value.candidates)
  }
  if (kind === 'refusal') {
    return typeof value.reason === 'string' &&
      Array.isArray(value.suggestions)
  }
  return false
}

/**
 * Creates a matcher that wires an embedder, a vector index, and a
 * set of recipe summaries into the intent-matching pipeline.
 *
 * The matcher holds no state. Every call to `match` re-embeds the
 * intent, re-searches the index, and re-ranks. The index and the
 * recipe set are the caller's responsibility to keep in sync.
 * @param {MatcherConfig} config - The matcher configuration.
 * @returns {Matcher} The matcher.
 * @throws {Error} When the configuration is malformed.
 */
export function createMatcher (config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('createMatcher: config must be a plain object')
  }

  const { embedder, index, recipes } = config
  const topK = config.topK === undefined ? DEFAULT_TOP_K : config.topK
  const rankOptions = config.rankOptions
  const disambiguator = config.disambiguator

  if (embedder === null || typeof embedder !== 'object') {
    throw new Error('createMatcher: config.embedder must be an object')
  }
  if (typeof embedder.embed !== 'function') {
    throw new Error('createMatcher: config.embedder.embed must be a function')
  }
  if (index === null || typeof index !== 'object') {
    throw new Error('createMatcher: config.index must be an object')
  }
  if (typeof index.search !== 'function') {
    throw new Error('createMatcher: config.index.search must be a function')
  }
  if (!Array.isArray(recipes)) {
    throw new Error('createMatcher: config.recipes must be an array')
  }
  if (typeof topK !== 'number' || !Number.isInteger(topK) || topK <= 0) {
    throw new Error('createMatcher: config.topK must be a positive integer')
  }
  if (disambiguator !== undefined && typeof disambiguator !== 'function') {
    throw new Error('createMatcher: config.disambiguator must be a function when provided')
  }

  const recipeById = new Map()
  for (const recipe of recipes) {
    if (recipe === null || typeof recipe !== 'object') {
      throw new Error('createMatcher: every recipe must be an object')
    }
    if (typeof recipe.id !== 'string' || recipe.id.length === 0) {
      throw new Error('createMatcher: every recipe must have a non-empty id')
    }
    recipeById.set(recipe.id, recipe)
  }

  return {
    /**
     * Matches an intent against the recipe library.
     * @param {string} intent - The user's intent text.
     * @returns {Promise<MatchResult>} The match result.
     * @throws {Error} When the intent is not a non-empty string, or
     *   when a configured disambiguator returns an invalid result.
     */
    async match (intent) {
      if (typeof intent !== 'string' || intent.length === 0) {
        throw new Error('match: intent must be a non-empty string')
      }

      const vector = await embedder.embed(intent)
      const results = await index.search(vector, topK)

      const candidates = []
      for (const result of results) {
        if (!recipeById.has(result.id)) {
          continue
        }
        candidates.push({ recipeId: result.id, score: result.score })
      }

      const ranked = rankCandidates(candidates, rankOptions)

      if (ranked.kind !== 'ambiguous') {
        return ranked
      }
      if (disambiguator === undefined) {
        return ranked
      }

      const ambiguousRecipes = ranked.candidates.map(
        (candidate) => recipeById.get(candidate.recipeId)
      )
      const resolved = await disambiguator(intent, ranked.candidates, ambiguousRecipes)

      if (!isMatchResult(resolved)) {
        throw new Error('match: disambiguator returned an invalid MatchResult')
      }
      return resolved
    }
  }
}
