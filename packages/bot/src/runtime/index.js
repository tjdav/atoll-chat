import { Storage } from './storage/index.js'
import { IdempotencyStore } from './idempotency/index.js'
import { PublisherKeyCache } from './crypto/publisher.js'
import { createSettingsStore } from './context/settings.js'
import { createStorageStore } from './context/storage.js'
import { createRoomsStore } from './context/rooms.js'
import { createPostHandler } from './context/post.js'
import { createReplyHandler } from './context/reply.js'
import { createSendLocalHandler } from './context/send-local.js'
import { createFetchMethods } from './context/fetch.js'
import { createCommandInvocationHandler } from './context/command-invoked.js'
import { createHttpClient } from './transport/http.js'
import { createWebSocketClient } from './transport/websocket.js'

/**
 * Decodes a base64url string to Uint8Array.
 *
 * @param {string} str - The base64url string.
 * @returns {Uint8Array} Decoded bytes.
 */
function decodeBase64url (str) {
  if (typeof str !== 'string') {
    return new Uint8Array(0)
  }
  return new Uint8Array(Buffer.from(str, 'base64url'))
}

/**
 * Validates whether a string is valid base64url decoding to exactly expected length.
 *
 * @param {unknown} str - Value to validate.
 * @param {number} expectedLength - Exact byte length expected.
 * @returns {boolean} True if valid.
 */
function isValidBase64urlKey (str, expectedLength) {
  if (typeof str !== 'string' || str.length === 0) {
    return false
  }
  if (!/^[A-Za-z0-9_-]+$/.test(str)) {
    return false
  }
  try {
    const buf = Buffer.from(str, 'base64url')
    return buf.byteLength === expectedLength
  } catch {
    return false
  }
}

/**
 * @typedef {object} Runtime
 * @property {() => Promise<void>} start - Runs the boot sequence and connects the WebSocket client.
 * @property {() => Promise<void>} stop - Closes the WebSocket client, calls the uninstall handler, and flushes storage.
 * @property {(invocation?: object) => Promise<import('../types.js').BotCtx>} makeBotCtx - Constructs a BotCtx for an invocation.
 */

/**
 * Creates the runtime for a bot.
 *
 * @param {object} deps - Factory dependencies.
 * @param {import('../define-bot.js').Bot} deps.bot - The bot handle from `defineBot`.
 * @param {import('./config/index.js').Config} deps.config - The resolved config from `loadConfig`.
 * @param {object} deps.keystoreData - The decrypted keystore plaintext.
 * @param {import('./diagnostics/logger.js').Logger} deps.logger - The runtime logger.
 * @param {typeof globalThis.fetch} [deps.fetchImpl=globalThis.fetch] - The fetch implementation.
 * @param {typeof globalThis.WebSocket} [deps.WebSocketImpl=globalThis.WebSocket] - The WebSocket constructor.
 * @param {string} [deps.storagePath] - Path for the storage file. Defaults to `<config.keystorePath>.storage`.
 * @returns {Runtime} The bot runtime.
 */
