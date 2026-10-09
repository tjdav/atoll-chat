// SPDX-License-Identifier: AGPL-3.0-or-later

import { getPrimitive } from '../primitives/index.js'

const RECIPE_ID = /^[a-z][a-z0-9-]*$/
const SLOT_NAME = /^[a-zA-Z][a-zA-Z0-9]*$/
const VERSION = /^\d+\.\d+\.\d+$/
const SLOT_TOKEN = /(?<!\{)\{([a-zA-Z][a-zA-Z0-9]*)\}(?!\})/g

const KINDS = ['pure', 'assisted', 'operated']
const TARGETS = ['bot', 'extension']
const SLOT_TYPES = ['string', 'number', 'boolean', 'select']
const CAPABILITIES = [
  'post_message',
  'post_attachment',
  'post_reaction',
  'read_commands',
  'read_metadata',
  'read_content',
  'edit_message',
  'delete_message'
]

/**
 * Returns true when the value is a plain object.
 * @param {unknown} value - The value to test.
 * @returns {boolean} True when the value is a non-null non-array object.
 */
function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Walks a config value and collects every distinct `{slotName}`
 * reference. Double-brace tokens (`{{path}}`) are skipped.
 * @param {unknown} value - The config value to walk.
 * @param {Set<string>} found - The accumulator.
 * @returns {Set<string>} The same accumulator.
 */
function collectSlotRefs (value, found) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(SLOT_TOKEN)) {
      found.add(match[1])
    }
    return found
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSlotRefs(item, found)
    }
    return found
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      collectSlotRefs(value[key], found)
    }
    return found
  }
  return found
}

/**
 * Validates a primitive instance tree. Pushes errors to the array.
 * @param {unknown} instance - The instance to check.
 * @param {string} path - The dotted path used in error messages.
 * @param {RecipeTarget[]} targets - The recipe's targets.
 * @param {Set<string>} capabilityUnion - Accumulator for the
 *   primitive's required capabilities.
 * @param {Set<string>} instanceIds - Accumulator for instance ids,
 *   used to detect duplicates.
 * @param {string[]} errors - The error list.
 * @returns {void}
 */
function validateInstance (instance, path, targets, capabilityUnion, instanceIds, errors) {
  if (!isPlainObject(instance)) {
    errors.push(`${path} must be an object`)
    return
  }
  const id = instance.id
  const primitive = instance.primitive
  const config = instance.config
  const children = instance.children

  if (typeof id !== 'string' || id.length === 0) {
    errors.push(`${path}.id is required and must be a non-empty string`)
  } else if (instanceIds.has(id)) {
    errors.push(`${path}.id "${id}" is duplicated within the composition`)
  } else {
    instanceIds.add(id)
  }

  if (typeof primitive !== 'string' || primitive.length === 0) {
    errors.push(`${path}.primitive is required and must be a non-empty string`)
  } else if (typeof id === 'string' && id.length > 0) {
    const targetsToCheck = targets.length === 0 ? ['bot'] : targets
    const found = targetsToCheck.some((t) => getPrimitive(t, primitive) !== undefined)
    if (!found) {
      errors.push(`${path}.primitive "${primitive}" is not registered for targets ${JSON.stringify(targetsToCheck)}`)
    } else {
      for (const t of targetsToCheck) {
        const prim = getPrimitive(t, primitive)
        if (prim !== undefined) {
          for (const cap of prim.capabilities) {
            capabilityUnion.add(cap)
          }
        }
      }
    }
  }

  if (!isPlainObject(config)) {
    errors.push(`${path}.config is required and must be an object`)
  }

  if (children !== undefined) {
    if (!Array.isArray(children)) {
      errors.push(`${path}.children must be an array when provided`)
    } else {
      children.forEach((child, index) => {
        validateInstance(child, `${path}.children[${index}]`, targets, capabilityUnion, instanceIds, errors)
      })
    }
  }
}

/**
 * Validates a recipe-shaped value.
 * @param {unknown} value - The value to validate.
 * @returns {{ valid: true, recipe: Recipe } | { valid: false, errors: string[] }} The result.
 */
