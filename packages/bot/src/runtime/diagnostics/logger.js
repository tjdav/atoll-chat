/**
 * @file Structured redacting logger for bot runtime and author output.
 */

/**
 * @typedef {object} Logger
 * @property {(level: LogLevel, msg: string, meta?: object) => void} log - Emits a log entry.
 * @property {(msg: string, meta?: object) => void} debug - Emits a debug log entry.
 * @property {(msg: string, meta?: object) => void} info - Emits an info log entry.
 * @property {(msg: string, meta?: object) => void} warn - Emits a warn log entry.
 * @property {(msg: string, meta?: object) => void} error - Emits an error log entry.
 * @property {() => LogLevel | 'silent'} level - Returns the current minimum log level.
 */

/** @type {Set<string>} */
export const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'bearer',
  'credentials',
  'ciphertext',
  'plaintext',
  'privatekey',
  'apikey',
  'keystore',
  'body',
  'credentialblob',
  'accesstoken',
  'refreshtoken'
])

/** @type {Record<string, number>} */
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4
}

const HOISTED_FIELDS = new Set([
  'event_id',
  'room_id',
  'code',
  'duration_ms'
])

/**
 * Recursively redacts sensitive keys, handles _secret: prefix, and strips URL query strings.
 *
 * @param {unknown} value - The value to sanitize.
 * @param {boolean} dev - Whether dev mode is enabled.
 * @param {WeakSet<object>} [visited] - Set tracking visited objects for cycle prevention.
 * @returns {unknown} The sanitized value.
 */
function redactValue (value, dev, visited = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (visited.has(value)) {
    return undefined
  }
  visited.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, dev, visited))
  }

  const recValue = Object(value)
  /** @type {Record<string, unknown>} */
  const result = {}

  for (const key of Object.keys(value)) {
    const lowerKey = key.toLowerCase()

    if (lowerKey.startsWith('_secret:')) {
      if (dev) {
        throw new Error(`Reserved secret key "${key}" found in log meta`)
      }
      result[key] = '[REDACTED]'
      continue
    }

    const normalizedKey = lowerKey.replace(/[-_]/g, '')

    if (SENSITIVE_KEYS.has(normalizedKey)) {
      result[key] = '[REDACTED]'
      continue
    }

    const val = recValue[key]

    if (normalizedKey === 'url' && typeof val === 'string') {
      let urlStr = val
      try {
        const parsedUrl = new URL(val)
        parsedUrl.search = ''
        urlStr = parsedUrl.toString()
      } catch {
        // Ignore parse errors for non-URL strings.
      }
      result[key] = urlStr
      continue
    }

    result[key] = redactValue(val, dev, visited)
  }

  return result
}

/**
 * Creates a structured logger.
 *
 * @param {object} options - Logger configuration options.
 * @param {string} options.botId - The bot's identifier. Included in every line.
 * @param {LogLevel | 'silent'} [options.level='info'] - The minimum level to emit. Lower levels are dropped.
 * @param {(line: string) => void} [options.sink] - Receives each serialized log line, newline-terminated.
 * @param {boolean} [options.dev] - Whether to enable dev-mode redaction behavior. Defaults to process.env.NODE_ENV !== 'production'.
 * @returns {Logger} The structured logger instance.
 */
export function createLogger ({
  botId,
  level = 'info',
  sink = (line) => process.stdout.write(line),
  dev = process.env.NODE_ENV !== 'production'
}) {
  if (!botId || typeof botId !== 'string') {
    throw new Error('Logger requires a valid botId string')
  }

  const configuredLevel = level

  /**
   * Internal emit function.
   *
   * @param {LogLevel} lineLevel - Level for the current log line.
   * @param {string} msg - Log message string.
   * @param {object} [meta] - Metadata context object.
   */
  function log (lineLevel, msg, meta) {
    const numericLineLevel = LOG_LEVELS[lineLevel]
    const configuredNumeric = LOG_LEVELS[configuredLevel]
    const numericThreshold = configuredNumeric !== undefined ? configuredNumeric : 1

    if (numericLineLevel === undefined || numericLineLevel < numericThreshold) {
      return
    }

    const callerMeta = meta && typeof meta === 'object' ? meta : {}
    /** @type {Record<string, unknown>} */
    const hoistedContext = {}
    /** @type {Record<string, unknown>} */
    const remainingMeta = {}

    const recCallerMeta = Object(callerMeta)

    for (const key of Object.keys(callerMeta)) {
      if (HOISTED_FIELDS.has(key)) {
        hoistedContext[key] = recCallerMeta[key]
      } else {
        remainingMeta[key] = recCallerMeta[key]
      }
    }

    const redactedMeta = redactValue(remainingMeta, dev)

    /** @type {Record<string, unknown>} */
    const logObj = {
      ts: new Date().toISOString(),
      level: lineLevel,
      msg: String(msg ?? ''),
      bot_id: botId,
      ...hoistedContext,
      meta: redactedMeta
    }

    let lineStr
    try {
      lineStr = JSON.stringify(logObj) + '\n'
    } catch (err) {
      const fallbackObj = {
        ts: logObj.ts,
        level: logObj.level,
        msg: 'log serialization failed',
        bot_id: logObj.bot_id,
        meta: {
          error: err instanceof Error ? err.message : String(err),
          original_msg: logObj.msg
        }
      }
      lineStr = JSON.stringify(fallbackObj) + '\n'
    }

    try {
      sink(lineStr)
    } catch {
      // Ignore sink write failures.
    }
  }

  return {
    log,
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    level: () => configuredLevel
  }
}
