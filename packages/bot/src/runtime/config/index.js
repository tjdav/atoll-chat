import fs from 'node:fs/promises'
import path from 'node:path'
import { parseToml } from './toml.js'

/**
 * Runtime log level settings.
 * @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel
 */

/**
 * Runtime log format settings.
 * @typedef {'json' | 'pretty'} LogFormat
 */

/**
 * The resolved bot configuration. Every field is present; fields
 * without a value in any source carry their default.
 *
 * @typedef {object} Config
 * @property {string | undefined} botToken - From `ATOL_BOT_TOKEN`.
 * @property {string | undefined} serverUrl - From `ATOL_SERVER_URL`.
 * @property {string} botConfigPath - Absolute path to the bot.toml
 *   file. Resolved from `ATOL_BOT_CONFIG` or `<cwd>/bot.toml`.
 * @property {string} keystorePath - Absolute path to the keystore
 *   file. Resolved from `ATOL_BOT_KEYSTORE` or `<cwd>/bot.keystore`.
 * @property {string | undefined} keystoreSecret - From
 *   `ATOL_BOT_KEYSTORE_SECRET`.
 * @property {string | undefined} userToken - From `ATOL_USER_TOKEN`.
 * @property {number} handlerTimeoutMs - From
 *   `ATOL_HANDLER_TIMEOUT_MS`. Default `60000`.
 * @property {{ logLevel: LogLevel, logFormat: LogFormat }} runtime - Runtime
 *   settings.
 * @property {{ host: string, port: number, basePath: string,
 *   maxBodyBytes: number, timeoutMs: number }} webhook - Webhook
 *   settings.
 * @property {{ timezone: string, catchUp: boolean }} cron - Cron
 *   settings.
 * @property {{ baseBackoffMs: number, maxBackoffMs: number,
 *   jitter: number }} reconnect - Reconnect settings.
 * @property {{ drainMs: number }} shutdown - Shutdown settings.
 * @property {{ enabled: boolean, retentionDays: number }} diagnostics -
 *   Diagnostics settings.
 */

const KNOWN_SECTIONS = new Set([
  'runtime',
  'webhook',
  'cron',
  'reconnect',
  'shutdown',
  'diagnostics'
])

/** @type {Record<string, Set<string>>} */
const KNOWN_KEYS = {
  runtime: new Set(['log_level', 'log_format']),
  webhook: new Set(['host', 'port', 'base_path', 'max_body_bytes', 'timeout_ms']),
  cron: new Set(['timezone', 'catch_up']),
  reconnect: new Set(['base_backoff_ms', 'max_backoff_ms', 'jitter']),
  shutdown: new Set(['drain_ms']),
  diagnostics: new Set(['enabled', 'retention_days'])
}

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error'])
const LOG_FORMATS = new Set(['json', 'pretty'])

/**
 * Recursively freezes an object and its nested objects.
 *
 * @template {Record<string, unknown>} T
 * @param {T} obj - The object to freeze.
 * @returns {T} The frozen object.
 */
function deepFreeze (obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  Object.freeze(obj)
  for (const key of Object.keys(obj)) {
    const prop = Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined
    if (prop !== null && typeof prop === 'object' && !Object.isFrozen(prop)) {
      deepFreeze(
        /** @type {Record<string, unknown>} */
        (prop)
      )
    }
  }
  return obj
}

/**
 * Gets a non-empty environment variable value or undefined.
 *
 * @param {NodeJS.ProcessEnv} env - Environment object.
 * @param {string} key - Variable key.
 * @returns {string | undefined} Non-empty string or undefined.
 */
function getEnv (env, key) {
  const val = env[key]
  if (val === undefined || val === '') {
    return undefined
  }
  return val
}

/**
 * Parses a non-negative integer from an environment variable string.
 *
 * @param {string | undefined} val - Environment variable string value.
 * @param {string} varName - Variable name for error reporting.
 * @returns {number | undefined} Parsed integer or undefined.
 * @throws {Error} When value is not a valid non-negative integer.
 */
