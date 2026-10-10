// SPDX-License-Identifier: AGPL-3.0-or-later

const PARAM_SEGMENT = /^:([a-zA-Z][a-zA-Z0-9]*)$/

/**
 * Matches a request path against a route pattern. Segments in the
 * pattern that begin with `:` capture the corresponding path
 * segment. Returns the params object on match, or null on no match.
 * @param {string} pattern - The route pattern.
 * @param {string} path - The request path.
 * @returns {Record<string, string> | null} The captured params, or
 *   null when the path does not match.
 */
function matchPath (pattern, path) {
  const patternParts = pattern.split('/')
  const pathParts = path.split('/')
  if (patternParts.length !== pathParts.length) {
    return null
  }
  const params = {}
  for (let i = 0; i < patternParts.length; i++) {
    const patternSegment = patternParts[i]
    const pathSegment = pathParts[i]
    const paramMatch = patternSegment.match(PARAM_SEGMENT)
    if (paramMatch) {
      try {
        params[paramMatch[1]] = decodeURIComponent(pathSegment)
      } catch {
        params[paramMatch[1]] = pathSegment
      }
    } else if (patternSegment !== pathSegment) {
      return null
    }
  }
  return params
}

/**
 * Creates a router. Routes are matched in registration order; the
 * first matching route wins.
 * @returns {object} The router with `add`, `match`, and `routes`
 *   methods.
 */
export function createRouter () {
  const routes = []

  return {
    /**
     * Registers a route.
     * @param {string} method - The HTTP method, uppercase.
     * @param {string} pattern - The path pattern.
     * @param {Function} handler - The route handler.
     * @returns {void}
     * @throws {Error} When the arguments are malformed.
     */
    add (method, pattern, handler) {
      if (typeof method !== 'string' || method.length === 0) {
        throw new Error('router.add: method must be a non-empty string')
      }
      if (typeof pattern !== 'string' || !pattern.startsWith('/')) {
        throw new Error('router.add: pattern must start with "/"')
      }
      if (typeof handler !== 'function') {
        throw new Error('router.add: handler must be a function')
      }
      routes.push({ method, pattern, handler })
    },

    /**
     * Matches a method and path against the registered routes.
     * Returns the handler and captured params, or null when no
     * route matches.
     * @param {string} method - The HTTP method.
     * @param {string} path - The request path, without query.
     * @returns {{ handler: Function, params: Record<string, string> } | null} The match, or null.
     */
    match (method, path) {
      for (const route of routes) {
        if (route.method !== method) {
          continue
        }
        const params = matchPath(route.pattern, path)
        if (params !== null) {
          return { handler: route.handler, params }
        }
      }
      return null
    },

    /**
     * Returns the methods registered for a given path, in
     * registration order, deduplicated.
     * @param {string} path - The request path.
     * @returns {string[]} The allowed methods.
     */
    methodsFor (path) {
      const seen = new Set()
      const result = []
      for (const route of routes) {
        if (matchPath(route.pattern, path) !== null) {
          if (!seen.has(route.method)) {
            seen.add(route.method)
            result.push(route.method)
          }
        }
      }
      return result
    },

    /**
     * Returns the number of registered routes.
     * @returns {number} The route count.
     */
    size () {
      return routes.length
    }
  }
}
