// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Extracts an array of recipe objects from the provided library parameter.
 * Supports arrays, objects with a .recipes array, or objects with a .listRecipes() method.
 * @param {unknown} library - The recipe library parameter.
 * @returns {Record<string, unknown>[]} Array of recipe items.
 */
function extractRecipes (library) {
  if (Array.isArray(library)) {
    /** @type {Record<string, unknown>[]} */
    const arr = library
    return arr
  }
  if (library !== null && typeof library === 'object') {
    /** @type {Record<string, unknown>} */
    const libObj = library
    if (Array.isArray(libObj.recipes)) {
      /** @type {Record<string, unknown>[]} */
      const recs = libObj.recipes
      return recs
    }
    if (typeof libObj.listRecipes === 'function') {
      const result = libObj.listRecipes()
      if (Array.isArray(result)) {
        /** @type {Record<string, unknown>[]} */
        const list = result
        return list
      }
    }
  }
  return []
}

/**
 * Formats a single validation error into string representation.
 * Format: `- [<code>] <path>: <message>`
 * @param {unknown} err - The validation error object or string.
 * @returns {string} Formatted error line.
 */
function formatValidationError (err) {
  if (typeof err === 'string') {
    return `- ${err}`
  }
  if (err !== null && typeof err === 'object') {
    /** @type {Record<string, unknown>} */
    const errObj = err
    const code = typeof errObj.code === 'string' && errObj.code.length > 0 ? `[${errObj.code}] ` : ''
    const path = typeof errObj.path === 'string' && errObj.path.length > 0 ? `${errObj.path}: ` : ''
    const msg = typeof errObj.message === 'string' ? errObj.message : String(err)
    return `- ${code}${path}${msg}`
  }
  return `- ${String(err)}`
}

/**
 * Build the messages the composer sends to the LLM.
 * @param {{ intent: string, previousErrors?: unknown[] }} input - The input containing intent and optional validation errors.
 * @param {{ getPrimitive: (target: import('../types.js').RecipeTarget, id: string) => (import('../types.js').Primitive | undefined), listPrimitives: (target: import('../types.js').RecipeTarget) => string[] }} registry - The primitive registry.
 * @param {unknown} library - The recipe library module or summary list.
 * @returns {import('../types.js').ComposerMessage[]} Array of prompt messages for the LLM.
 */
export function buildComposerMessages (input, registry, library) {
  const primitiveIds = registry.listPrimitives('bot').slice().sort()
  const primitivesList = []

  for (const id of primitiveIds) {
    const prim = registry.getPrimitive('bot', id)
    if (prim !== undefined) {
      const caps = Array.isArray(prim.capabilities) && prim.capabilities.length > 0
        ? prim.capabilities.join(', ')
        : 'none'
      const schemaStr = JSON.stringify(prim.configSchema ?? {})
      primitivesList.push(
        `Primitive: ${prim.id}\nLabel: ${prim.label}\nDescription: ${prim.description}\nCapabilities: ${caps}\nConfig Schema: ${schemaStr}`
      )
    }
  }

  const rawRecipes = extractRecipes(library)
  const recipesList = rawRecipes
    .slice()
    .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')))
    .map((r) => `Recipe: ${r.id}\nLabel: ${r.label}\nDescription: ${r.description}`)

  const roleSection =
    'You are the bot composer. You compose bots from a fixed catalog of verified primitives. You do not write JavaScript code, you do not produce a recipe, and you do not invent primitives. You produce a Composition object.'

  const shapeSection =
    'The Composition shape:\n' +
    'Every output must be a valid Composition JSON object. Do not emit recipeId or recipeVersion.\n' +
    '- source: "composed" (always "composed")\n' +
    '- target: "bot" (always "bot")\n' +
    '- slots: Object mapping slot names to default values\n' +
    '- handlers: Object mapping handler names ("install", "uninstall", "grantUpdated", "message", "room", "webhook", "schedule") to PrimitiveInstance objects\n' +
    '- commands: Object mapping kebab-case command names to PrimitiveInstance objects using the "expose-command" primitive\n' +
    '- triggers: Array of PrimitiveInstance objects\n' +
    '- capabilities: Array of required capability strings covering all primitives used in the composition\n\n' +
    'JSON Skeleton:\n' +
    '{\n' +
    '  "source": "composed",\n' +
    '  "target": "bot",\n' +
    '  "slots": {},\n' +
    '  "handlers": {\n' +
    '    "message": {\n' +
    '      "id": "<instance-id>",\n' +
    '      "primitive": "<primitive-id>",\n' +
    '      "config": {}\n' +
    '    }\n' +
    '  },\n' +
    '  "commands": {},\n' +
    '  "triggers": [],\n' +
    '  "capabilities": []\n' +
    '}'

  const contractSection =
    'Validation Contract:\n' +
    'Your composition will be validated against these checks:\n' +
    '- INVALID_SOURCE: source must be "composed". Do not include recipeId or recipeVersion.\n' +
    '- INVALID_TARGET: target must be "bot".\n' +
    '- INVALID_SLOTS: slots must be a plain object mapping slot names to values.\n' +
    '- INVALID_HANDLERS: handlers must be a plain object. Handler keys must be recognized SDK handler names (install, uninstall, grantUpdated, message, room, webhook, schedule).\n' +
    '- INVALID_COMMANDS: commands must be a plain object. Command keys must match ^[a-z][a-z0-9-]*$. Config name property must match the command key.\n' +
    '- INVALID_TRIGGERS: triggers must be an array of primitive instances when provided.\n' +
    '- INVALID_CAPABILITIES: capabilities must be an array containing all capabilities required by every primitive used in the composition.\n' +
    '- INSTANCE_MISSING_ID: every primitive instance must have a non-empty string id.\n' +
    '- INSTANCE_DUPLICATE_ID: instance ids must be unique across the entire composition.\n' +
    '- INSTANCE_MISSING_PRIMITIVE: primitive must be a non-empty string matching a registered primitive ID from the catalog.\n' +
    '- INSTANCE_INVALID_CONFIG: config must be a plain object matching the primitive\'s configSchema.\n' +
    '- UNRESOLVED_SLOT_REF: every {slotName} template reference in primitive configs must correspond to a key in slots.'

  const primitivesSection =
    'Primitive Catalog:\n' + primitivesList.join('\n\n')

  const recipesSection =
    'Recipe Summaries:\n' +
    recipesList.join('\n\n') +
    '\n\nThe recipes listed above are reference examples of supported bots. Do not copy them or produce a recipe; produce a new composed Composition.'

  const systemContent = [
    roleSection,
    shapeSection,
    contractSection,
    primitivesSection,
    recipesSection
  ].join('\n\n')

  /** @type {import('../types.js').ComposerMessage[]} */
  const messages = [
    {
      role: 'system',
      content: systemContent
    },
    {
      role: 'user',
      content: `The user wants: ${input.intent}`
    }
  ]

  if (Array.isArray(input.previousErrors) && input.previousErrors.length > 0) {
    const errorLines = input.previousErrors.map(formatValidationError).join('\n')
    const retryContent =
      'The previous attempt failed validation.\n' +
      errorLines +
      '\nPlease produce a corrected Composition fixing all validation errors listed above.'

    messages.push({
      role: 'user',
      content: retryContent
    })
  }

  return messages
}
