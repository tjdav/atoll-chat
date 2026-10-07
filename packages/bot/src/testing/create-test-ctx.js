import { StorageReservedPrefixError } from '../errors.js'

/**
 * @template {Record<string, SettingDecl>} S
 * @typedef {BotCtx<S> & {
 *   calls: {
 *     post: PostOptions[],
 *     reply: ReplyOptions[],
 *     sendLocal: LocalOptions[],
 *     fetch: Array<{ url: string, opts?: RequestInit }>,
 *     fetchUserUrl: Array<{ url: string, opts?: RequestInit }>
 *   }
 * }} TestCtx
 */

/**
 * Creates a BotCtx populated for tests.
 *
 * Every field is present. Response methods capture their arguments to
 * `calls` instead of reaching the network. Settings, storage, and
 * rooms are in-memory. No crypto is exercised.
 *
 * @template {Record<string, SettingDecl>} [S=Record<string, SettingDecl>] -
 *   The settings declaration map.
 * @param {object} [overrides] - Optional overrides.
 * @param {S} [overrides.settingsDecl] - The settings declaration.
 * @param {Record<string, unknown>} [overrides.settings] - Initial setting values.
 * @param {{ roomId: string, mode: Mode, scopes: Capability[] }} [overrides.grant] -
 *   The grant to populate. Default `null`.
 * @param {RoomRef} [overrides.room] - The room to populate. Default `null`.
 * @param {Record<string, unknown>} [overrides.storage] - Initial storage values.
 * @param {boolean} [overrides.strictStorage=false] - When `true`,
 *   `ctx.storage.get/set/delete` reject `_runtime:` prefixed keys
 *   with `StorageReservedPrefixError`.
 * @param {RoomRef[]} [overrides.roomsList] - The rooms `ctx.rooms.list()` returns. Default `[]`.
 * @param {{
 *   id: string,
 *   label: string,
 *   ownerUserId: string,
 *   avatar: Avatar
 * }} [overrides.bot] - Bot metadata. Defaults to a synthetic set.
 * @param {{
 *   id: string,
 *   type: string,
 *   roomId: string | null,
 *   timestamp: string
 * } | null} [overrides.event] - The event metadata. Default `null`.
 * @param {AbortSignal} [overrides.signal] - The abort signal. Default a fresh signal.
 * @param {Response | ((url: string, opts?: RequestInit) => Response | Promise<Response>)} [overrides.fetchResponse] -
 *   The response the `fetch` capture methods return. Default 200 Response.
 * @returns {TestCtx<S>} The test ctx.
 */
