// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Computes the L2 norm of a vector.
 * @param {number[]} vector - The vector.
 * @returns {number} The norm.
 */
function norm (vector) {
  let sum = 0
  for (const x of vector) {
    sum += x * x
  }
  return Math.sqrt(sum)
}

/**
 * Returns a new vector with unit L2 norm. Throws when the input has
 * zero magnitude.
 * @param {number[]} vector - The vector to normalize.
 * @returns {number[]} The normalized vector.
 * @throws {Error} When the vector is empty, has non-finite entries,
 *   or has zero magnitude.
 */
export function normalizeVector (vector) {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('normalizeVector: vector must be a non-empty array')
  }
  for (const x of vector) {
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new Error('normalizeVector: vector must contain only finite numbers')
    }
  }
  const n = norm(vector)
  if (n === 0) {
    throw new Error('normalizeVector: vector has zero magnitude')
  }
  const result = new Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    result[i] = vector[i] / n
  }
  return result
}

/**
 * Computes the cosine similarity of two unit vectors. Both must be
 * the same length. Since the inputs are normalized, this is a
 * straightforward dot product.
 * @param {number[]} a - The first unit vector.
 * @param {number[]} b - The second unit vector.
 * @returns {number} The cosine similarity, in [-1, 1].
 * @throws {Error} When the vectors differ in length.
 */
export function cosineSimilarity (a, b) {
  if (a.length !== b.length) {
    throw new Error('cosineSimilarity: vectors must be the same length')
  }
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return dot
}

/**
 * Creates an in-memory vector index. The first add fixes the
 * dimension. Subsequent adds with a different dimension throw.
 * @returns {object} The index.
 */
export function createVectorIndex () {
  let dimensions = 0
  const entries = new Map()

  return {
    /**
     * The current dimensions of the index, or 0 when empty.
     * @returns {number} The dimensions.
     */
    dimensions () {
      return dimensions
    },

    /**
     * The number of entries in the index.
     * @returns {number} The entry count.
     */
    size () {
      return entries.size
    },

    /**
     * Adds a vector under the given id, overwriting any existing
     * entry. The vector is normalized before storage.
     * @param {string} id - The entry id.
     * @param {number[]} vector - The vector to add.
     * @returns {void}
     * @throws {Error} When id is not a non-empty string, when the
     *   vector dimension does not match, or when the vector cannot
     *   be normalized.
     */
    add (id, vector) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('vectorIndex.add: id must be a non-empty string')
      }
      const normalized = normalizeVector(vector)
      if (dimensions === 0) {
        dimensions = normalized.length
      } else if (normalized.length !== dimensions) {
        throw new Error(
          `vectorIndex.add: expected ${dimensions} dimensions, got ${normalized.length}`
        )
      }
      entries.set(id, normalized)
    },

    /**
     * Removes an entry by id. Silently ignores unknown ids.
     * @param {string} id - The entry id.
     * @returns {void}
     */
    remove (id) {
      entries.delete(id)
    },

    /**
     * Returns true when an id is present.
     * @param {string} id - The entry id.
     * @returns {boolean} True when present.
     */
    has (id) {
      return entries.has(id)
    },

    /**
     * Searches the index for the top-k nearest entries by cosine
     * similarity. Ties are broken by id ascending.
     * @param {number[]} query - The query vector.
     * @param {number} k - The maximum number of results.
     * @returns {{ id: string, score: number }[]} The results, in
     *   descending order of score.
     * @throws {Error} When query dimension does not match the index,
     *   when k is not a positive integer, or when the query cannot
     *   be normalized.
     */
    search (query, k) {
      if (typeof k !== 'number' || !Number.isInteger(k) || k <= 0) {
        throw new Error('vectorIndex.search: k must be a positive integer')
      }
      if (entries.size === 0) {
        return []
      }
      const normalized = normalizeVector(query)
      if (normalized.length !== dimensions) {
        throw new Error(
          `vectorIndex.search: expected ${dimensions} dimensions, got ${normalized.length}`
        )
      }

      const results = []
      for (const [id, vector] of entries) {
        results.push({ id, score: cosineSimilarity(normalized, vector) })
      }
      results.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
      return results.slice(0, k)
    },

    /**
     * Clears the index and resets the dimension.
     * @returns {void}
     */
    clear () {
      entries.clear()
      dimensions = 0
    }
  }
}
