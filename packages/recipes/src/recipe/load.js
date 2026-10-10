// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from 'node:fs/promises'

import { validateRecipe, formatErrors } from './validate.js'

/**
 * Parses and validates recipe JSON text. Throws when the text is
 * not valid JSON or when the parsed value fails validation.
 * @param {string} text - The recipe JSON text.
 * @returns {Recipe} The validated recipe.
 * @throws {Error} When parsing or validation fails.
 */
export function parseRecipe (text) {
  if (typeof text !== 'string') {
    throw new Error('parseRecipe: text must be a string')
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(`parseRecipe: invalid JSON: ${err.message}`)
  }

  const result = validateRecipe(parsed)
  if (!result.valid) {
    throw new Error(
      `parseRecipe: invalid recipe:\n${formatErrors(result.errors)}`
    )
  }
  return result.recipe
}

/**
 * Reads a recipe.json file from disk, parses it, validates it, and
 * returns the recipe. Wraps file-system, parse, and validation
 * errors with the file path so multi-file loading is diagnosable.
 * @param {string} filePath - Path to a recipe.json file.
 * @returns {Promise<Recipe>} The validated recipe.
 * @throws {Error} When the file cannot be read, parsed, or
 *   validated.
 */
export async function loadRecipeFile (filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('loadRecipeFile: filePath must be a non-empty string')
  }

  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (err) {
    throw new Error(`loadRecipeFile: cannot read ${filePath}: ${err.message}`)
  }

  try {
    return parseRecipe(text)
  } catch (err) {
    throw new Error(`loadRecipeFile: ${filePath}: ${err.message}`)
  }
}
