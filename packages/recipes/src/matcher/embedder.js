// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The default embedding dimension. Small enough to be fast, large
 * enough to reduce collisions on short intents.
 * @type {number}
 */
export const DEFAULT_EMBEDDING_DIMENSIONS = 256

/**
 * Splits text into lowercase tokens on non-alphanumeric boundaries.
 * No stemming, no stopword removal.
 * @param {string} text - The input text.
 * @returns {string[]} The tokens.
 */
function tokenize (text) {
  if (typeof text !== 'string') {
    return []
  }
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

/**
 * A stable 32-bit hash of a string. Uses FNV-1a. Deterministic
 * across processes and runtimes.
 * @param {string} value - The string to hash.
 * @returns {number} An unsigned 32-bit integer.
 */
function fnv1a (value) {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash >>> 0
}

/**
 * Creates a deterministic hash-based embedder. Each token maps to a
 * position in a fixed-dimension vector via FNV-1a. The vector is
 * L2-normalized on return.
 *
 * This is not a semantic embedding. It is a fast, dependency-free
 * featurizer that gives the vector index a default to work with
 * when no real model is configured. The SaaS should replace it with
 * a real model for production matching.
 * @param {object} [options] - Embedder options.
 * @param {number} [options.dimensions] - The vector dimension.
 *   Defaults to `DEFAULT_EMBEDDING_DIMENSIONS`.
 * @returns {Embedder} The embedder.
 */
export function createHashEmbedder (options) {
  const opts = options === undefined ? {} : options
  const dimensions = opts.dimensions === undefined
    ? DEFAULT_EMBEDDING_DIMENSIONS
    : opts.dimensions

  if (typeof dimensions !== 'number' || !Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('createHashEmbedder: dimensions must be a positive integer')
  }

  return {
    /**
     * Returns the vector dimension.
     * @returns {number} The dimension.
     */
    dimensions () {
      return dimensions
    },

    /**
     * Embeds text into a fixed-dimension vector.
     * @param {string} text - The text to embed.
     * @returns {Promise<number[]>} The vector.
     */
    async embed (text) {
      if (typeof text !== 'string') {
        throw new Error('embed: text must be a string')
      }
      const tokens = tokenize(text)
      if (tokens.length === 0) {
        throw new Error('embed: text produced no tokens')
      }
      const counts = new Map()
      for (const token of tokens) {
        counts.set(token, (counts.get(token) ?? 0) + 1)
      }
      const vector = new Array(dimensions).fill(0)
      for (const [token, count] of counts) {
        const index = fnv1a(token) % dimensions
        vector[index] += count
      }
      let magnitude = 0
      for (const x of vector) {
        magnitude += x * x
      }
      magnitude = Math.sqrt(magnitude)
      if (magnitude === 0) {
        throw new Error('embed: produced a zero vector')
      }
      for (let i = 0; i < dimensions; i++) {
        vector[i] /= magnitude
      }
      return vector
    }
  }
}
