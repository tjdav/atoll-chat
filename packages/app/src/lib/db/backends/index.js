/**
 * Database backend selection and resolver module.
 *
 * @module @atoll/app/lib/db/backends/index
 */

import { createMemoryBackend } from './memory.js'

/**
 * Immutable list of supported database backend identifiers.
 *
 * @type {readonly string[]}
 */
export const SUPPORTED_BACKENDS = Object.freeze(['memory'])

/**
 * Resolves and creates a database backend instance for the specified preference.
 *
 * @param {object} [options] - Resolution options.
 * @param {string} [options.prefer] - Preferred backend type ('memory').
 * @returns {object} Backend instance.
 */
export function resolveBackend({ prefer } = {}) {
  const chosen = prefer ?? 'memory'
  if (chosen === 'memory') {
    return createMemoryBackend()
  }
  throw new Error(`Unsupported backend requested: ${chosen}. Supported backends are: ${SUPPORTED_BACKENDS.join(', ')}`)
}