function parseEnvInt (val, varName) {
  if (val === undefined) {
    return undefined
  }
  if (!/^[0-9]+$/.test(val)) {
    throw new Error(`Environment variable ${varName} must be a non-negative integer, got "${val}"`)
  }
  const parsed = Number.parseInt(val, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${varName} must be a non-negative integer, got "${val}"`)
  }
  return parsed
}

/**
 * Retrieves a property from a section object if present.
 *
 * @param {unknown} sectionObj - Section object.
 * @param {string} key - Property key.
 * @returns {unknown} Property value or undefined.
 */
function getTomlVal (sectionObj, key) {
  if (sectionObj !== null && typeof sectionObj === 'object' && Object.prototype.hasOwnProperty.call(sectionObj, key)) {
    const obj =
      /** @type {Record<string, unknown>} */
      (sectionObj)
    return obj[key]
  }
  return undefined
}

/**
 * Validates post-merge field types and ranges.
 *
 * @param {Config} config - Config object.
 * @throws {Error} When any field fails type/range/enum checks.
 */
function validateConfigTypes (config) {
  if (!LOG_LEVELS.has(config.runtime.logLevel)) {
    throw new Error(`Invalid runtime.logLevel "${config.runtime.logLevel}". Must be one of: debug, info, warn, error`)
  }
  if (!LOG_FORMATS.has(config.runtime.logFormat)) {
    throw new Error(`Invalid runtime.logFormat "${config.runtime.logFormat}". Must be one of: json, pretty`)
  }

  const intFields = [
    {
      name: 'handlerTimeoutMs',
      val: config.handlerTimeoutMs
    },
    {
      name: 'webhook.port',
      val: config.webhook.port
    },
    {
      name: 'webhook.maxBodyBytes',
      val: config.webhook.maxBodyBytes
    },
    {
      name: 'webhook.timeoutMs',
      val: config.webhook.timeoutMs
    },
    {
      name: 'reconnect.baseBackoffMs',
      val: config.reconnect.baseBackoffMs
    },
    {
      name: 'reconnect.maxBackoffMs',
      val: config.reconnect.maxBackoffMs
    },
    {
      name: 'shutdown.drainMs',
      val: config.shutdown.drainMs
    },
    {
      name: 'diagnostics.retentionDays',
      val: config.diagnostics.retentionDays
    }
  ]

  for (const { name, val } of intFields) {
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
      throw new Error(`Field ${name} must be a non-negative integer, got ${val}`)
    }
  }

  if (typeof config.reconnect.jitter !== 'number' || Number.isNaN(config.reconnect.jitter) || config.reconnect.jitter < 0 || config.reconnect.jitter > 1) {
    throw new Error(`Field reconnect.jitter must be a float in range [0, 1], got ${config.reconnect.jitter}`)
  }

  if (typeof config.cron.catchUp !== 'boolean') {
    throw new Error(`Field cron.catchUp must be a boolean, got ${config.cron.catchUp}`)
  }

  if (typeof config.diagnostics.enabled !== 'boolean') {
    throw new Error(`Field diagnostics.enabled must be a boolean, got ${config.diagnostics.enabled}`)
  }

  const strFields = [
    {
      name: 'webhook.host',
      val: config.webhook.host
    },
    {
      name: 'webhook.basePath',
      val: config.webhook.basePath
    },
    {
      name: 'cron.timezone',
      val: config.cron.timezone
    },
    {
      name: 'botConfigPath',
      val: config.botConfigPath
    },
    {
      name: 'keystorePath',
      val: config.keystorePath
    }
  ]

  for (const { name, val } of strFields) {
    if (typeof val !== 'string') {
      throw new Error(`Field ${name} must be a string, got ${val}`)
    }
  }

  const optStrFields = [
    {
      name: 'botToken',
      val: config.botToken
    },
    {
      name: 'serverUrl',
      val: config.serverUrl
    },
    {
      name: 'keystoreSecret',
      val: config.keystoreSecret
    },
    {
      name: 'userToken',
      val: config.userToken
    }
  ]

  for (const { name, val } of optStrFields) {
    if (val !== undefined && typeof val !== 'string') {
      throw new Error(`Field ${name} must be a string or undefined, got ${val}`)
    }
  }
}

/**
 * Loads the bot's configuration from environment variables and an
 * optional `bot.toml`. Precedence: environment variable > TOML >
 * built-in default.
 *
 * The returned object always has every field populated. Callers that
 * need to enforce the presence of a field do so themselves.
 *
 * @param {object} [options] - Options for loading configuration.
 * @param {NodeJS.ProcessEnv} [options.env=process.env] - The
 *   environment to read from. Parameterized for testing.
 * @param {string} [options.cwd=process.cwd()] - The base directory for
 *   relative paths. Parameterized for testing.
 * @returns {Promise<Config>} The resolved configuration.
 * @throws {Error} When an environment variable has an invalid value,
 *   when the TOML file explicitly set by `ATOL_BOT_CONFIG` does not
 *   exist, or when the TOML file fails to parse or validate.
 */
export async function loadConfig ({ env = process.env, cwd = process.cwd() } = {}) {
  const envBotConfigPath = getEnv(env, 'ATOL_BOT_CONFIG')
  const envKeystorePath = getEnv(env, 'ATOL_BOT_KEYSTORE')

  const isExplicitConfigPath = envBotConfigPath !== undefined
  const botConfigPath = path.resolve(cwd, envBotConfigPath ?? 'bot.toml')
  const keystorePath = path.resolve(cwd, envKeystorePath ?? 'bot.keystore')

  /** @type {Record<string, Record<string, unknown>>} */
  let tomlParsed = {}
  let readSuccess = false

  try {
    const source = await fs.readFile(botConfigPath, 'utf8')
    tomlParsed = parseToml(source)
    readSuccess = true
  } catch (err) {
    if (err && typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      if (isExplicitConfigPath) {
        throw new Error(`Config file explicitly specified by ATOL_BOT_CONFIG not found: ${botConfigPath}`)
      }
    } else {
      throw err
    }
  }

  if (readSuccess) {
    for (const section of Object.keys(tomlParsed)) {
      if (!KNOWN_SECTIONS.has(section)) {
        throw new Error(`Unknown TOML section [${section}] in ${botConfigPath}`)
      }
      const sectionObj = tomlParsed[section] ?? {}
      const validKeys = KNOWN_KEYS[section] ?? new Set()
      for (const key of Object.keys(sectionObj)) {
        if (!validKeys.has(key)) {
          throw new Error(`Unknown key "${key}" in TOML section [${section}] in ${botConfigPath}`)
        }
      }
    }
  }

  const tomlRuntime = tomlParsed.runtime ?? {}
  const tomlWebhook = tomlParsed.webhook ?? {}
  const tomlCron = tomlParsed.cron ?? {}
  const tomlReconnect = tomlParsed.reconnect ?? {}
  const tomlShutdown = tomlParsed.shutdown ?? {}
  const tomlDiagnostics = tomlParsed.diagnostics ?? {}

  const envBotToken = getEnv(env, 'ATOL_BOT_TOKEN')
  const envServerUrl = getEnv(env, 'ATOL_SERVER_URL')
  const envKeystoreSecret = getEnv(env, 'ATOL_BOT_KEYSTORE_SECRET')
  const envUserToken = getEnv(env, 'ATOL_USER_TOKEN')
  const envLogLevel = getEnv(env, 'ATOL_LOG_LEVEL')
  const envLogFormat = getEnv(env, 'ATOL_LOG_FORMAT')
  const envHost = getEnv(env, 'ATOL_BOT_HOST')

  const envPort = parseEnvInt(getEnv(env, 'ATOL_BOT_PORT'), 'ATOL_BOT_PORT')
  const envBaseBackoff = parseEnvInt(getEnv(env, 'ATOL_RECONNECT_BASE_BACKOFF_MS'), 'ATOL_RECONNECT_BASE_BACKOFF_MS')
  const envMaxBackoff = parseEnvInt(getEnv(env, 'ATOL_RECONNECT_MAX_BACKOFF_MS'), 'ATOL_RECONNECT_MAX_BACKOFF_MS')
  const envHandlerTimeout = parseEnvInt(getEnv(env, 'ATOL_HANDLER_TIMEOUT_MS'), 'ATOL_HANDLER_TIMEOUT_MS')
  const envShutdownDrain = parseEnvInt(getEnv(env, 'ATOL_SHUTDOWN_DRAIN_MS'), 'ATOL_SHUTDOWN_DRAIN_MS')

  const rawLogLevel = envLogLevel ?? getTomlVal(tomlRuntime, 'log_level') ?? 'info'
  const rawLogFormat = envLogFormat ?? getTomlVal(tomlRuntime, 'log_format') ?? 'json'

  const webhookHost = envHost ?? getTomlVal(tomlWebhook, 'host') ?? '0.0.0.0'
  const webhookPort = envPort ?? getTomlVal(tomlWebhook, 'port') ?? 8787
  const webhookBasePath = getTomlVal(tomlWebhook, 'base_path') ?? ''
  const webhookMaxBodyBytes = getTomlVal(tomlWebhook, 'max_body_bytes') ?? 1048576
  const webhookTimeoutMs = getTomlVal(tomlWebhook, 'timeout_ms') ?? 5000

  const cronTimezone = getTomlVal(tomlCron, 'timezone') ?? 'UTC'
  const cronCatchUp = getTomlVal(tomlCron, 'catch_up') ?? false

  const reconnectBaseBackoff = envBaseBackoff ?? getTomlVal(tomlReconnect, 'base_backoff_ms') ?? 1000
  const reconnectMaxBackoff = envMaxBackoff ?? getTomlVal(tomlReconnect, 'max_backoff_ms') ?? 30000
  const reconnectJitter = getTomlVal(tomlReconnect, 'jitter') ?? 0.2

  const shutdownDrainMs = envShutdownDrain ?? getTomlVal(tomlShutdown, 'drain_ms') ?? 30000

  const diagnosticsEnabled = getTomlVal(tomlDiagnostics, 'enabled') ?? true
  const diagnosticsRetentionDays = getTomlVal(tomlDiagnostics, 'retention_days') ?? 7

  const logLevel =
    /** @type {LogLevel} */
    (rawLogLevel)
  const logFormat =
    /** @type {LogFormat} */
    (rawLogFormat)

  const host =
    /** @type {string} */
    (webhookHost)
  const port =
    /** @type {number} */
    (webhookPort)
  const basePath =
    /** @type {string} */
    (webhookBasePath)
  const maxBodyBytes =
    /** @type {number} */
    (webhookMaxBodyBytes)
  const timeoutMs =
    /** @type {number} */
    (webhookTimeoutMs)

  const timezone =
    /** @type {string} */
    (cronTimezone)
  const catchUp =
    /** @type {boolean} */
    (cronCatchUp)

  const baseBackoffMs =
    /** @type {number} */
    (reconnectBaseBackoff)
  const maxBackoffMs =
    /** @type {number} */
    (reconnectMaxBackoff)
  const jitter =
    /** @type {number} */
    (reconnectJitter)

  const drainMs =
    /** @type {number} */
    (shutdownDrainMs)

  const enabled =
    /** @type {boolean} */
    (diagnosticsEnabled)
  const retentionDays =
    /** @type {number} */
    (diagnosticsRetentionDays)

  /** @type {Config} */
  const config = {
    botToken: envBotToken,
    serverUrl: envServerUrl,
    botConfigPath,
    keystorePath,
    keystoreSecret: envKeystoreSecret,
    userToken: envUserToken,
    handlerTimeoutMs: envHandlerTimeout ?? 60000,
    runtime: {
      logLevel,
      logFormat
    },
    webhook: {
      host,
      port,
      basePath,
      maxBodyBytes,
      timeoutMs
    },
    cron: {
      timezone,
      catchUp
    },
    reconnect: {
      baseBackoffMs,
      maxBackoffMs,
      jitter
    },
    shutdown: {
      drainMs
    },
    diagnostics: {
      enabled,
      retentionDays
    }
  }

  validateConfigTypes(config)

  return deepFreeze(config)
}
