import { ValidationError } from './errors.js'

/**
 * The runtime's host API version. Every bot configuration must declare
 * a `hostApi` matching this string exactly.
 */
export const HOST_API_VERSION = '1.0'

/**
 * Top-level factory. Threads the settings declaration (S) into every
 * top-level handler's `ctx`, and the commands (C) and triggers (T)
 * into the config.
 *
 * @template {Record<string, SettingDecl>} S - The bot's settings
 *   declaration map.
 * @template {Record<string, CommandDecl<any, any>>} C - The bot's
 *   command collection.
 * @template {readonly TriggerDecl[]} T - The bot's trigger list.
 * @param {BotConfig<S, C, T>} config - The bot's configuration.
 * @returns {Bot<S, C, T>} - The bot handle.
 */
export function defineBot (config) {
  validateConfig(config)
  const bot =
    /** @type {any} */
    ({ config })
  return bot
}

/**
 * Validates a bot configuration against spec §4.6. Collects every
 * failure before throwing, so the author sees the full list in one
 * pass rather than fixing issues one at a time.
 *
 * @param {BotConfig<Record<string, SettingDecl>, Record<string, CommandDecl<any, any>>, readonly TriggerDecl[]>} config - The configuration to
 *   validate.
 * @throws {ValidationError} When any rule is violated. The error's
 *   message lists every failure, one per line.
 */
function validateConfig (config) {
  const failures = []

  if (!config || typeof config !== 'object') {
    failures.push('config: must be an object')
    throwValidationError(failures)
  }

  validateId(config.id, failures)
  validateHostApi(config.hostApi, failures)
  validateCapabilities(config.capabilities, failures)
  validateHandlers(config.handlers, failures)
  validateSettings(config.settings, failures)
  validateCommands(config.commands, failures)
  validateTriggers(config.triggers, failures)

  if (failures.length > 0) {
    throwValidationError(failures)
  }
}

/**
 * Throws a ValidationError whose message lists every failure.
 *
 * @param {string[]} failures - The failure messages to report.
 * @throws {ValidationError} Always.
 */
function throwValidationError (failures) {
  const list = failures.map((f) => `  - ${f}`).join('\n')
  throw new ValidationError(`Bot configuration is invalid:\n${list}`)
}

/** Scope vocabulary from spec §3.1. */
const CAPABILITIES = new Set([
  'post_message',
  'post_attachment',
  'post_reaction',
  'read_commands',
  'read_metadata',
  'read_content',
  'edit_message',
  'delete_message'
])

/** Bot identifier pattern from spec §4.6. */
const ID_PATTERN = /^[a-z][a-z0-9.-]*$/

/** Command name pattern from spec §4.6. */
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

/** Setting key pattern. A leading letter, then letters, digits, underscores. */
const SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/

/** Reserved setting-key prefix from spec §7.4. */
const RESERVED_KEY_PREFIX = '_runtime:'

/** Recognized handler names, from the HandlerMap typedef in §3.6. */
const HANDLER_NAMES = new Set([
  'install',
  'uninstall',
  'grantUpdated',
  'message',
  'room',
  'webhook',
  'schedule'
])

/**
 * Validates the bot's `id` field.
 *
 * @param {unknown} id - The id to validate.
 * @param {string[]} failures - Collector for failure messages.
 */
function validateId (id, failures) {
  if (typeof id !== 'string') {
    failures.push('id: must be a string')
    return
  }
  if (!ID_PATTERN.test(id)) {
    failures.push(`id: ${JSON.stringify(id)} does not match ${ID_PATTERN}`)
  }
  if (!id.includes('.')) {
    failures.push(`id: ${JSON.stringify(id)} must contain at least one dot`)
  }
}

/**
 * Validates the bot's `hostApi` field.
 *
 * @param {unknown} hostApi - The version string to validate.
 * @param {string[]} failures - Collector for failure messages.
 */
function validateHostApi (hostApi, failures) {
  if (hostApi !== HOST_API_VERSION) {
    failures.push(
      `hostApi: ${JSON.stringify(hostApi)} does not match runtime version ${JSON.stringify(HOST_API_VERSION)}`
    )
  }
}

/**
 * Validates the bot's `capabilities` field.
 *
 * @param {unknown} capabilities - The capability list to validate.
 * @param {string[]} failures - Collector for failure messages.
 */
function validateCapabilities (capabilities, failures) {
  if (!Array.isArray(capabilities)) {
    failures.push('capabilities: must be an array')
    return
  }
  if (capabilities.length === 0) {
    failures.push('capabilities: must not be empty')
    return
  }
  for (const cap of capabilities) {
    if (!CAPABILITIES.has(cap)) {
      failures.push(`capabilities: unknown scope ${JSON.stringify(cap)}`)
    }
  }
}

/**
 * Validates the bot's `handlers` field.
 *
 * @param {unknown} handlers - The handlers object to validate.
 * @param {string[]} failures - Collector for failure messages.
 */
function validateHandlers (handlers, failures) {
  if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
    failures.push('handlers: must be an object')
    return
  }
  const map =
    /** @type {Record<string, unknown>} */
    (handlers)
  const recognized = Object.keys(map)
    .filter((k) => HANDLER_NAMES.has(k) && typeof map[k] === 'function')
  if (recognized.length === 0) {
    failures.push('handlers: at least one handler must be declared')
  }
}

/**
 * Validates the bot's `settings` field.
 *
 * @param {unknown} settings - The settings declaration to validate.
 * @param {string[]} failures - Collector for failure messages.
 */
