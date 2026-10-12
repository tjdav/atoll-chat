// SPDX-License-Identifier: AGPL-3.0-or-later

import { readPath } from './path.js'

const TOKEN = /\{\{([a-zA-Z0-9_.]+)\}\}/g

/**
 * Resolves a substitution path against the input. The special path
 * `.` refers to the input itself; every other path is traversed
 * normally.
 * @param {unknown} input - The handler input.
 * @param {string} path - The substitution path.
 * @returns {unknown} The resolved value.
 * @throws {Error} When a non-dot path cannot be resolved.
 */
function resolvePath (input, path) {
  if (path === '.') {
    return input
  }
  return readPath(input, path)
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
 * Substitutes `{{path}}` tokens against the input. `{{.}}` refers to
 * the input itself. Strings that are exactly one token preserve the
 * resolved value's type. Strings that mix text and tokens coerce to
 * string.
 * @param {unknown} value - The config value to substitute.
 * @param {unknown} input - The handler input to resolve paths against.
 * @returns {unknown} The substituted value.
 * @throws {Error} When a non-dot path cannot be resolved.
 */
export function substitute (value, input) {
  if (typeof value === 'string') {
    if (isSingleToken(value)) {
      const path = value.slice(2, -2)
      return resolvePath(input, path)
    }
    return value.replace(TOKEN, (_, path) => {
      const resolved = resolvePath(input, path)
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
