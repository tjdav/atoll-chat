// SPDX-License-Identifier: AGPL-3.0-or-later

import { getPrimitive } from '../primitives/index.js'

const HANDLER_NAMES = [
  'install',
  'uninstall',
  'grantUpdated',
  'message',
  'room',
  'webhook',
  'schedule'
]

const COMMAND_NAME = /^[a-z][a-z0-9-]*$/
const SLOT_TOKEN = /(?<!\{)\{([a-zA-Z][a-zA-Z0-9]*)\}(?!\})/g

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
 * Walks every primitive instance in a tree and calls the visitor on
 * each. Descends into children recursively.
 * @param {unknown} instance - The instance to walk.
 * @param {(instance: object) => void} visit - The visitor.
 * @returns {void}
 */
function walkInstances (instance, visit) {
  if (!isPlainObject(instance)) {
    return
  }
  visit(instance)
  if (Array.isArray(instance.children)) {
    for (const child of instance.children) {
      walkInstances(child, visit)
    }
  }
}

/**
 * Collects every distinct `{slotName}` reference in a value. Double
 * brace tokens (`{{path}}`) are skipped.
 * @param {unknown} value - The value to walk.
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
 * Validates a config value against a primitive's config schema. The
 * schema is a subset of JSON Schema: `type`, `properties`, `required`,
 * `additionalProperties`, `enum`, `minLength`, `pattern`, `minimum`,
 * `maximum`, `minItems`. Other keywords are ignored.
 * @param {unknown} config - The config value.
 * @param {object} schema - The primitive's config schema.
 * @param {string} path - The dotted path used in error messages.
 * @param {string[]} errors - The error list.
 * @returns {void}
 */