export function createTestCtx (overrides = {}) {
  const bot = overrides.bot ?? {
    id: 'b_test',
    label: 'Test Bot',
    ownerUserId: 'u_test',
    avatar: {
      fileId: null,
      emoji: null
    }
  }

  const grant = overrides.grant !== undefined ? overrides.grant : null
  const room = overrides.room !== undefined ? overrides.room : null
  const event = overrides.event !== undefined ? overrides.event : null
  const signal = overrides.signal ?? new AbortController().signal
  const fetchResponse = overrides.fetchResponse ?? new Response(null, { status: 200 })

  /** @type {TestCtx<S>['calls']} */
  const calls = {
    post: [],
    reply: [],
    sendLocal: [],
    fetch: [],
    fetchUserUrl: []
  }

  let messageCounter = 1

  /** @type {TestCtx<S>} */
  // @ts-ignore
  const ctx = {
    bot,
    grant,
    room,
    event,
    signal,
    calls,
    log: () => {
      // no-op
    },
    uploadAvatar: async () => {
      throw new Error('Not implemented')
    },

    /**
     * @param {PostOptions} opts - Post options.
     * @returns {Promise<MessageRef>} The message ref.
     */
    async post (opts) {
      calls.post.push(opts)
      const messageId = `m_test_${messageCounter++}`
      const roomId = opts.roomId ?? ctx.room?.id ?? 'r_test'
      return {
        id: messageId,
        roomId,
        createdAt: new Date().toISOString()
      }
    },

    /**
     * @param {ReplyOptions} opts - Reply options.
     * @returns {Promise<MessageRef>} The message ref.
     */
    async reply (opts) {
      calls.reply.push(opts)
      const messageId = `m_test_${messageCounter++}`
      const roomId = opts.roomId ?? ctx.room?.id ?? 'r_test'
      return {
        id: messageId,
        roomId,
        createdAt: new Date().toISOString()
      }
    },

    /**
     * @param {LocalOptions} opts - Send local options.
     * @returns {Promise<void>}
     */
    async sendLocal (opts) {
      calls.sendLocal.push(opts)
    },

    /**
     * @param {string} url - Target URL.
     * @param {RequestInit} [opts] - Fetch options.
     * @returns {Promise<Response>} The response.
     */
    async fetch (url, opts) {
      /** @type {{ url: string, opts?: RequestInit }} */
      const entry = { url }
      if (opts !== undefined) {
        entry.opts = opts
      }
      calls.fetch.push(entry)
      if (typeof fetchResponse === 'function') {
        return fetchResponse(url, opts)
      }
      return fetchResponse
    },

    /**
     * @param {string} url - Target URL.
     * @param {RequestInit} [opts] - Fetch options.
     * @returns {Promise<Response>} The response.
     */
    async fetchUserUrl (url, opts) {
      /** @type {{ url: string, opts?: RequestInit }} */
      const entry = { url }
      if (opts !== undefined) {
        entry.opts = opts
      }
      calls.fetchUserUrl.push(entry)
      if (typeof fetchResponse === 'function') {
        return fetchResponse(url, opts)
      }
      return fetchResponse
    }
  }

  // Settings Store
  const settingsMap = new Map(Object.entries(overrides.settings ?? {}))

  /**
   * Helper to resolve setting storage key.
   *
   * @param {string} key - Setting key.
   * @param {{ room?: string | RoomRef }} [opts] - Setting options.
   * @returns {string} The storage key.
   */
  function getSettingsKey (key, opts) {
    const roomId = typeof opts?.room === 'string' ? opts.room : opts?.room?.id
    if (roomId) {
      return `room:${roomId}:${key}`
    }
    return key
  }

  // @ts-ignore
  ctx.settings = {
    /**
     * @param {string} key - Setting key.
     * @param {{ room?: string | RoomRef }} [opts] - Setting options.
     * @returns {Promise<any>}
     */
    async get (key, opts) {
      const storageKey = getSettingsKey(key, opts)
      return settingsMap.get(storageKey)
    },
    /**
     * @param {string} key - Setting key.
     * @param {unknown} value - Setting value.
     * @param {{ room?: string | RoomRef }} [opts] - Setting options.
     * @returns {Promise<void>}
     */
    async set (key, value, opts) {
      const storageKey = getSettingsKey(key, opts)
      settingsMap.set(storageKey, value)
    },
    /**
     * @param {string} key - Setting key.
     * @param {{ room?: string | RoomRef }} [opts] - Setting options.
     * @returns {Promise<void>}
     */
    async delete (key, opts) {
      const storageKey = getSettingsKey(key, opts)
      settingsMap.delete(storageKey)
    },
    /**
     * @param {string} _key - Setting key.
     * @param {function} _cb - Callback.
     * @param {{ room?: string | RoomRef }} [_opts] - Setting options.
     * @returns {function(): void}
     */
    subscribe (_key, _cb, _opts) {
      return () => {
        // no-op
      }
    }
  }

  // Storage Store
  const storageMap = new Map(Object.entries(overrides.storage ?? {}))
  const strictStorage = Boolean(overrides.strictStorage)

  /**
   * Validates key prefix when strictStorage is enabled.
   *
   * @param {unknown} key - Key to check.
   */
  function validateStorageKey (key) {
    if (strictStorage && typeof key === 'string' && key.startsWith('_runtime:')) {
      throw new StorageReservedPrefixError(
        `Storage key "${key}" uses the reserved prefix "_runtime:"`
      )
    }
  }

  ctx.storage = {
    /**
     * @param {string} key - Storage key.
     * @returns {Promise<unknown>}
     */
    async get (key) {
      validateStorageKey(key)
      return storageMap.get(key)
    },
    /**
     * @param {string} key - Storage key.
     * @param {unknown} value - Value to store.
     * @returns {Promise<void>}
     */
    async set (key, value) {
      validateStorageKey(key)
      storageMap.set(key, value)
    },
    /**
     * @param {string} key - Storage key.
     * @returns {Promise<void>}
     */
    async delete (key) {
      validateStorageKey(key)
      storageMap.delete(key)
    },
    async clear () {
      if (strictStorage) {
        for (const key of storageMap.keys()) {
          if (!key.startsWith('_runtime:')) {
            storageMap.delete(key)
          }
        }
      } else {
        storageMap.clear()
      }
    }
  }

  // Rooms Store
  const roomsList = overrides.roomsList ? [...overrides.roomsList] : []

  ctx.rooms = {
    async list () {
      return [...roomsList]
    },
    /**
     * @param {string} roomId - Room ID.
     * @returns {Promise<RoomRef | null>}
     */
    async get (roomId) {
      if (typeof roomId !== 'string') {
        return null
      }
      return roomsList.find(r => r.id === roomId) ?? null
    }
  }

  return ctx
}