function validateSettings (settings, failures) {
  if (settings === undefined) {
    return
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    failures.push('settings: must be an object')
    return
  }
  const map =
    /** @type {Record<string, unknown>} */
    (settings)
  for (const key of Object.keys(map)) {
    if (!SETTING_KEY_PATTERN.test(key)) {
      failures.push(`settings.${key}: not a valid identifier`)
    }
    if (key.startsWith(RESERVED_KEY_PREFIX)) {
      failures.push(`settings.${key}: reserved prefix ${RESERVED_KEY_PREFIX}`)
    }
    const decl = map[key]
    if (!decl || typeof decl !== 'object') {
      failures.push(`settings.${key}: declaration must be an object`)
      continue
    }
    const declObj =
      /** @type {Record<string, unknown>} */
      (decl)
    if (typeof declObj.label !== 'string' || declObj.label.length === 0) {
      failures.push(`settings.${key}.label: must be a non-empty string`)
    }
    if (typeof declObj.type !== 'string') {
      failures.push(`settings.${key}.type: must be a string`)
    }
  }
}

/**
 * Validates the bot's `commands` field.
 *
 * @param {unknown} commands - The commands collection to validate.
 * @param {string[]} failures - Collector for failure messages.
 */
function validateCommands (commands, failures) {
  if (commands === undefined) {
    return
  }
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
    failures.push('commands: must be an object')
    return
  }
  const map =
    /** @type {Record<string, unknown>} */
    (commands)
  for (const name of Object.keys(map)) {
    if (!COMMAND_NAME_PATTERN.test(name)) {
      failures.push(
        `commands.${name}: name does not match ${COMMAND_NAME_PATTERN}`
      )
    }
    const decl = map[name]
    if (!decl || typeof decl !== 'object') {
      failures.push(`commands.${name}: declaration must be an object`)
      continue
    }
    const declObj =
      /** @type {Record<string, unknown>} */
      (decl)
    if (typeof declObj.handler !== 'function') {
      failures.push(`commands.${name}.handler: must be a function`)
    }
    if (!declObj.args || typeof declObj.args !== 'object' || Array.isArray(declObj.args)) {
      failures.push(`commands.${name}.args: must be an object`)
    }
  }
}

/**
 * Validates the bot's `triggers` field.
 *
 * @param {unknown} triggers - The trigger list to validate.
 * @param {string[]} failures - Collector for failure messages.
 */
function validateTriggers (triggers, failures) {
  if (triggers === undefined) {
    return
  }
  if (!Array.isArray(triggers)) {
    failures.push('triggers: must be an array')
    return
  }
  for (let i = 0; i < triggers.length; i++) {
    validateTrigger(triggers[i], `triggers[${i}]`, failures)
  }
}

/**
 * Validates one trigger declaration.
 *
 * @param {unknown} trigger - The trigger to validate.
 * @param {string} path - Field path for failure messages.
 * @param {string[]} failures - Collector for failure messages.
 */
function validateTrigger (trigger, path, failures) {
  if (!trigger || typeof trigger !== 'object') {
    failures.push(`${path}: must be an object`)
    return
  }
  const obj =
    /** @type {Record<string, unknown>} */
    (trigger)
  if (obj.type === 'webhook') {
    validateWebhookTrigger(obj, path, failures)
  } else if (obj.type === 'schedule') {
    validateScheduleTrigger(obj, path, failures)
  } else {
    failures.push(`${path}.type: must be 'webhook' or 'schedule'`)
  }
}

/**
 * Validates a webhook trigger.
 *
 * @param {Record<string, unknown>} trigger - The webhook trigger to validate.
 * @param {string} path - Field path for failure messages.
 * @param {string[]} failures - Collector for failure messages.
 */
function validateWebhookTrigger (trigger, path, failures) {
  if (typeof trigger.path !== 'string' || trigger.path.length === 0) {
    failures.push(`${path}.path: must be a non-empty string`)
  }
  if (trigger.secret !== undefined) {
    if (typeof trigger.secret !== 'string') {
      failures.push(`${path}.secret: must be a string`)
    } else if (!process.env[trigger.secret]) {
      failures.push(
        `${path}.secret: environment variable ${trigger.secret} is not set`
      )
    }
  }
}

/**
 * Validates a schedule trigger. Full cron semantics are validated by
 * the cron engine (see B-028). This check rejects obviously malformed
 * inputs at startup so the author gets early feedback.
 *
 * @param {Record<string, unknown>} trigger - The schedule trigger to validate.
 * @param {string} path - Field path for failure messages.
 * @param {string[]} failures - Collector for failure messages.
 */
function validateScheduleTrigger (trigger, path, failures) {
  if (typeof trigger.name !== 'string' || trigger.name.length === 0) {
    failures.push(`${path}.name: must be a non-empty string`)
  }
  if (typeof trigger.cron !== 'string') {
    failures.push(`${path}.cron: must be a string`)
  } else {
    const fields = trigger.cron.trim().split(/\s+/)
    if (fields.length !== 5) {
      failures.push(
        `${path}.cron: must have exactly 5 fields, got ${fields.length}`
      )
    }
  }
  if (trigger.timezone !== undefined) {
    if (typeof trigger.timezone !== 'string') {
      failures.push(`${path}.timezone: must be a string`)
    } else if (!isValidTimezone(trigger.timezone)) {
      failures.push(
        `${path}.timezone: ${JSON.stringify(trigger.timezone)} is not a valid IANA timezone`
      )
    }
  }
}

/**
 * Returns true when the string is a timezone name the platform
 * recognizes.
 *
 * @param {string} tz - The timezone string to test.
 * @returns {boolean} True when the timezone is recognized.
 */
function isValidTimezone (tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
