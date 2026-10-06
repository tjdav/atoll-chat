import { decryptSettingsValue } from '../crypto/settings.js'
import {
  SettingsWriteFailedError,
  SettingsReservedPrefixError
} from '../../errors.js'

/**
 * @typedef {object} SettingsStore
 * @property {(key: string, opts?: { room?: string }) => Promise<unknown>} get - Reads a decrypted setting value.
 * @property {(key: string, value: unknown, opts?: { room?: string }) => Promise<void>} set - Throws SettingsWriteFailedError.
 * @property {(key: string, opts?: { room?: string }) => Promise<void>} delete - Throws SettingsWriteFailedError.
 * @property {(key: string, cb: (value: unknown) => void, opts?: { room?: string }) => () => void} subscribe - Registers a subscriber callback.
 * @property {() => Promise<void>} refresh - Refetches settings.
 * @property {() => void} stop - Stops the store.
 */

/**
 * Maps a key and an optional room ID to a storage key.
 *
 * @param {string} key - The setting key name.
 * @param {string} [room] - The optional room ID.
 * @returns {string} The computed storage key.
 */
function storageKey (key, room) {
  if (room) {
    return `room:${room}:${key}`
  }
  return key
}

/**
 * Validates setting key syntax.
 *
 * @param {string} key - The key name to validate.
 * @throws {TypeError} When key is not a non-empty string.
 * @throws {SettingsReservedPrefixError} When key starts with `_runtime:`.
 */
function validateKey (key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('Setting key must be a non-empty string')
  }
  if (key.startsWith('_runtime:')) {
    throw new SettingsReservedPrefixError(
      `Setting key "${key}" uses reserved prefix "_runtime:"`
    )
  }
}

/**
 * Creates the `ctx.settings` store.
 *
 * The store caches decrypted settings in memory, refetches them when
 * `refresh()` is called (typically on a `bot.settings_updated` event),
 * and fires per-key subscribers when a value changes.
 *
 * `set` and `delete` are read-only throws. The bot has no settings
 * write endpoint.
 *
 * @param {object} deps - Dependencies.
 * @param {string} deps.botId - The bot's identifier. Used for logging.
 * @param {import('../transport/http.js').HttpClient} deps.http - The HTTP client.
 * @param {Uint8Array} deps.botCommandPrivateKey - The bot's 32-byte X25519 private scalar.
 * @param {import('../diagnostics/logger.js').Logger} [deps.logger] - Optional logger.
 * @param {() => number} [deps.now=Date.now] - The clock function.
 * @param {number} [deps.coalesceMs=500] - The coalescing window for `refresh()`.
 * @returns {SettingsStore} The settings store interface.
 */
