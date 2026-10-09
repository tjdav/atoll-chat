// SPDX-License-Identifier: AGPL-3.0-or-later

const TOKEN = /\{\{([a-zA-Z0-9_.]+)\}\}/g

/**
 * Reads a dot-separated path from an object.
 * @param {unknown} source - The object to read from.
 * @param {string} path - Dot-separated property path.
 * @returns {unknown} The resolved value.
 * @throws {Error} When a segment is missing or source is not an
 *   object at that point.
 */
function readPath (source, path) {
  const segments = path.split('.')
  let current = source
  for (const segment of segments) {
    if (current === null || current === undefined) {
      throw new Error(`substitute: path "${path}" is not resolvable`)
    }
    if (typeof current !== 'object') {
      throw new Error(`substitute: path "${path}" is not resolvable`)
    }
    if (!Object.hasOwn(current, segment)) {
      throw new Error(`substitute: path "${path}" is not resolvable`)
    }
    current = current[segment]
  }
  return current
}

/**
 * Returns true when the string is exactly one substitution token.
 * @param {string} value - The string to test.
 * @returns {boolean} True when the whole string is a single token.
 */
function isSingleToken (value) {
  const matches = value.match(TOKEN)
  if (!matches || matches.length !== 1) {
    return false
  }
  return matches[0] === value
}

/**
 * Substitutes `{{path}}` tokens against the input. Strings that are
 * exactly one token preserve the resolved value's type. Strings that
 * mix text and tokens coerce to string.
 * @param {unknown} value - The config value to substitute.
 * @param {unknown} input - The handler input to resolve paths against.
 * @returns {unknown} The substituted value.
 * @throws {Error} When a path cannot be resolved.
 */
export function substitute (value, input) {
  if (typeof value === 'string') {
    if (isSingleToken(value)) {
      const path = value.slice(2, -2)
      return readPath(input, path)
    }
    return value.replace(TOKEN, (_, path) => {
      const resolved = readPath(input, path)
      return String(resolved)
    })
  }
  if (Array.isArray(value)) {
    return value.map((item) => substitute(item, input))
  }
  if (value !== null && typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value)) {
      result[key] = substitute(value[key], input)
    }
    return result
  }
  return value
}
