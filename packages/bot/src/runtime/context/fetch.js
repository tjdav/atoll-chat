/**
 * @file Outbound HTTP fetch utilities for bot runtime context.
 */

/**
 * @typedef {(url: string, opts?: RequestInit) => Promise<Response>} FetchMethod
 */

/**
 * Removes the query string and fragment from a URL for logging.
 * A valid URL is parsed and re-serialized without search or hash parameters.
 * A malformed URL has everything after the first `?` or `#` removed textually.
 *
 * @param {string} url - The URL to strip.
 * @returns {string} The URL without query string or fragment.
 */
export function stripQuery (url) {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    const qIndex = url.indexOf('?')
    const hIndex = url.indexOf('#')
    let end = url.length
    if (qIndex !== -1) {
      end = Math.min(end, qIndex)
    }
    if (hIndex !== -1) {
      end = Math.min(end, hIndex)
    }
    return url.slice(0, end)
  }
}

/**
 * Creates the `ctx.fetch` and `ctx.fetchUserUrl` methods.
 *
 * Both methods perform an HTTP request and return the response.
 * Neither throws on a non-2xx status; the caller inspects `response.ok`.
 * Network errors propagate unchanged.
 *
 * @param {object} [options] - Options object.
 * @param {import('../diagnostics/logger.js').Logger} [options.logger] - Optional logger instance.
 * @param {typeof globalThis.fetch} [options.fetchImpl=globalThis.fetch] - The fetch implementation to use.
 * @returns {{ fetch: FetchMethod, fetchUserUrl: FetchMethod }} Object containing fetch and fetchUserUrl methods.
 */
export function createFetchMethods ({ logger, fetchImpl = globalThis.fetch } = {}) {
  /**
   * Internal implementation helper for outbound fetches.
   *
   * @param {string} url - Target URL string.
   * @param {RequestInit} [opts] - Request options.
   * @param {string|null} [onBehalfOf] - Diagnostic tag indicating request origin.
   * @returns {Promise<Response>} HTTP Response object.
   */
  async function doFetch (url, opts, onBehalfOf = null) {
    if (typeof url !== 'string' || url.length === 0) {
      throw new TypeError('fetch: url must be a non-empty string')
    }

    let parsed
    try {
      parsed = new URL(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new TypeError(`fetch: url is not a valid URL: ${message}`)
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new TypeError(`fetch: unsupported scheme '${parsed.protocol}'`)
    }

    const safeUrl = stripQuery(url)
    const method = typeof opts?.method === 'string' ? opts.method.toUpperCase() : 'GET'
    const hasBody = opts?.body != null
    const startMs = Date.now()

    /** @type {Record<string, unknown>} */
    const entryMeta = {
      method,
      url: safeUrl,
      has_body: hasBody
    }
    if (onBehalfOf) {
      entryMeta.on_behalf_of = onBehalfOf
    }

    if (logger?.debug) {
      logger.debug('fetch', entryMeta)
    }

    let response
    try {
      response = await fetchImpl(url, opts)
    } catch (err) {
      const durationMs = Date.now() - startMs
      const errMessage = err instanceof Error ? err.message : String(err)
      /** @type {Record<string, unknown>} */
      const failMeta = {
        method,
        url: safeUrl,
        duration_ms: durationMs,
        error: errMessage
      }
      if (onBehalfOf) {
        failMeta.on_behalf_of = onBehalfOf
      }
      if (logger?.warn) {
        logger.warn('fetch failed', failMeta)
      }
      throw err
    }

    const durationMs = Date.now() - startMs
    /** @type {Record<string, unknown>} */
    const successMeta = {
      method,
      url: safeUrl,
      status: response.status,
      duration_ms: durationMs
    }
    if (onBehalfOf) {
      successMeta.on_behalf_of = onBehalfOf
    }

    if (logger?.debug) {
      logger.debug('fetch completed', successMeta)
    }

    return response
  }

  return {
    fetch: (url, opts) => doFetch(url, opts, null),
    fetchUserUrl: (url, opts) => doFetch(url, opts, 'user')
  }
}
