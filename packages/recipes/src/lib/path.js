// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reads a dot-separated path from an object. Throws when any
 * segment is missing, when the current value is not an object, or
 * when null or undefined is encountered mid-traversal.
 * @param {unknown} source - The object to read from.
 * @param {string} path - Dot-separated property path.
 * @returns {unknown} The resolved value.
 * @throws {Error} When the path is not resolvable.
 */
export function readPath (source, path) {
  const segments = path.split('.')
  let current = source
  for (const segment of segments) {
    if (current === null || current === undefined) {
      throw new Error(`path "${path}" is not resolvable`)
    }
    if (typeof current !== 'object') {
      throw new Error(`path "${path}" is not resolvable`)
    }
    if (!Object.hasOwn(current, segment)) {
      throw new Error(`path "${path}" is not resolvable`)
    }
    current = current[segment]
  }
  return current
}
