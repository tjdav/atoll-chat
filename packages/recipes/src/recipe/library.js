// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { loadRecipeFile } from './load.js'

const RECIPE_ID = /^[a-z][a-z0-9-]*$/

/**
 * Returns true when the path exists and is a directory.
 * @param {string} path - The path to test.
 * @returns {Promise<boolean>} True when the path is a directory.
 */
async function isDirectory (path) {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

/**
 * Builds a summary from a full recipe. The summary carries the
 * fields the matcher and the gallery need; it does not carry the
 * handlers or slots.
 * @param {Recipe} recipe - The full recipe.
 * @param {string} dir - The recipe's directory.
 * @returns {object} The summary.
 */
function summarize (recipe, dir) {
  return {
    id: recipe.id,
    version: recipe.version,
    label: recipe.label,
    description: recipe.description,
    kind: recipe.kind,
    targets: recipe.targets === undefined ? ['bot'] : recipe.targets,
    dir
  }
}

/**
 * Scans a library directory. Returns summaries for every valid
 * recipe and errors for every invalid one. Subdirectories without a
 * recipe.json are skipped silently.
 *
 * Throws when rootDir is not a valid directory. A missing library
 * root is a configuration error, not a per-recipe error.
 * @param {string} rootDir - The library root directory.
 * @returns {Promise<{ recipes: object[], errors: { path: string, message: string }[] }>} The scan result.
 */
export async function scanLibrary (rootDir) {
  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    throw new Error('scanLibrary: rootDir must be a non-empty string')
  }

  const absoluteRoot = resolve(rootDir)

  if (!(await isDirectory(absoluteRoot))) {
    throw new Error(`scanLibrary: ${absoluteRoot} is not a directory`)
  }

  const entries = await readdir(absoluteRoot, { withFileTypes: true })
  const recipes = []
  const errors = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const recipeDir = join(absoluteRoot, entry.name)
    const recipePath = join(recipeDir, 'recipe.json')

    if (!(await isDirectory(recipeDir))) {
      continue
    }

    let recipeFileExists = false
    try {
      const info = await stat(recipePath)
      recipeFileExists = info.isFile()
    } catch {
      recipeFileExists = false
    }

    if (!recipeFileExists) {
      continue
    }

    try {
      const recipe = await loadRecipeFile(recipePath)
      recipes.push(summarize(recipe, recipeDir))
    } catch (err) {
      errors.push({ path: recipePath, message: err.message })
    }
  }

  recipes.sort((a, b) => a.id.localeCompare(b.id))

  return { recipes, errors }
}

/**
 * Loads a full recipe by id from a library directory. Resolves the
 * id to `<rootDir>/<id>/recipe.json` and loads it.
 * @param {string} rootDir - The library root directory.
 * @param {string} id - The recipe id.
 * @returns {Promise<Recipe>} The validated recipe.
 * @throws {Error} When rootDir or id is invalid, when the id does
 *   not match the recipe id pattern, or when the recipe cannot be
 *   loaded.
 */
export async function loadRecipeById (rootDir, id) {
  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    throw new Error('loadRecipeById: rootDir must be a non-empty string')
  }
  if (typeof id !== 'string' || !RECIPE_ID.test(id)) {
    throw new Error('loadRecipeById: id must match ^[a-z][a-z0-9-]*$')
  }

  const absoluteRoot = resolve(rootDir)
  const recipePath = join(absoluteRoot, id, 'recipe.json')

  try {
    return await loadRecipeFile(recipePath)
  } catch (err) {
    throw new Error(`loadRecipeById: recipe "${id}": ${err.message}`)
  }
}