export function validateRecipe (value) {
  const errors = []

  if (!isPlainObject(value)) {
    return { valid: false, errors: ['recipe must be a plain object'] }
  }

  const id = value.id
  const version = value.version
  const label = value.label
  const description = value.description
  const kind = value.kind
  const targets = value.targets
  const capabilities = value.capabilities
  const slots = value.slots
  const handlers = value.handlers
  const triggers = value.triggers
  const constraints = value.constraints

  if (typeof id !== 'string' || !RECIPE_ID.test(id)) {
    errors.push('id is required and must match ^[a-z][a-z0-9-]*$')
  }
  if (typeof version !== 'string' || !VERSION.test(version)) {
    errors.push('version is required and must match semver (N.N.N)')
  }
  if (typeof label !== 'string' || label.length === 0) {
    errors.push('label is required and must be a non-empty string')
  }
  if (typeof description !== 'string' || description.length === 0) {
    errors.push('description is required and must be a non-empty string')
  }
  if (typeof kind !== 'string' || !KINDS.includes(kind)) {
    errors.push(`kind is required and must be one of ${KINDS.join(', ')}`)
  }

  let resolvedTargets = ['bot']
  if (targets !== undefined) {
    if (!Array.isArray(targets) || targets.length === 0) {
      errors.push('targets must be a non-empty array when provided')
    } else {
      for (const t of targets) {
        if (!TARGETS.includes(t)) {
          errors.push(`targets contains invalid value "${t}"; must be one of ${TARGETS.join(', ')}`)
        }
      }
      resolvedTargets = targets
    }
  }

  if (!Array.isArray(capabilities)) {
    errors.push('capabilities is required and must be an array')
  } else {
    for (const cap of capabilities) {
      if (!CAPABILITIES.includes(cap)) {
        errors.push(`capabilities contains unknown value "${cap}"`)
      }
    }
  }

  const slotNames = new Set()
  if (!Array.isArray(slots)) {
    errors.push('slots is required and must be an array')
  } else {
    slots.forEach((slot, index) => {
      const path = `slots[${index}]`
      if (!isPlainObject(slot)) {
        errors.push(`${path} must be an object`)
        return
      }
      if (typeof slot.name !== 'string' || !SLOT_NAME.test(slot.name)) {
        errors.push(`${path}.name is required and must match ^[a-zA-Z][a-zA-Z0-9]*$`)
      } else if (slotNames.has(slot.name)) {
        errors.push(`${path}.name "${slot.name}" is duplicated`)
      } else {
        slotNames.add(slot.name)
      }
      if (!SLOT_TYPES.includes(slot.type)) {
        errors.push(`${path}.type is required and must be one of ${SLOT_TYPES.join(', ')}`)
      }
      if (typeof slot.question !== 'string' || slot.question.length === 0) {
        errors.push(`${path}.question is required and must be a non-empty string`)
      }
      if (slot.type === 'select') {
        if (!Array.isArray(slot.options) || slot.options.length === 0) {
          errors.push(`${path}.options is required and must be a non-empty array when type is "select"`)
        }
      } else if (slot.options !== undefined) {
        errors.push(`${path}.options is only valid when type is "select"`)
      }
      if (slot.hint !== undefined && typeof slot.hint !== 'string') {
        errors.push(`${path}.hint must be a string when provided`)
      }
    })
  }

  const capabilityUnion = new Set()
  const instanceIds = new Set()

  if (!isPlainObject(handlers)) {
    errors.push('handlers is required and must be an object')
  } else {
    for (const key of Object.keys(handlers)) {
      validateInstance(
        handlers[key],
        `handlers.${key}`,
        resolvedTargets,
        capabilityUnion,
        instanceIds,
        errors
      )
    }
  }

  if (triggers !== undefined) {
    if (!Array.isArray(triggers)) {
      errors.push('triggers must be an array when provided')
    } else {
      triggers.forEach((trigger, index) => {
        validateInstance(
          trigger,
          `triggers[${index}]`,
          resolvedTargets,
          capabilityUnion,
          instanceIds,
          errors
        )
      })
    }
  }

  if (constraints !== undefined) {
    if (!Array.isArray(constraints)) {
      errors.push('constraints must be an array when provided')
    } else {
      for (const c of constraints) {
        if (typeof c !== 'string' || c.length === 0) {
          errors.push('constraints must contain only non-empty strings')
        }
      }
    }
  }

  if (Array.isArray(capabilities)) {
    for (const cap of capabilityUnion) {
      if (!capabilities.includes(cap)) {
        errors.push(`capabilities is missing "${cap}" which is required by a composed primitive`)
      }
    }
  }

  const refs = new Set()
  if (isPlainObject(handlers)) {
    for (const key of Object.keys(handlers)) {
      if (isPlainObject(handlers[key])) {
        collectSlotRefs(handlers[key].config, refs)
      }
    }
  }
  if (Array.isArray(triggers)) {
    for (const trigger of triggers) {
      if (isPlainObject(trigger)) {
        collectSlotRefs(trigger.config, refs)
      }
    }
  }
  for (const ref of refs) {
    if (!slotNames.has(ref)) {
      errors.push(`slot reference "{${ref}}" does not match any declared slot`)
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }
  return { valid: true, recipe: value }
}

/**
 * Renders an error list as a numbered, human-readable string.
 * @param {string[]} errors - The errors to render.
 * @returns {string} The formatted string.
 */
export function formatErrors (errors) {
  return errors.map((err, i) => `${i + 1}. ${err}`).join('\n')
}
