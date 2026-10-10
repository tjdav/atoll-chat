// SPDX-License-Identifier: AGPL-3.0-or-later

import { getPrimitive } from '../primitives/index.js'

const PRIMITIVE_NAME = /^[a-z][a-z0-9-]*$/

/**
 * Returns the JavaScript identifier for a primitive id. Kebab-case
 * becomes camelCase: `post-response` → `postResponse`.
 * @param {string} id - The primitive id.
 * @returns {string} The JavaScript identifier.
 */
function toIdentifier (id) {
  return id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
}

/**
 * Returns a stable string representation of a JSON-serializable
 * value with two-space indentation. Nested lines are not re-indented;
 * callers pass the result through `indentLines` when needed.
 * @param {unknown} value - The value to serialize.
 * @returns {string} The serialized form.
 */
function json (value) {
  return JSON.stringify(value, null, 2)
}

/**
 * Indents every line of a multi-line string by the given number of
 * two-space units. The first line is left as-is; the caller has
 * already placed it.
 * @param {string} text - The text to indent.
 * @param {number} level - The indent level in two-space units.
 * @returns {string} The indented text.
 */
function indentLines (text, level) {
  const pad = '  '.repeat(level)
  const lines = text.split('\n')
  return lines.map((line, i) => (i === 0 ? line : pad + line)).join('\n')
}

/**
 * Collects every primitive id used anywhere in a composition.
 * @param {Composition} composition - The composition.
 * @returns {Set<string>} The primitive ids.
 */
function collectPrimitiveIds (composition) {
  const found = new Set()

  /**
   * Walks an instance tree.
   * @param {PrimitiveInstance} instance - The instance.
   * @returns {void}
   */
  function walk (instance) {
    if (typeof instance.primitive === 'string') {
      found.add(instance.primitive)
    }
    if (Array.isArray(instance.children)) {
      for (const child of instance.children) {
        walk(child)
      }
    }
  }

  for (const key of Object.keys(composition.handlers)) {
    walk(composition.handlers[key])
  }
  if (Array.isArray(composition.triggers)) {
    for (const trigger of composition.triggers) {
      walk(trigger)
    }
  }
  return found
}

/**
 * Emits the source for a single primitive instance, recursively.
 * @param {PrimitiveInstance} instance - The instance.
 * @param {number} indent - The current indent level.
 * @returns {string} The emitted source.
 */
function emitInstance (instance, indent) {
  const name = toIdentifier(instance.primitive)
  const config = json(instance.config)

  const children = instance.children === undefined ? [] : instance.children
  let childrenBlock = '[]'
  if (children.length > 0) {
    const pad = '  '.repeat(indent + 1)
    const closing = '  '.repeat(indent)
    const childSources = children.map(
      (child) => emitInstance(child, indent + 1)
    )
    childrenBlock = `[\n${pad}${childSources.join(`,\n${pad}`)}\n${closing}]`
  }

  return `${name}.create(\n${indentLines(config, indent + 1)},\n${'  '.repeat(indent)}${childrenBlock}\n${'  '.repeat(indent)})`
}

/**
 * Emits a bot.js source string from a Composition and bot-level
 * options. The output is deterministic: same inputs, same string.
 * @param {Composition} composition - The composition to emit.
 * @param {object} options - Bot-level fields not carried by the
 *   composition.
 * @param {string} options.botId - The bot's identifier.
 * @param {string} options.label - Human-readable label.
 * @param {string} [options.apiVersion] - The bot's API version.
 *   Defaults to '1.0.0'.
 * @param {string} [options.hostApi] - The host API range. Defaults
 *   to '^1.0'.
 * @param {{ fileId?: string, emoji?: string }} [options.avatar] -
 *   Optional avatar.
 * @returns {string} The emitted bot.js source.
 * @throws {Error} When the composition or options are malformed, or
 *   when a primitive referenced by the composition is not
 *   registered.
 */
export function emit (composition, options) {
  if (composition === null || typeof composition !== 'object') {
    throw new Error('emit: composition must be an object')
  }
  if (options === null || typeof options !== 'object') {
    throw new Error('emit: options must be an object')
  }

  const { botId, label } = options
  const apiVersion = options.apiVersion === undefined ? '1.0.0' : options.apiVersion
  const hostApi = options.hostApi === undefined ? '^1.0' : options.hostApi
  const avatar = options.avatar

  if (typeof botId !== 'string' || botId.length === 0) {
    throw new Error('emit: options.botId must be a non-empty string')
  }
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error('emit: options.label must be a non-empty string')
  }
  if (typeof apiVersion !== 'string' || apiVersion.length === 0) {
    throw new Error('emit: options.apiVersion must be a non-empty string')
  }
  if (typeof hostApi !== 'string' || hostApi.length === 0) {
    throw new Error('emit: options.hostApi must be a non-empty string')
  }
  if (avatar !== undefined) {
    if (avatar === null || typeof avatar !== 'object' || Array.isArray(avatar)) {
      throw new Error('emit: options.avatar must be a plain object')
    }
  }

  const target = composition.target
  const ids = collectPrimitiveIds(composition)
  for (const id of ids) {
    if (!PRIMITIVE_NAME.test(id)) {
      throw new Error(`emit: invalid primitive id "${id}"`)
    }
    if (getPrimitive(target, id) === undefined) {
      throw new Error(`emit: primitive "${id}" is not registered for target "${target}"`)
    }
  }

  const sortedIds = Array.from(ids).sort()
  const importNames = sortedIds.map(toIdentifier)

  const slotsJson = json(composition.slots)

  const handlerKeys = Object.keys(composition.handlers)
  const handlerEntries = handlerKeys.map((key) => {
    const source = emitInstance(composition.handlers[key], 1)
    return `  ${key}: ${source}`
  })
  const handlersBlock = handlerEntries.length === 0
    ? 'const handlers = {}'
    : `const handlers = {\n${handlerEntries.join(',\n')}\n}`

  const triggersBlock = composition.triggers === undefined
    ? null
    : (() => {
        const sources = composition.triggers.map((t) => emitInstance(t, 0))
        const padded = sources.map((s) => `  ${s}`).join(',\n')
        return `const triggers = [\n${padded}\n]`
      })()

  const botConfigLines = [
    `  id: ${JSON.stringify(botId)},`,
    `  apiVersion: ${JSON.stringify(apiVersion)},`,
    `  hostApi: ${JSON.stringify(hostApi)},`,
    `  label: ${JSON.stringify(label)},`,
    `  capabilities: ${json(composition.capabilities)},`
  ]
  if (avatar !== undefined) {
    botConfigLines.push(`  avatar: ${json(avatar)},`)
  }
  botConfigLines.push('  handlers')
  if (triggersBlock !== null) {
    botConfigLines.push('  triggers')
  }

  const output = [
    `// SPDX-License-Identifier: AGPL-3.0-or-later`,
    `// Recipe: ${composition.recipeId}@${composition.recipeVersion}`,
    ``,
    `import { defineBot } from '@atoll/bot'`,
    ...(sortedIds.length === 0 ? [] : [`import {\n${importNames.map((n) => `  ${n}`).join(',\n')}\n} from '@atoll/recipes/primitives'`]),
    ``,
    `const slots = ${slotsJson}`,
    ``,
    handlersBlock + (triggersBlock === null ? '' : `\n\n${triggersBlock}`),
    ``,
    `export default defineBot({`,
    botConfigLines.join('\n'),
    `})`,
    ``
  ].join('\n')

  return output
}