export function createRuntime ({
  bot,
  config,
  keystoreData,
  logger,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  storagePath
}) {
  if (!bot || typeof bot !== 'object' || !bot.config || typeof bot.config !== 'object') {
    throw new Error('bot must be an object with a config property')
  }
  if (!config || typeof config !== 'object') {
    throw new Error('config must be an object')
  }
  if (!logger || typeof logger !== 'object' || typeof logger.log !== 'function') {
    throw new Error('logger must be a valid Logger object')
  }
  if (typeof config.serverUrl !== 'string' || config.serverUrl.trim() === '') {
    throw new Error('config.serverUrl must be a non-empty string')
  }
  if (typeof config.botToken !== 'string' || config.botToken.trim() === '') {
    throw new Error('config.botToken must be a non-empty string')
  }
  if (!keystoreData || typeof keystoreData !== 'object') {
    throw new Error('keystoreData must be an object')
  }
  if (typeof keystoreData.bot_token !== 'string' || keystoreData.bot_token.trim() === '') {
    throw new Error('keystoreData.bot_token must be a non-empty string')
  }
  if (typeof keystoreData.bot_id !== 'string' || keystoreData.bot_id.trim() === '') {
    throw new Error('keystoreData.bot_id must be a non-empty string')
  }
  if (!isValidBase64urlKey(keystoreData.bot_identity_private, 32)) {
    throw new Error('keystoreData.bot_identity_private must be a 32-byte base64url string')
  }
  if (!isValidBase64urlKey(keystoreData.bot_command_private, 32)) {
    throw new Error('keystoreData.bot_command_private must be a 32-byte base64url string')
  }
  if (!isValidBase64urlKey(keystoreData.storage_seed, 32)) {
    throw new Error('keystoreData.storage_seed must be a 32-byte base64url string')
  }

  const botId = keystoreData.bot_id
  const resolvedStoragePath = storagePath ?? `${config.keystorePath}.storage`

  /** @type {Map<string, { mode: string, scopes: string[] }>} */
  const grants = new Map()

  let isStarted = false
  let isStopped = false

  /** @type {import('./storage/index.js').Storage | null} */
  let storage = null
  /** @type {import('./idempotency/index.js').IdempotencyStore | null} */
  let idempotency = null
  /** @type {PublisherKeyCache | null} */
  let publisherKeys = null
  /** @type {ReturnType<import('./context/settings.js').createSettingsStore> | null} */
  let settingsStore = null
  /** @type {ReturnType<import('./context/storage.js').createStorageStore> | null} */
  let storageStore = null
  /** @type {ReturnType<import('./context/rooms.js').createRoomsStore> | null} */
  let roomsStore = null
  /** @type {ReturnType<import('./transport/websocket.js').createWebSocketClient> | null} */
  let ws = null

  /** @type {ReturnType<import('./context/post.js').createPostHandler> | null} */
  let postHandler = null
  /** @type {ReturnType<import('./context/reply.js').createReplyHandler> | null} */
  let replyHandler = null
  /** @type {ReturnType<import('./context/send-local.js').createSendLocalHandler> | null} */
  let sendLocalHandler = null
  /** @type {ReturnType<import('./context/command-invoked.js').createCommandInvocationHandler> | null} */
  let commandHandler = null

  /** @type {ReturnType<import('./context/fetch.js').createFetchMethods>['fetch'] | null} */
  let fetchMethod = null
  /** @type {ReturnType<import('./context/fetch.js').createFetchMethods>['fetchUserUrl'] | null} */
  let fetchUserUrlMethod = null

  /** @type {{ ownerUserId: string, displayName: string, avatarFileId: string | null } | null} */
  let botMeta = null

  let warnedRoomListFetch = false

  /**
   * Stubbed fetchRoomList implementation.
   *
   * @returns {Promise<any[]>}
   */
  async function fetchRoomListImpl () {
    if (!warnedRoomListFetch) {
      warnedRoomListFetch = true
      logger.warn('rooms.list called but no bot-facing room list endpoint is specified; returning []')
    }
    return []
  }

  /**
   * Stubbed getOwnerPubkey implementation.
   *
   * @returns {Promise<Uint8Array>}
   */
  async function getOwnerPubkeyImpl () {
    throw new Error('owner pubkey resolution is not yet implemented')
  }

  /**
   * Constructs a BotCtx for an invocation.
   *
   * @param {object} [invocation] - Optional invocation parameters.
   * @param {string} [invocation.roomId] - Room ID for the context.
   * @param {import('../types.js').BotEvent} [invocation.event] - Event object.
   * @param {AbortSignal} [invocation.signal] - AbortSignal.
   * @returns {Promise<import('../types.js').BotCtx>} The context instance.
   */
  async function makeBotCtx (invocation) {
    const roomId = invocation?.roomId ?? null
    const grant = roomId ? (grants.get(roomId) ?? null) : null
    const room = roomId && roomsStore ? await roomsStore.get(roomId) : null
    const signal = invocation?.signal ?? new AbortController().signal

    /** @type {import('../types.js').BotCtx} */
    const ctx = {
      bot: {
        id: botId,
        label: bot.config.label,
        ownerUserId: botMeta?.ownerUserId ?? '',
        avatar: {
          fileId: botMeta?.avatarFileId ?? null,
          emoji: bot.config.avatar?.emoji ?? null
        }
      },
      grant,
      room,
      event: invocation?.event ?? null,
      settings: settingsStore,
      storage: storageStore,
      rooms: roomsStore,
      log: (level, msg, meta) => logger.log(level, msg, meta),
      fetch: fetchMethod,
      fetchUserUrl: fetchUserUrlMethod,
      signal,
      uploadAvatar: async () => {
        throw new Error('uploadAvatar is not yet implemented')
      },
      post: async (opts) => {
        if (!postHandler) {
          throw new Error('postHandler not initialized')
        }
        return postHandler(opts, ctx)
      },
      reply: async (opts) => {
        if (!replyHandler) {
          throw new Error('replyHandler not initialized')
        }
        return replyHandler(opts, ctx)
      },
      sendLocal: async (opts) => {
        if (!sendLocalHandler) {
          throw new Error('sendLocalHandler not initialized')
        }
        return sendLocalHandler(opts)
      }
    }

    return ctx
  }

  /**
   * Dispatches bot channel events.
   *
   * @param {string} eventName - Name of the event.
   * @param {unknown} rawData - Raw data string or object.
   */
  async function handleBotChannelEvent (eventName, rawData) {
    logger.debug('event dispatched', {
      meta: {
        event: eventName,
        has_data: rawData !== undefined && rawData !== null
      }
    })

    let data = rawData
    if (typeof rawData === 'string') {
      try {
        data = JSON.parse(rawData)
      } catch {
        data = rawData
      }
    }

    try {
      switch (eventName) {
        case 'bot.command_invoked': {
          if (commandHandler) {
            await commandHandler(data)
          }
          break
        }
        case 'bot.settings_updated': {
          if (settingsStore) {
            settingsStore.refresh().catch((err) => {
              logger.error('settings refresh failed', { meta: { error: err?.message ?? String(err) } })
            })
          }
          break
        }
        case 'bot.grant_updated': {
          if (data && typeof data === 'object' && typeof data.room_id === 'string') {
            const mode = typeof data.mode === 'string' ? data.mode : ''
            const scopes = Array.isArray(data.scopes) ? data.scopes : []
            grants.set(data.room_id, { mode, scopes })

            const ctx = await makeBotCtx({ roomId: data.room_id })
            if (typeof bot.config.handlers?.grantUpdated === 'function') {
              await bot.config.handlers.grantUpdated(ctx, data)
            }
          }
          break
        }
        case 'bot.updated': {
          logger.debug('bot.updated event received')
          break
        }
        case 'bot.keys_rotated': {
          if (publisherKeys) {
            publisherKeys.markAllStale()
            setTimeout(() => {
              publisherKeys.reverifyAll().catch((err) => {
                logger.error('publisher key reverifyAll failed', { meta: { error: err?.message ?? String(err) } })
              })
            }, 0)
          }
          break
        }
        case 'room.publisher_key_updated': {
          if (publisherKeys && data && typeof data === 'object') {
            const mapped = {
              roomId: data.room_id,
              epoch: data.epoch,
              publisherPublicKey: decodeBase64url(data.publisher_public_key),
              signerUserId: data.signer_user_id,
              signature: decodeBase64url(data.signature)
            }
            publisherKeys.recordPublication(mapped)
          }
          break
        }
        default: {
          logger.warn('unknown bot channel event', { meta: { event: eventName } })
          break
        }
      }
    } catch (err) {
      logger.error('error dispatching bot channel event', {
        meta: {
          event: eventName,
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }

  /**
   * Runs the boot sequence and connects the WebSocket client.
   *
   * @returns {Promise<void>}
   */
  async function start () {
    if (isStarted) {
      return
    }

    logger.info('runtime boot', { meta: { bot_id: botId } })

    const apiHttp = createHttpClient({
      serverUrl: `${config.serverUrl}/api/v1`,
      botToken: keystoreData.bot_token,
      logger,
      fetchImpl
    })

    const rootHttp = createHttpClient({
      serverUrl: config.serverUrl,
      botToken: keystoreData.bot_token,
      logger,
      fetchImpl
    })

    // Fetch capabilities
    const capRes = await rootHttp.request('GET', '/capabilities')
    const capBody = capRes.body
    if (
      !capBody ||
      typeof capBody !== 'object' ||
      typeof capBody.sockudo_url !== 'string' ||
      typeof capBody.sockudo_app_key !== 'string' ||
      typeof capBody.sockudo_auth_endpoint !== 'string'
    ) {
      throw new Error('Capabilities response missing required Sockudo fields')
    }

    // Fetch bot metadata
    const botRes = await apiHttp.request('GET', `/bots/${botId}`)
    const botBody = botRes.body
    if (!botBody || typeof botBody !== 'object') {
      throw new Error('Bot metadata response is malformed')
    }

    botMeta = {
      ownerUserId: typeof botBody.owner_user_id === 'string' ? botBody.owner_user_id : '',
      displayName: typeof botBody.display_name === 'string' ? botBody.display_name : '',
      avatarFileId: typeof botBody.avatar_file_id === 'string' ? botBody.avatar_file_id : null
    }

    // Storage
    storage = new Storage({
      path: resolvedStoragePath,
      seed: decodeBase64url(keystoreData.storage_seed),
      botId
    })
    await storage.open()

    idempotency = new IdempotencyStore({ storage, logger })

    // Publisher key cache
    publisherKeys = new PublisherKeyCache({
      lookupSignerPubkey: async (userId) => {
        const ktRes = await apiHttp.request('GET', `/kt/user/${userId}`)
        if (!ktRes.body || typeof ktRes.body.identity_pubkey !== 'string') {
          throw new Error(`Key transparency lookup failed for user ${userId}`)
        }
        return decodeBase64url(ktRes.body.identity_pubkey)
      },
      logger
    })

    settingsStore = createSettingsStore({
      botId,
      http: apiHttp,
      botCommandPrivateKey: decodeBase64url(keystoreData.bot_command_private),
      logger
    })

    storageStore = createStorageStore({ storage })
    roomsStore = createRoomsStore({ fetchRoomList: fetchRoomListImpl, logger })

    // Response methods
    postHandler = createPostHandler({
      http: apiHttp,
      publisherKeys,
      botIdentityPrivateKey: decodeBase64url(keystoreData.bot_identity_private),
      logger
    })
    replyHandler = createReplyHandler({ post: postHandler, logger })
    sendLocalHandler = createSendLocalHandler({
      http: apiHttp,
      getOwnerPubkey: getOwnerPubkeyImpl,
      logger
    })

    const fetchMethods = createFetchMethods({ logger, fetchImpl })
    fetchMethod = fetchMethods.fetch
    fetchUserUrlMethod = fetchMethods.fetchUserUrl

    // Command invocation handler
    commandHandler = createCommandInvocationHandler({
      botCommandPrivateKey: decodeBase64url(keystoreData.bot_command_private),
      bot,
      http: apiHttp,
      makeBotCtx,
      logger,
      handlerTimeoutMs: config.handlerTimeoutMs
    })

    // WebSocket client
    ws = createWebSocketClient({
      socketUrl: capBody.sockudo_url,
      appKey: capBody.sockudo_app_key,
      authCallback: async (socketId, channelName) => {
        const authRes = await rootHttp.request('POST', capBody.sockudo_auth_endpoint, {
          body: {
            socket_id: socketId,
            channel_name: channelName
          }
        })
        return authRes.body
      },
      WebSocketImpl,
      logger
    })

    ws.on('close', (payload) => {
      logger.warn('websocket closed', { meta: payload })
    })

    ws.on('error', (err) => {
      logger.error('websocket error', { meta: { error: err?.message ?? String(err) } })
    })

    ws.subscribe(`private-bot-${botId}`, handleBotChannelEvent)

    await ws.connect()

    isStarted = true

    const baseCtx = await makeBotCtx({})
    if (typeof bot.config.handlers?.install === 'function') {
      await bot.config.handlers.install(baseCtx)
    }

    logger.info('runtime ready')
  }

  /**
   * Closes the WebSocket client, calls the uninstall handler, and flushes storage.
   *
   * @returns {Promise<void>}
   */
  async function stop () {
    if (!isStarted || isStopped) {
      return
    }
    isStopped = true

    const baseCtx = await makeBotCtx({})
    if (typeof bot.config.handlers?.uninstall === 'function') {
      await bot.config.handlers.uninstall(baseCtx)
    }

    if (ws) {
      await ws.close()
    }

    if (storage) {
      await storage.close()
    }

    logger.info('runtime stopped')
  }

  return {
    start,
    stop,
    makeBotCtx
  }
}
