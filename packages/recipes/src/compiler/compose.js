// SPDX-License-Identifier: AGPL-3.0-or-later

import { loadRecipeById } from '../recipe/library.js'

const SLOT_TOKEN = /(?<!\{)\{([a-zA-Z][a-zA-Z0-9]*)\}(?!\})/g

/**
 * Returns true when the string consists of exactly one slot token
 * with nothing around it. Used to decide whether a substituted value
 * preserves its type or coerces to string.
 * @param {string} value - The string to test.
 * @returns {boolean} True when the whole string is a single slot.
 */
function isSingleSlotToken (value) {
  const matches = value.match(SLOT_TOKEN)
  if (!matches || matches.length !== 1) {
    return false
  }
  return matches[0] === value
}

/**
 * Substitutes `{slotName}` tokens in a config value against the
 * resolved slots. Single-token strings preserve the slot value's
 * type; mixed strings coerce. Double-brace tokens (`{{path}}`) are
 * left untouched; they are handled at dispatch time.
 * @param {unknown} value - The config value.
 * @param {Record<string, unknown>} slots - The resolved slots.
 * @returns {unknown} The substituted value.
 * @throws {Error} When a referenced slot is not provided.
 */
function resolveSlots (value, slots) {
  if (typeof value === 'string') {
    if (isSingleSlotToken(value)) {
      const name = value.slice(1, -1)
      if (!Object.hasOwn(slots, name)) {
        throw new Error(`compose: slot "${name}" is not provided`)
      }
      return slots[name]
    }
    return value.replace(SLOT_TOKEN, (_, name) => {
      if (!Object.hasOwn(slots, name)) {
        throw new Error(`compose: slot "${name}" is not provided`)
      }
      return String(slots[name])
    })
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveSlots(item, slots))
  }
  if (value !== null && typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value)) {
      result[key] = resolveSlots(value[key], slots)
    }
    return result
  }
  return value
}

/**
 * Resolves a primitive instance's config and children recursively.
 * Returns a new instance; does not mutate the input.
 * @param {PrimitiveInstance} instance - The instance.
 * @param {Record<string, unknown>} slots - The resolved slots.
 * @returns {PrimitiveInstance} The resolved instance.
 */
function resolveInstance (instance, slots) {
  const result = {
    id: instance.id,
    primitive: instance.primitive,
    config: resolveSlots(instance.config, slots)
  }
  if (instance.children !== undefined) {
    result.children = instance.children.map(
      (child) => resolveInstance(child, slots)
    )
  }
  return result
}

/**
 * Resolves the slot values for a recipe. Every declared slot must
 * either be provided in the instantiation or have a default value.
 * Undeclared values in the instantiation are dropped.
 * @param {Recipe} recipe - The recipe.
 * @param {Record<string, unknown>} provided - The slot values from
 *   the instantiation.
 * @returns {Record<string, unknown>} The resolved slots.
 * @throws {Error} When a declared slot has neither a value nor a
 *   default.
 */
function resolveDeclaredSlots (recipe, provided) {
  const resolved = {}
  for (const slot of recipe.slots) {
    if (Object.hasOwn(provided, slot.name)) {
      resolved[slot.name] = provided[slot.name]
    } else if (Object.hasOwn(slot, 'default')) {
      resolved[slot.name] = slot.default
    } else {
      throw new Error(
        `compose: slot "${slot.name}" is required and has no default`
      )
    }
  }
  return resolved
}

/**
 * Composes an instantiation into a Composition. Loads the recipe,
 * checks the version matches, resolves slot values, and produces
 * the resolved artifact description.
 *
 * Deterministic given the same library state, rootDir, and
 * instantiation. Makes no network requests and calls no LLMs.
 * @param {string} rootDir - The library root directory.
 * @param {Instantiation} instantiation - The instantiation to
 *   compose.
 * @returns {Promise<Composition>} The resolved Composition.
 * @throws {Error} When the instantiation is malformed, the recipe
 *   cannot be loaded, the version does not match, the recipe has
 *   multiple targets, or a slot cannot be resolved.
 */
export async function compose (rootDir, instantiation) {
  if (typeof rootDir !== 'string' || rootDir.length === 0) {
    throw new Error('compose: rootDir must be a non-empty string')
  }
  if (instantiation === null || typeof instantiation !== 'object') {
    throw new Error('compose: instantiation must be an object')
  }

  const recipeId = instantiation.recipeId
  const recipeVersion = instantiation.recipeVersion
  const providedSlots = instantiation.slots

  if (typeof recipeId !== 'string' || recipeId.length === 0) {
    throw new Error('compose: instantiation.recipeId must be a non-empty string')
  }
  if (typeof recipeVersion !== 'string' || recipeVersion.length === 0) {
    throw new Error('compose: instantiation.recipeVersion must be a non-empty string')
  }
  if (providedSlots === null || typeof providedSlots !== 'object' || Array.isArray(providedSlots)) {
    throw new Error('compose: instantiation.slots must be a plain object')
  }

  let recipe
  try {
    recipe = await loadRecipeById(rootDir, recipeId)
  } catch (err) {
    throw new Error(`compose: cannot load recipe "${recipeId}": ${err.message}`)
  }

  if (recipe.version !== recipeVersion) {
    throw new Error(
      `compose: recipe "${recipeId}" version mismatch: ` +
      `requested ${recipeVersion}, got ${recipe.version}`
    )
  }

  const targets = recipe.targets === undefined ? ['bot'] : recipe.targets
  if (targets.length !== 1) {
    throw new Error('compose: multi-target recipes are not supported in v1')
  }
  const target = targets[0]

  const resolvedSlots = resolveDeclaredSlots(recipe, providedSlots)

  const resolvedHandlers = {}
  for (const key of Object.keys(recipe.handlers)) {
    resolvedHandlers[key] = resolveInstance(recipe.handlers[key], resolvedSlots)
  }

  const composition = {
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    target,
    slots: resolvedSlots,
    handlers: resolvedHandlers,
    capabilities: recipe.capabilities
  }

  if (recipe.triggers !== undefined) {
    composition.triggers = recipe.triggers.map(
      (trigger) => resolveInstance(trigger, resolvedSlots)
    )
  }

  if (recipe.settings !== undefined) {
    composition.settings = recipe.settings
  }

  return composition
}
