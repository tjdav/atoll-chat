import { validateExtensionShape } from './validate.js'
import { normalizeExtension } from './normalize.js'
import { EXTENSION_API_VERSION } from './constants.js'

/**
 * Normalizes and validates an extension definition object.
 *
 * @param {object} ext - Raw extension object.
 * @returns {object} Normalized extension object.
 */
export function defineExtension(ext) {
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) {
    throw new Error('defineExtension requires an object')
  }
  validateExtensionShape(ext)
  const normalized = normalizeExtension(ext)
  normalized._sdkApiVersion = EXTENSION_API_VERSION
  return normalized
}