function validateConfigValue (config, schema, path, errors) {
  if (!isPlainObject(schema)) {
    return
  }

  const isObjectSchema = schema.type === 'object' || schema.properties !== undefined

  if (isObjectSchema) {
    if (!isPlainObject(config)) {
      errors.push(`${path} must be a plain object`)
      return
    }

    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if (!Object.hasOwn(config, key)) {
        errors.push(`${path}.${key} is required`)
      }
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : {}
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(properties))
      for (const key of Object.keys(config)) {
        if (!allowed.has(key)) {
          errors.push(`${path}.${key} is not allowed`)
        }
      }
    }

    for (const key of Object.keys(properties)) {
      if (Object.hasOwn(config, key)) {
        validateConfigValue(config[key], properties[key], `${path}.${key}`, errors)
      }
    }
    return
  }

  if (schema.type !== undefined) {
    const expected = schema.type
    const actual = Array.isArray(config) ? 'array' : typeof config
    if (expected !== actual) {
      errors.push(`${path} must be a ${expected}`)
      return
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(config)) {
    errors.push(`${path} must be one of ${JSON.stringify(schema.enum)}`)
  }

  if (schema.type === 'string' && typeof config === 'string') {
    if (typeof schema.minLength === 'number' && config.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} characters`)
    }
    if (typeof schema.pattern === 'string') {
      try {
        const re = new RegExp(schema.pattern)
        if (!re.test(config)) {
          errors.push(`${path} must match ${schema.pattern}`)
        }
      } catch {
        errors.push(`${path}: schema.pattern is not a valid regex`)
      }
    }
  }

  if (schema.type === 'number' && typeof config === 'number') {
    if (typeof schema.minimum === 'number' && config < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`)
    }
    if (typeof schema.maximum === 'number' && config > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`)
    }
  }

  if (schema.type === 'array' && Array.isArray(config)) {
    if (typeof schema.minItems === 'number' && config.length < schema.minItems) {
      errors.push(`${path} must have at least ${schema.minItems} items`)
    }
  }
}

/**
 * Validates a single primitive instance tree. Pushes errors to the
 * array. Descends into children recursively.
 * @param {unknown} instance - The instance to check.
 * @param {string} path - The dotted path used in error messages.
 * @param {string} target - The composition's target.
 * @param {Set<string>} capabilityUnion - Accumulator for the
 *   primitive's required capabilities.
 * @param {Set<string>} instanceIds - Accumulator for instance ids,
 *   used to detect duplicates.
 * @param {string[]} errors - The error list.
 * @returns {void}
 */
function validateInstance (instance, path, target, capabilityUnion, instanceIds, errors) {
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

  let primitiveDef
  if (typeof primitive !== 'string' || primitive.length === 0) {
    errors.push(`${path}.primitive is required and must be a non-empty string`)
  } else {
    primitiveDef = getPrimitive(target, primitive)
    if (primitiveDef === undefined) {
      errors.push(`${path}.primitive "${primitive}" is not registered for target "${target}"`)
    } else {
      for (const cap of primitiveDef.capabilities) {
        capabilityUnion.add(cap)
      }
    }
  }

  if (!isPlainObject(config)) {
    errors.push(`${path}.config is required and must be an object`)
  } else if (primitiveDef !== undefined && isPlainObject(primitiveDef.configSchema)) {
    validateConfigValue(config, primitiveDef.configSchema, `${path}.config`, errors)
  }

  if (children !== undefined) {
    if (!Array.isArray(children)) {
      errors.push(`${path}.children must be an array when provided`)
    } else {
      children.forEach((child, index) => {
        validateInstance(
          child,
          `${path}.children[${index}]`,
          target,
          capabilityUnion,
          instanceIds,
          errors
        )
      })
    }
  }
}

/**
 * Validates a Composition against the six rules in the tiered pipeline
 * spec §2.6. Returns `{ valid: true, composition }` on success or
 * `{ valid: false, errors }` on failure.
 * @param {unknown} value - The value to validate.
 * @returns {{ valid: true, composition: Composition } | { valid: false, errors: string[] }} The result.
 */
export function validateComposition (value) {
  const errors = []

  if (!isPlainObject(value)) {
    return { valid: false, errors: ['composition must be a plain object'] }
  }

  const source = value.source
  const target = value.target
  const slots = value.slots
  const handlers = value.handlers
  const commands = value.commands
  const triggers = value.triggers
  const capabilities = value.capabilities
  const settings = value.settings

  if (source !== 'recipe' && source !== 'composed') {
    errors.push('source must be "recipe" or "composed"')
  }

  if (source === 'recipe') {
    if (typeof value.recipeId !== 'string' || value.recipeId.length === 0) {
      errors.push('recipeId is required when source is "recipe"')
    }
    if (typeof value.recipeVersion !== 'string' || value.recipeVersion.length === 0) {
      errors.push('recipeVersion is required when source is "recipe"')
    }
  }

  if (target !== 'bot' && target !== 'extension') {
    errors.push('target must be "bot" or "extension"')
    return { valid: false, errors }
  }

  if (!isPlainObject(slots)) {
    errors.push('slots is required and must be a plain object')
  }

  const slotNames = new Set(isPlainObject(slots) ? Object.keys(slots) : [])

  if (!isPlainObject(handlers)) {
    errors.push('handlers is required and must be a plain object')
  }

  if (commands !== undefined && !isPlainObject(commands)) {
    errors.push('commands must be a plain object when provided')
  }

  if (triggers !== undefined && !Array.isArray(triggers)) {
    errors.push('triggers must be an array when provided')
  }

  if (settings !== undefined && !isPlainObject(settings)) {
    errors.push('settings must be a plain object when provided')
  }

  if (!Array.isArray(capabilities)) {
    errors.push('capabilities is required and must be an array')
    return { valid: false, errors }
  }

  const capabilityUnion = new Set()
  const instanceIds = new Set()

  if (isPlainObject(handlers)) {
    for (const key of Object.keys(handlers)) {
      if (!HANDLER_NAMES.includes(key)) {
        errors.push(`handlers.${key} is not a recognized handler name`)
      }
      validateInstance(
        handlers[key],
        `handlers.${key}`,
        target,
        capabilityUnion,
        instanceIds,
        errors
      )
    }
  }

  if (isPlainObject(commands)) {
    for (const key of Object.keys(commands)) {
      if (!COMMAND_NAME.test(key)) {
        errors.push(`commands.${key}: command name must match ^[a-z][a-z0-9-]*$`)
      }
      const instance = commands[key]
      if (isPlainObject(instance) && isPlainObject(instance.config)) {
        if (instance.config.name !== key) {
          errors.push(`commands.${key}: config.name must equal "${key}"`)
        }
      }
      validateInstance(
        instance,
        `commands.${key}`,
        target,
        capabilityUnion,
        instanceIds,
        errors
      )
    }
  }

  if (Array.isArray(triggers)) {
    triggers.forEach((trigger, index) => {
      validateInstance(
        trigger,
        `triggers[${index}]`,
        target,
        capabilityUnion,
        instanceIds,
        errors
      )
    })
  }

  for (const cap of capabilityUnion) {
    if (!capabilities.includes(cap)) {
      errors.push(`capabilities is missing "${cap}" which is required by a composed primitive`)
    }
  }

  const refs = new Set()
  if (isPlainObject(handlers)) {
    for (const key of Object.keys(handlers)) {
      walkInstances(handlers[key], (instance) => {
        collectSlotRefs(instance.config, refs)
      })
    }
  }
  if (isPlainObject(commands)) {
    for (const key of Object.keys(commands)) {
      walkInstances(commands[key], (instance) => {
        collectSlotRefs(instance.config, refs)
      })
    }
  }
  if (Array.isArray(triggers)) {
    for (const trigger of triggers) {
      walkInstances(trigger, (instance) => {
        collectSlotRefs(instance.config, refs)
      })
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
  return { valid: true, composition: value }
}
