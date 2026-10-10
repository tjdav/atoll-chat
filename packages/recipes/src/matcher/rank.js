// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The default score threshold for candidate ranking.
 * @type {number}
 */
export const DEFAULT_THRESHOLD = 0.55

/**
 * The default score gap required between the top two candidates for
 * a confident match.
 * @type {number}
 */
export const DEFAULT_MARGIN = 0.05

/**
 * Returns true when the value looks like a valid candidate.
 * @param {unknown} value - The value to test.
 * @returns {boolean} True when the value is a candidate-shaped
 *   object with a string recipeId and a finite numeric score.
 */
function isCandidate (value) {
  if (value === null || typeof value !== 'object') {
    return false
  }
  if (typeof value.recipeId !== 'string' || value.recipeId.length === 0) {
    return false
  }
  if (typeof value.score !== 'number') {
    return false
  }
  if (!Number.isFinite(value.score)) {
    return false
  }
  return true
}

/**
 * Ranks a list of candidates and returns a MatchResult.
 *
 * Sorts by score descending, filters by threshold, and decides
 * between match, ambiguous, and refusal. The top candidate is a
 * confident match when its score exceeds the second's by at least
 * the margin. Two candidates closer than the margin produce an
 * ambiguous result, which the pipeline resolves via disambiguation.
 *
 * The input array is not mutated.
 * @param {Candidate[]} candidates - The candidate list.
 * @param {RankOptions} [options] - Ranking options.
 * @returns {MatchResult} The match result.
 * @throws {Error} When candidates is not an array or contains
 *   malformed entries.
 */
export function rankCandidates (candidates, options) {
  if (!Array.isArray(candidates)) {
    throw new Error('rankCandidates: candidates must be an array')
  }
  for (const candidate of candidates) {
    if (!isCandidate(candidate)) {
      throw new Error('rankCandidates: every candidate must have a recipeId string and a finite score')
    }
  }

  const opts = options === undefined ? {} : options
  const threshold = opts.threshold === undefined ? DEFAULT_THRESHOLD : opts.threshold
  const margin = opts.margin === undefined ? DEFAULT_MARGIN : opts.margin

  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    throw new Error('rankCandidates: options.threshold must be a finite number')
  }
  if (typeof margin !== 'number' || !Number.isFinite(margin) || margin < 0) {
    throw new Error('rankCandidates: options.margin must be a non-negative finite number')
  }

  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const filtered = sorted.filter((c) => c.score >= threshold)

  if (filtered.length === 0) {
    return {
      kind: 'refusal',
      reason: 'No candidate matches with sufficient confidence.',
      suggestions: sorted.slice(0, 3)
    }
  }

  if (filtered.length === 1) {
    const top = filtered[0]
    return {
      kind: 'match',
      recipeId: top.recipeId,
      confidence: top.score,
      candidates: filtered
    }
  }

  const top = filtered[0]
  const second = filtered[1]
  const gap = top.score - second.score

  if (gap >= margin) {
    return {
      kind: 'match',
      recipeId: top.recipeId,
      confidence: top.score,
      candidates: filtered
    }
  }

  const close = filtered.filter((c) => top.score - c.score < margin)
  return {
    kind: 'ambiguous',
    candidates: close
  }
}
