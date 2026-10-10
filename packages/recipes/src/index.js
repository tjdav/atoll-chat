// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @atoll/recipes — the bot recipe engine.
 * See docs/spec.md for the specification.
 */

/**
 * The engine version. Reported by the service and embedded in
 * generated artifacts.
 * @type {string}
 */
export const version = '0.0.0'

export { primitives, getPrimitive, listPrimitives } from './primitives/index.js'
export { validateRecipe, formatErrors } from './recipe/validate.js'
export { parseRecipe, loadRecipeFile } from './recipe/load.js'
