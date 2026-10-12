// SPDX-License-Identifier: AGPL-3.0-or-later

import { compile } from '../../compiler/index.js'

/**
 * Returns true when the value is a plain object.
 * @param {unknown} value - The value to test.
 * @returns {boolean} True when the value is a non-null non-array
 *   object.
 */
function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validates the compile request body. Returns null when valid, or
 * a human-readable message when not.
 * @param {unknown} body - The request body.
 * @returns {string | null} The error message, or null when valid.
 */
function validateBody (body) {
  if (!isPlainObject(body)) {
    return 'Request body must be a JSON object'
  }
  if (typeof body.recipeId !== 'string' || body.recipeId.length === 0) {
    return 'recipeId is required'
  }
  if (typeof body.recipeVersion !== 'string' || body.recipeVersion.length === 0) {
    return 'recipeVersion is required'
  }
  if (typeof body.botId !== 'string' || body.botId.length === 0) {
    return 'botId is required'
  }
  if (typeof body.label !== 'string' || body.label.length === 0) {
    return 'label is required'
  }
  if (body.slots !== undefined && !isPlainObject(body.slots)) {
    return 'slots must be a plain object when provided'
  }
  if (body.avatar !== undefined && !isPlainObject(body.avatar)) {
    return 'avatar must be a plain object when provided'
  }
  if (body.apiVersion !== undefined && typeof body.apiVersion !== 'string') {
    return 'apiVersion must be a string when provided'
  }
  if (body.hostApi !== undefined && typeof body.hostApi !== 'string') {
    return 'hostApi must be a string when provided'
  }
  return null
}

/**
 * Builds the Instantiation from the request body.
 * @param {object} body - The validated request body.
 * @returns {Instantiation} The instantiation.
 */
function buildInstantiation (body) {
  return {
    recipeId: body.recipeId,
    recipeVersion: body.recipeVersion,
    slots: body.slots === undefined ? {} : body.slots
  }
}

/**
 * Builds the emitter options from the request body.
 * @param {object} body - The validated request body.
 * @returns {object} The options.
 */
function buildOptions (body) {
  const options = {
    botId: body.botId,
    label: body.label
  }
  if (body.apiVersion !== undefined) {
    options.apiVersion = body.apiVersion
  }
  if (body.hostApi !== undefined) {
    options.hostApi = body.hostApi
  }
  if (body.avatar !== undefined) {
    options.avatar = body.avatar
  }
  return options
}

/**
 * Registers the POST /v1/compile endpoint on the given server.
 *
 * Reads a compile request, validates its shape, runs the compiler
 * pipeline, and returns the resulting BotScript. Request-shape
 * errors produce 400; compilation errors produce 422.
 * @param {object} server - The server created by `createServer`.
 * @param {object} deps - The endpoint's dependencies.
 * @param {string} deps.rootDir - The recipe library root directory.
 * @param {string} [deps.llmProxyUrl] - Optional LLM proxy URL to pass to compiler.
 * @returns {void}
 * @throws {Error} When server or deps are malformed.
 */
export function registerCompileRoute (server, deps) {
  if (server === null || typeof server !== 'object') {
    throw new Error('registerCompileRoute: server must be an object')
  }
  if (typeof server.addRoute !== 'function') {
    throw new Error('registerCompileRoute: server.addRoute must be a function')
  }
  if (deps === null || typeof deps !== 'object') {
    throw new Error('registerCompileRoute: deps must be an object')
  }
  if (typeof deps.rootDir !== 'string' || deps.rootDir.length === 0) {
    throw new Error('registerCompileRoute: deps.rootDir must be a non-empty string')
  }
  if (deps.llmProxyUrl !== undefined && (typeof deps.llmProxyUrl !== 'string' || deps.llmProxyUrl.length === 0)) {
    throw new Error('registerCompileRoute: deps.llmProxyUrl must be a non-empty string when provided')
  }

  const { rootDir, llmProxyUrl } = deps

  server.addRoute('POST', '/v1/compile', async (ctx) => {
    const validationError = validateBody(ctx.body)
    if (validationError !== null) {
      ctx.error(400, 'invalid_request', validationError)
      return
    }

    const instantiation = buildInstantiation(ctx.body)
    const options = buildOptions(ctx.body)
    if (llmProxyUrl !== undefined) {
      options.llmProxyUrl = llmProxyUrl
    }

    let script
    try {
      script = await compile(rootDir, instantiation, options)
    } catch (err) {
      ctx.error(422, 'compile_failed', err.message)
      return
    }

    ctx.json(200, script)
  })
}
