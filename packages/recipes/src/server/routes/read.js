// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { scanLibrary, loadRecipeById } from '../../recipe/library.js'

const RECIPE_ID = /^[a-z][a-z0-9-]*$/

/**
 * Reads the recipe's markdown documentation when it exists. Returns
 * null when the file is missing or cannot be read.
 * @param {string} rootDir - The library root directory.
 * @param {string} id - The recipe id.
 * @returns {Promise<string | null>} The markdown text, or null.
 */
async function readMarkdown (rootDir, id) {
  const mdPath = join(resolve(rootDir), id, 'recipe.md')
  try {
    return await readFile(mdPath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Removes the internal `dir` field from a library summary.
 * @param {object} summary - A summary from scanLibrary.
 * @returns {object} The summary without the internal path.
 */
function stripDir (summary) {
  const result = {}
  for (const key of Object.keys(summary)) {
    if (key !== 'dir') {
      result[key] = summary[key]
    }
  }
  return result
}

/**
 * Registers the read endpoints on the given server:
 *
 * - `GET /v1/version`
 * - `GET /v1/recipes`
 * - `GET /v1/recipes/:id`
 *
 * All three are read-only, take no request body, and depend on the
 * library root and the engine version supplied by the caller.
 * @param {object} server - The server created by `createServer`.
 * @param {object} deps - The endpoint's dependencies.
 * @param {string} deps.rootDir - The recipe library root directory.
 * @param {string} deps.version - The engine version.
 * @returns {void}
 * @throws {Error} When server or deps are malformed.
 */
export function registerReadRoutes (server, deps) {
  if (server === null || typeof server !== 'object') {
    throw new Error('registerReadRoutes: server must be an object')
  }
  if (typeof server.addRoute !== 'function') {
    throw new Error('registerReadRoutes: server.addRoute must be a function')
  }
  if (deps === null || typeof deps !== 'object') {
    throw new Error('registerReadRoutes: deps must be an object')
  }
  if (typeof deps.rootDir !== 'string' || deps.rootDir.length === 0) {
    throw new Error('registerReadRoutes: deps.rootDir must be a non-empty string')
  }
  if (typeof deps.version !== 'string' || deps.version.length === 0) {
    throw new Error('registerReadRoutes: deps.version must be a non-empty string')
  }

  const { rootDir, version } = deps

  server.addRoute('GET', '/v1/version', (ctx) => {
    ctx.json(200, { version })
  })

  server.addRoute('GET', '/v1/recipes', async (ctx) => {
    const { recipes, errors } = await scanLibrary(rootDir)
    ctx.json(200, {
      recipes: recipes.map(stripDir),
      errors
    })
  })

  server.addRoute('GET', '/v1/recipes/:id', async (ctx) => {
    const id = ctx.params.id
    if (!RECIPE_ID.test(id)) {
      ctx.error(400, 'invalid_request', 'recipe id must match ^[a-z][a-z0-9-]*$')
      return
    }

    let recipe
    try {
      recipe = await loadRecipeById(rootDir, id)
    } catch {
      ctx.error(404, 'recipe_not_found', `Recipe "${id}" could not be loaded`)
      return
    }

    const markdown = await readMarkdown(rootDir, id)
    ctx.json(200, { recipe, markdown })
  })
}
