// SPDX-License-Identifier: AGPL-3.0-or-later

import { substitute } from '../lib/substitute.js'

const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const VALID_RESPONSE_MODES = ['json', 'text', 'status']

/**
 * Returns the request body in a form suitable for fetch, along with
 * a content-type header when the body is an object.
 * @param {unknown} body - The resolved body value.
 * @returns {{ body: string | undefined, contentType: string | null }} The serialized body and the content-type the caller should apply, if any.
 */
function serializeBody (body) {
  if (body === undefined || body === null) {
    return { body: undefined, contentType: null }
  }
  if (typeof body === 'string') {
    return { body, contentType: null }
  }
  return { body: JSON.stringify(body), contentType: 'application/json' }
}

/**
 * http-fetch makes an HTTP request and passes the parsed response to
 * its children. Non-2xx responses and network errors throw.
 *
 * The primitive requires no capabilities. ctx.fetch handles
 * authorization-header redaction and query-string stripping in logs.
 * @type {Primitive}
 */
export const httpFetch = {
  id: 'http-fetch',
  targets: ['bot'],
  capabilities: [],
  label: 'HTTP Fetch',
  description: 'Makes an HTTP request and passes the response to children.',
  configSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', minLength: 1 },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
      headers: { type: 'object' },
      body: {},
      responseMode: { type: 'string', enum: ['json', 'text', 'status'], default: 'json' }
    },
    required: ['url'],
    additionalProperties: false
  },
  create: (config, children) => {
    const url = config.url
    const method = config.method === undefined ? 'GET' : config.method
    const headers = config.headers
    const body = config.body
    const responseMode = config.responseMode === undefined ? 'json' : config.responseMode
    const hasBody = Object.hasOwn(config, 'body')

    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('http-fetch: config.url is required')
    }
    if (!VALID_METHODS.includes(method)) {
      throw new Error(
        'http-fetch: config.method must be one of GET, POST, PUT, PATCH, DELETE'
      )
    }
    if (headers !== undefined) {
      if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) {
        throw new Error('http-fetch: config.headers must be a plain object')
      }
    }
    if (!VALID_RESPONSE_MODES.includes(responseMode)) {
      throw new Error(
        'http-fetch: config.responseMode must be one of json, text, status'
      )
    }
    if (method === 'GET' && hasBody) {
      throw new Error('http-fetch: GET requests cannot have a body')
    }
    if (!Array.isArray(children)) {
      throw new Error('http-fetch: children must be an array')
    }

    return async (ctx, input) => {
      const resolvedUrl = substitute(url, input)
      if (typeof resolvedUrl !== 'string' || resolvedUrl.length === 0) {
        throw new Error('http-fetch: resolved url is empty')
      }

      const resolvedHeaders = headers === undefined
        ? {}
        : substitute(headers, input)

      const resolvedBody = hasBody ? substitute(body, input) : undefined
      const serialized = serializeBody(resolvedBody)

      const finalHeaders = { ...resolvedHeaders }
      if (serialized.contentType !== null && !Object.hasOwn(finalHeaders, 'content-type')) {
        finalHeaders['content-type'] = serialized.contentType
      }

      const init = {
        method,
        headers: finalHeaders
      }
      if (serialized.body !== undefined) {
        init.body = serialized.body
      }

      const response = await ctx.fetch(resolvedUrl, init)

      if (!response.ok) {
        throw new Error(
          `http-fetch: request failed with status ${response.status}`
        )
      }

      let output
      if (responseMode === 'status') {
        output = response.status
      } else if (responseMode === 'text') {
        output = await response.text()
      } else {
        const raw = await response.text()
        try {
          output = JSON.parse(raw)
        } catch (err) {
          throw new Error(`http-fetch: response is not valid JSON: ${err.message}`)
        }
      }

      for (const child of children) {
        await child(ctx, output)
      }
    }
  }
}