export function createSettingsStore ({
  botId,
  http,
  botCommandPrivateKey,
  logger,
  now = Date.now,
  coalesceMs = 500
}) {
  /** @type {Map<string, { value: unknown, isSecret: boolean }>} */
  const values = new Map()

  /** @type {Map<string, Set<(value: unknown) => void>>} */
  const subscribers = new Map()

  /** @type {Promise<void> | null} */
  let refreshInFlight = null

  /** @type {any} */
  let refreshTimer = null

  let refreshRequested = false
  let stopped = false

  /**
   * Executes the HTTP GET /bots/me/settings request, updates cache, diffs values,
   * and notifies subscribers.
   *
   * @returns {Promise<void>}
   */
  async function performFetch () {
    const fetchStartMs = now()

    logger?.debug('fetching bot settings', {
      bot_id: botId
    })

    let response
    try {
      response = await http.request('GET', '/bots/me/settings', {
        retry: false
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      const status = typeof err === 'object' && err !== null && 'status' in err ? err.status : undefined
      logger?.warn('settings refresh failed', {
        bot_id: botId,
        status,
        error: errorMsg,
        duration_ms: now() - fetchStartMs
      })
      return
    }

    let rawList = response.body
    /** @type {any} */
    const listObj = rawList
    if (
      rawList &&
      typeof rawList === 'object' &&
      !Array.isArray(rawList) &&
      Array.isArray(listObj.settings)
    ) {
      rawList = listObj.settings
    }

    if (!Array.isArray(rawList)) {
      logger?.warn('settings response body is not an array', {
        bot_id: botId
      })
      return
    }

    /** @type {Map<string, { value: unknown, isSecret: boolean }>} */
    const nextValues = new Map()

    for (const entry of rawList) {
      if (!entry || typeof entry !== 'object') {
        continue
      }

      const key = entry.key
      if (typeof key !== 'string' || key.length === 0) {
        continue
      }
      if (key.startsWith('_runtime:')) {
        continue
      }

      const encryptedBase64url = entry.value_encrypted_bot
      if (typeof encryptedBase64url !== 'string') {
        continue
      }

      let decryptedBytes
      try {
        decryptedBytes = decryptSettingsValue({
          encryptedBase64url,
          botCommandPrivateKey
        })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger?.warn('failed to decrypt setting value', {
          bot_id: botId,
          key,
          error: errorMsg
        })
        continue
      }

      let parsed
      try {
        const jsonStr = Buffer.from(decryptedBytes).toString('utf8')
        parsed = JSON.parse(jsonStr)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger?.warn('failed to parse decrypted setting json', {
          bot_id: botId,
          key,
          error: errorMsg
        })
        continue
      }

      const isSecret = entry.is_secret === 1 || entry.is_secret === true
      nextValues.set(key, {
        value: parsed,
        isSecret
      })
    }

    logger?.debug('fetched bot settings successfully', {
      bot_id: botId,
      count: nextValues.size,
      duration_ms: now() - fetchStartMs
    })

    /** @type {Array<{ key: string, value: unknown }>} */
    const notifications = []

    for (const [sKey, nextItem] of nextValues.entries()) {
      const prevItem = values.get(sKey)
      if (!prevItem || JSON.stringify(prevItem.value) !== JSON.stringify(nextItem.value)) {
        notifications.push({
          key: sKey,
          value: nextItem.value
        })
      }
    }

    for (const [sKey] of values.entries()) {
      if (!nextValues.has(sKey)) {
        notifications.push({
          key: sKey,
          value: undefined
        })
      }
    }

    values.clear()
    for (const [sKey, item] of nextValues.entries()) {
      values.set(sKey, item)
    }

    for (const { key: sKey, value } of notifications) {
      const cbs = subscribers.get(sKey)
      if (cbs) {
        for (const cb of cbs) {
          try {
            cb(value)
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            logger?.warn('settings subscriber threw exception', {
              bot_id: botId,
              key: sKey,
              error: errorMsg
            })
          }
        }
      }
    }
  }

  /**
   * Schedules or queues `performFetch`.
   *
   * @returns {Promise<void>}
   */
  async function runFetchLoop () {
    if (stopped) {
      return
    }

    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }

    if (refreshInFlight) {
      refreshRequested = true
      return refreshInFlight
    }

    refreshRequested = false

    refreshInFlight = (async () => {
      try {
        await performFetch()
      } finally {
        refreshInFlight = null
        if (refreshRequested && !stopped) {
          refreshRequested = false
          refreshTimer = setTimeout(() => {
            refreshTimer = null
            runFetchLoop()
          }, 0)
        }
      }
    })()

    return refreshInFlight
  }

  /**
   * Refetches settings from the server, coalescing calls within `coalesceMs`.
   *
   * @returns {Promise<void>}
   */
  async function refresh () {
    if (stopped) {
      return
    }

    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }

    if (refreshInFlight) {
      refreshRequested = true
      return
    }

    return new Promise((resolve) => {
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        runFetchLoop().then(resolve, resolve)
      }, coalesceMs)
    })
  }

  /**
   * Reads a setting value from cache or fetches on cold cache.
   *
   * @param {string} key - Setting key name.
   * @param {object} [opts] - Options.
   * @param {string} [opts.room] - Room ID for room-scoped settings.
   * @returns {Promise<unknown>} Resolves setting value or `undefined`.
   */
  async function get (key, opts) {
    validateKey(key)
    const sKey = storageKey(key, opts?.room)

    if (values.has(sKey)) {
      return values.get(sKey)?.value
    }

    if (refreshInFlight) {
      await refreshInFlight
    } else {
      await runFetchLoop()
    }

    if (values.has(sKey)) {
      return values.get(sKey)?.value
    }

    return undefined
  }

  /**
   * Subscribes to setting value changes for a key.
   *
   * @param {string} key - Setting key name.
   * @param {(value: unknown) => void} cb - Subscriber callback.
   * @param {object} [opts] - Options.
   * @param {string} [opts.room] - Room ID for room-scoped settings.
   * @returns {() => void} Unsubscribe function.
   */
  function subscribe (key, cb, opts) {
    validateKey(key)
    if (typeof cb !== 'function') {
      throw new TypeError('Subscriber callback must be a function')
    }

    const sKey = storageKey(key, opts?.room)
    let set = subscribers.get(sKey)
    if (!set) {
      set = new Set()
      subscribers.set(sKey, set)
    }
    set.add(cb)

    return function unsubscribe () {
      const currentSet = subscribers.get(sKey)
      if (currentSet) {
        currentSet.delete(cb)
        if (currentSet.size === 0) {
          subscribers.delete(sKey)
        }
      }
    }
  }

  /**
   * Throws `SettingsWriteFailedError` unconditionally.
   *
   * @param {string} key - Setting key.
   * @returns {Promise<void>}
   */
  async function set (key) {
    logger?.warn('bot settings write attempted', {
      bot_id: botId,
      key
    })
    throw new SettingsWriteFailedError(
      'bot settings are read-only; operators write settings via the client'
    )
  }

  /**
   * Throws `SettingsWriteFailedError` unconditionally.
   *
   * @param {string} key - Setting key.
   * @returns {Promise<void>}
   */
  async function del (key) {
    logger?.warn('bot settings delete attempted', {
      bot_id: botId,
      key
    })
    throw new SettingsWriteFailedError(
      'bot settings are read-only; operators write settings via the client'
    )
  }

  /**
   * Stops the settings store, clearing timers and preventing future fetches.
   */
  function stop () {
    stopped = true
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
  }

  return {
    get,
    subscribe,
    set,
    delete: del,
    refresh,
    stop
  }
}
