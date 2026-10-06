/**
 * Database backend selection and resolver module.
 *
 * @module @atoll/app/lib/db/backends/index
 */

import { createMemoryBackend } from './memory.js'
import { createWasmBackend } from './wasm.js'

/**
 * Immutable list of supported database backend identifiers.
 *
 * @type {readonly string[]}
 */
export const SUPPORTED_BACKENDS = Object.freeze(['wasm', 'memory'])

/**
 * Resolves and creates a database backend instance for the specified preference or environment.
 *
 * @param {object} [options] - Resolution options.
 * @param {string} [options.prefer] - Preferred backend type ('wasm' | 'memory').
 * @returns {Promise<object>} Backend instance.
 */
export async function resolveBackend({ prefer } = {}) {
  if (prefer === 'memory') {
    return createMemoryBackend()
  }
  if (prefer === 'wasm') {
    return createWasmBackend()
  }

  // Automatic environment selection: web browser or web worker -> WASM; Node -> memory
  if (typeof window !== 'undefined' || typeof importScripts !== 'undefined') {
    return createWasmBackend()
  }

  return createMemoryBackend()
}
