import crypto from 'node:crypto'
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
import { createSseClient } from './transport/sse.js'
import { createWebhookServer } from './triggers/webhook.js'
import { createCronEngine } from './triggers/cron.js'
import { createPausePolicy } from './pause-policy.js'
import { createReconnectController } from './reconnect.js'
import { createShutdownTracker } from './shutdown.js'
import { createDiagFileWriter } from './diagnostics/diag-file-writer.js'
import { createDiagnosticsCapture } from './diagnostics/capture.js'

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
 * @typedef {object} RoomSubscription
 * @property {'websocket' | 'sse'} kind
 * @property {boolean} [connected]
 * @property {() => Promise<void>} close
 * @property {import('./transport/sse.js').SseClient | null} [client]
 */

/**
 * @typedef {object} Runtime
 * @property {() => Promise<void>} start - Runs the boot sequence and connects the WebSocket client.
 * @property {(opts?: { drainMs?: number }) => Promise<{ drained: boolean, remaining: number }>} stop - Closes resources and drains in-flight operations.
 * @property {(invocation?: object) => Promise<BotCtx>} makeBotCtx - Constructs a BotCtx for an invocation.
 * @property {Map<string, RoomSubscription>} [subscriptions] - Internal room subscription registry.
 * @property {import('./shutdown.js').ShutdownTracker | null} [shutdownTracker] - Shutdown tracker instance.
 */

/**
 * Creates the runtime for a bot.
 *
 * @param {object} deps - Factory dependencies.
 * @param {Bot<any, any, any>} deps.bot - The bot handle from `defineBot`.
 * @param {import('./config/index.js').Config} deps.config - The resolved config from `loadConfig`.
 * @param {any} deps.keystoreData - The decrypted keystore plaintext.
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

  /** @type {ReturnType<typeof createDiagFileWriter> | null} */
  let diagFileWriter = null
  /** @type {ReturnType<typeof createDiagnosticsCapture> | null} */
  let capture = null

  // Logger wrapper to forward log lines to diagnostics capture
  const originalLog = logger.log.bind(logger)
  /** @type {import('./diagnostics/logger.js').Logger} */
  const wrappedLogger = {
    ...logger,
    log: (level, msg, meta) => {
      originalLog(level, msg, meta)
      if (capture) {
        try {
          /** @type {Record<string, unknown>} */
          const logRecord = {
            level,
            msg: String(msg ?? '')
          }
          if (meta && typeof meta === 'object') {
            logRecord.meta = meta
          }
          capture.recordLog(logRecord)
        } catch {
        }
      }
    },
    debug: (msg, meta) => wrappedLogger.log('debug', msg, meta),
    info: (msg, meta) => wrappedLogger.log('info', msg, meta),
    warn: (msg, meta) => wrappedLogger.log('warn', msg, meta),
    error: (msg, meta) => wrappedLogger.log('error', msg, meta)
  }

  const effectiveLogger = wrappedLogger

  /** @type {Map<string, { mode: string, scopes: string[] }>} */
  const grants = new Map()

  /** @type {Map<string, RoomSubscription>} */
  const subscriptions = new Map()

  let lifecycleController = new AbortController()

  let isStarted = false
  /** @type {Promise<{ drained: boolean, remaining: number }> | null} */
  let stopping = null

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
  /** @type {ReturnType<import('./triggers/webhook.js').createWebhookServer> | null} */
  let webhookServer = null
  /** @type {ReturnType<import('./triggers/cron.js').createCronEngine> | null} */
  let cronEngine = null
  /** @type {ReturnType<typeof createPausePolicy> | null} */
  let pausePolicy = null
  /** @type {ReturnType<typeof createReconnectController> | null} */
  let reconnectController = null
  /** @type {import('./shutdown.js').ShutdownTracker | null} */
  let shutdownTracker = null
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
      effectiveLogger.warn('rooms.list called but no bot-facing room list endpoint is specified; returning []')
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
   * Subscribes to a WebSocket room channel.
   *
   * @param {string} roomId - Room ID.
   * @returns {Promise<void>}
   */
  async function subscribeRoomWebSocket (roomId) {
    if (!ws) {
      return
    }
    const channelName = `private-room-${roomId}`
    try {
      const unsubscribe = ws.subscribe(channelName, (eventName, data) => {
        onRoomEvent(roomId, eventName, data).catch((err) => {
          logger.error('room event dispatch failed', {
            meta: {
              room_id: roomId,
              event: eventName,
              error: err instanceof Error ? err.message : String(err)
            }
          })
        })
      })
      subscriptions.set(roomId, {
        kind: 'websocket',
        close: async () => {
          unsubscribe()
        }
      })
      effectiveLogger.debug('room subscribed', {
        meta: {
          room_id: roomId,
          kind: 'websocket'
        }
      })
    } catch (err) {
      effectiveLogger.warn('room subscribe failed', {
        meta: {
          room_id: roomId,
          kind: 'websocket',
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }

  /**
   * Opens an SSE stream for an observer-mode room.
   *
   * @param {string} roomId - Room ID.
   * @returns {Promise<void>}
   */
  async function subscribeRoomSse (roomId) {
    const existingEntry = subscriptions.get(roomId)
    const initialLastEventId = existingEntry?.client?.getLastEventId()
    const path = `/rooms/${encodeURIComponent(roomId)}/observer-stream`

    if (!existingEntry) {
      subscriptions.set(roomId, {
        kind: 'sse',
        connected: false,
        client: null,
        close: async () => {
        }
      })
    }

    try {
      const sse = createSseClient({
        serverUrl: `${config.serverUrl}/api/v1`,
        botToken: keystoreData.bot_token,
        path,
        fetchImpl,
        logger,
        ...(initialLastEventId ? { initialLastEventId } : {}),
        onEvent: (sseEvent) => {
          onRoomEvent(roomId, sseEvent.event, sseEvent.data).catch((err) => {
            logger.error('sse event dispatch failed', {
              meta: {
                room_id: roomId,
                event: sseEvent.event,
                error: err instanceof Error ? err.message : String(err)
              }
            })
          })
        },
        onError: (err) => {
          logger.warn('sse stream error', {
            meta: {
              room_id: roomId,
              error: err instanceof Error ? err.message : String(err)
            }
          })
        },
        onClose: (payload) => {
          logger.debug('sse stream closed', {
            meta: {
              room_id: roomId,
              code: payload?.code
            }
          })
          const sub = subscriptions.get(roomId)
          if (sub && sub.kind === 'sse') {
            sub.connected = false
          }
          if (reconnectController) {
            reconnectController.notifySseClosed(roomId).catch(() => {
            })
          }
        }
      })
      await sse.connect()
      const sub = subscriptions.get(roomId)
      if (sub) {
        sub.kind = 'sse'
        sub.connected = true
        sub.client = sse
        sub.close = async () => {
          await sse.close()
        }
      } else {
        subscriptions.set(roomId, {
          kind: 'sse',
          connected: true,
          client: sse,
          close: async () => {
            await sse.close()
          }
        })
      }
      logger.debug('room subscribed', {
        meta: {
          room_id: roomId,
          kind: 'sse'
        }
      })
    } catch (err) {
      logger.warn('room subscribe failed', {
        meta: {
          room_id: roomId,
          kind: 'sse',
          error: err instanceof Error ? err.message : String(err)
        }
      })
      throw err
    }
  }

  /**
   * Tears down a room subscription.
   *
   * @param {string} roomId - Room ID.
   * @returns {Promise<void>}
   */
  async function unsubscribeRoom (roomId) {
    const sub = subscriptions.get(roomId)
    if (!sub) {
      return
    }
    subscriptions.delete(roomId)
    try {
      await sub.close()
      logger.debug('room unsubscribed', { meta: { room_id: roomId } })
    } catch (err) {
      logger.warn('room unsubscribe failed', {
        meta: {
          room_id: roomId,
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }

  /**
   * Dispatches room events to handlers.
   *
   * @param {string} roomId - Room ID.
   * @param {string} eventName - Event type/name.
   * @param {unknown} rawData - Raw event payload.
   * @returns {Promise<void>}
   */
  async function onRoomEvent (roomId, eventName, rawData) {
    if (shutdownTracker?.isShuttingDown()) {
      logger.debug('room event skipped: shutting down', {
        meta: {
          room_id: roomId,
          event: eventName
        }
      })
      return
    }

    /** @type {any} */
    let raw = rawData
    if (typeof rawData === 'string') {
      try {
        raw = JSON.parse(rawData)
      } catch {
        raw = rawData
      }
    }

    const isMessageEvent = eventName === 'message.new' || eventName === 'message.edited' || eventName === 'message.deleted'
    const sub = subscriptions.get(roomId)
    const isSse = sub?.kind === 'sse'

    const eventId = (raw && typeof raw === 'object' && typeof raw.id === 'string') ? raw.id : crypto.randomUUID()
    const timestamp = new Date().toISOString()

    let eventObj
    if (isMessageEvent) {
      if (eventName === 'message.deleted') {
        eventObj = {
          id: eventId,
          type: eventName,
          roomId,
          timestamp,
          data: {
            id: raw?.id ?? eventId
          }
        }
      } else if (isSse) {
        eventObj = {
          id: eventId,
          type: eventName,
          roomId,
          timestamp,
          data: {
            id: raw?.id ?? eventId,
            senderUserId: raw?.sender_user_id,
            senderClientId: raw?.sender_client_id,
            createdAt: raw?.created_at,
            sizeBytes: raw?.size_bytes
          }
        }
      } else {
        // Member mode over WebSocket
        eventObj = {
          id: eventId,
          type: eventName,
          roomId,
          timestamp,
          data: {
            id: raw?.id ?? eventId,
            senderUserId: raw?.sender_id ?? raw?.sender_user_id ?? null,
            senderClientId: raw?.sender_client_id ?? null,
            createdAt: raw?.created_at ?? null,
            plaintext: null,
            attachments: [],
            replyTo: raw?.reply_to ?? null
          }
        }
      }
    } else {
      // Room event
      eventObj = {
        id: crypto.randomUUID(),
        type: eventName,
        roomId,
        timestamp,
        data: raw
      }
    }

    const ctx = await makeBotCtx({
      roomId,
      event: eventObj,
      signal: lifecycleController.signal
    })

    /** @type {any} */
    const handlers = bot.config.handlers
    const handler = isMessageEvent
      ? handlers?.message
      : handlers?.room

    if (typeof handler !== 'function') {
      return
    }

    if (pausePolicy?.isPaused()) {
      logger.debug('room event skipped: bot paused', {
        meta: {
          room_id: roomId,
          event: eventName
        }
      })
      return
    }

    if (pausePolicy) {
      const guardResult = await pausePolicy.guard(() => handler(ctx, eventObj))
      if (guardResult.kind === 'paused') {
        logger.debug('room event skipped: bot paused', {
          meta: {
            room_id: roomId,
            event: eventName
          }
        })
        return
      }
      if (guardResult.kind === 'failure') {
        const errorMsg = guardResult.error instanceof Error ? guardResult.error.message : String(guardResult.error)
        logger.error('room event dispatch failed', {
          meta: {
            room_id: roomId,
            event: eventName,
            error: errorMsg
          }
        })
      }
    } else {
      try {
        await handler(ctx, eventObj)
      } catch (err) {
        logger.error('room event dispatch failed', {
          meta: {
            room_id: roomId,
            event: eventName,
            error: err instanceof Error ? err.message : String(err)
          }
        })
      }
    }
  }

  /**
   * Constructs a BotCtx for an invocation.
   *
   * @param {object} [invocation] - Optional invocation parameters.
   * @param {string} [invocation.roomId] - Room ID for the context.
   * @param {any} [invocation.event] - Event object.
   * @param {AbortSignal} [invocation.signal] - AbortSignal.
   * @returns {Promise<BotCtx>} The context instance.
   */
  async function makeBotCtx (invocation) {
    const roomId = invocation?.roomId ?? null
    const grant = roomId ? (grants.get(roomId) ?? null) : null
    const room = roomId && roomsStore ? await roomsStore.get(roomId) : null
    const signal = invocation?.signal ?? lifecycleController.signal

    /** @type {Mode | null} */
    let grantMode = null
    /** @type {Capability[] | null} */
    let grantScopes = null
    if (grant && roomId) {
      /** @type {any} */
      const untypedGrant = grant
      grantMode = untypedGrant.mode
      grantScopes = untypedGrant.scopes
    }

    /** @type {any} */
    const typedSettingsStore = settingsStore
    /** @type {any} */
    const typedStorageStore = storageStore
    /** @type {any} */
    const typedRoomsStore = roomsStore
    /** @type {any} */
    const typedFetchMethod = fetchMethod
    /** @type {any} */
    const typedFetchUserUrlMethod = fetchUserUrlMethod

    /** @type {BotCtx} */
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
      grant: (grantMode && grantScopes && roomId)
        ? {
          roomId,
          mode: grantMode,
          scopes: grantScopes
        }
        : null,
      room,
      event: invocation?.event ?? null,
      settings: typedSettingsStore,
      storage: typedStorageStore,
      rooms: typedRoomsStore,
      log: (level, msg, meta) => {
        effectiveLogger.log(level, msg, meta)
      },
      fetch: typedFetchMethod,
      fetchUserUrl: typedFetchUserUrlMethod,
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

    /** @type {any} */
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
              logger.error('settings refresh failed', {
                meta: {
                  error: err?.message ?? String(err)
                }
              })
            })
          }
          break
        }
        case 'bot.grant_updated': {
          if (data && typeof data === 'object' && typeof data.room_id === 'string') {
            const roomId = data.room_id
            const oldMode = grants.get(roomId)?.mode ?? null
            let newMode = ''
            if (typeof data.new_mode === 'string') {
              newMode = data.new_mode
            } else if (typeof data.mode === 'string') {
              newMode = data.mode
            }
            const scopes = Array.isArray(data.scopes) ? data.scopes : []
            grants.set(roomId, {
              mode: newMode,
              scopes
            })

            if (oldMode !== newMode) {
              if (oldMode === 'member' || oldMode === 'observer') {
                await unsubscribeRoom(roomId)
              }
              if (newMode === 'member') {
                await subscribeRoomWebSocket(roomId)
              } else if (newMode === 'observer') {
                await subscribeRoomSse(roomId)
              }
            }

            const ctx = await makeBotCtx({ roomId })
            if (typeof bot.config.handlers?.grantUpdated === 'function') {
              await bot.config.handlers.grantUpdated(ctx, data)
            }
          }
          break
        }
        case 'bot.revoked': {
          if (data && typeof data === 'object' && typeof data.room_id === 'string') {
            const roomId = data.room_id
            grants.delete(roomId)
            await unsubscribeRoom(roomId)
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
              publisherKeys?.reverifyAll().catch((err) => {
                logger.error('publisher key reverifyAll failed', {
                  meta: { error: err?.message ?? String(err) }
                })
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

    shutdownTracker = createShutdownTracker(effectiveLogger)
    lifecycleController = new AbortController()

    const diagPath = `${config.keystorePath}.diag.jsonl`
    diagFileWriter = createDiagFileWriter({ path: diagPath, logger: effectiveLogger })
    await diagFileWriter.truncate()

    /**
     * Constructs a snapshot of current runtime state for diagnostics.
     *
     * @returns {object}
     */
    function snapshotState () {
      return {
        grants: Array.from(grants.entries()).map(([roomId, g]) => ({
          roomId,
          mode: g.mode,
          scopes: g.scopes
        })),
        publisher_keys: [],
        settings_keys: settingsStore ? settingsStore.keys() : [],
        storage_keys: storageStore ? storageStore.keys() : [],
        in_flight: shutdownTracker ? shutdownTracker.inFlightCount() : 0,
        paused: pausePolicy ? pausePolicy.isPaused() : false,
        bot_id: botId
      }
    }

    const storageForCapture = storage
    if (!storageForCapture) {
      throw new Error('storage instance missing')
    }

    capture = createDiagnosticsCapture({
      storage: storageForCapture,
      diagFile: diagFileWriter,
      logger: effectiveLogger,
      snapshotState,
      botId
    })

    const stateAtISO = new Date().toISOString()
    const stateData = snapshotState()
    await diagFileWriter.append({
      type: 'state',
      at: stateAtISO,
      data: stateData
    })

    const apiHttp = createHttpClient({
      serverUrl: `${config.serverUrl ?? ''}/api/v1`,
      botToken: keystoreData?.bot_token ?? '',
      logger: effectiveLogger,
      fetchImpl
    })

    const rootHttp = createHttpClient({
      serverUrl: config.serverUrl ?? '',
      botToken: keystoreData?.bot_token ?? '',
      logger: effectiveLogger,
      fetchImpl
    })

    pausePolicy = createPausePolicy({
      reportPause: async (payload) => {
        if (capture) {
          await capture.recordSnapshot('pause', payload)
        }
        await apiHttp.request('POST', '/bots/me/pause', {
          body: payload,
          retry: false
        })
      },
      logger
    })

    // Fetch capabilities
    const capRes = await rootHttp.request('GET', '/capabilities')
    /** @type {any} */
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
    /** @type {any} */
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
    const storageInst = new Storage({
      path: resolvedStoragePath,
      seed: decodeBase64url(keystoreData.storage_seed),
      botId
    })
    storage = storageInst
    await storage.open()

    idempotency = new IdempotencyStore({
      storage,
      logger
    })

    // Publisher key cache
    publisherKeys = new PublisherKeyCache({
      lookupSignerPubkey: async (userId) => {
        const ktRes = await apiHttp.request('GET', `/kt/user/${userId}`)
        /** @type {any} */
        const ktBody = ktRes.body
        if (!ktBody || typeof ktBody.identity_pubkey !== 'string') {
          throw new Error(`Key transparency lookup failed for user ${userId}`)
        }
        return decodeBase64url(ktBody.identity_pubkey)
      }
    })

    settingsStore = createSettingsStore({
      botId,
      http: apiHttp,
      botCommandPrivateKey: decodeBase64url(keystoreData.bot_command_private),
      logger
    })

    storageStore = createStorageStore({ storage })
    roomsStore = createRoomsStore({
      fetchRoomList: fetchRoomListImpl,
      logger
    })

    // Response methods
    postHandler = createPostHandler({
      http: apiHttp,
      publisherKeys,
      botIdentityPrivateKey: decodeBase64url(keystoreData.bot_identity_private),
      logger
    })
    replyHandler = createReplyHandler({
      post: postHandler,
      logger
    })
    sendLocalHandler = createSendLocalHandler({
      http: apiHttp,
      getOwnerPubkey: getOwnerPubkeyImpl,
      logger
    })

    const fetchMethods = createFetchMethods({
      logger,
      fetchImpl
    })
    fetchMethod = fetchMethods.fetch
    fetchUserUrlMethod = fetchMethods.fetchUserUrl

    /** @type {any} */
    const makeBotCtxUntyped = makeBotCtx

    // Command invocation handler
    commandHandler = createCommandInvocationHandler({
      botCommandPrivateKey: decodeBase64url(keystoreData.bot_command_private),
      bot,
      http: apiHttp,
      makeBotCtx: makeBotCtxUntyped,
      pausePolicy,
      shutdownTracker,
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
        /** @type {any} */
        const authBody = authRes.body
        return authBody
      },
      WebSocketImpl,
      logger
    })

    ws.on('error', (err) => {
      /** @type {any} */
      const untypedErr = err
      logger.error('websocket error', { meta: { error: untypedErr?.message ?? String(untypedErr) } })
    })

    ws.subscribe(`private-bot-${botId}`, handleBotChannelEvent)

    /**
     * Post-reconnect sequence execution.
     *
     * @returns {Promise<void>}
     */
    async function postReconnectSequence () {
      logger.warn('reconnect: grant refetch skipped; no bot-facing endpoint')
      if (settingsStore) {
        await settingsStore.refresh()
      }
      if (publisherKeys) {
        await publisherKeys.reverifyAll()
      }
    }

    /**
     * SSE reconnect callback for reconnect controller.
     *
     * @param {string} [targetRoomId] - Optional room ID.
     * @returns {Promise<void>}
     */
    async function reconnectSse (targetRoomId) {
      if (targetRoomId) {
        const entry = subscriptions.get(targetRoomId)
        if (entry && entry.kind === 'sse' && !entry.connected) {
          await subscribeRoomSse(targetRoomId)
        }
      } else {
        for (const [roomId, entry] of subscriptions.entries()) {
          if (entry.kind === 'sse' && !entry.connected) {
            try {
              await subscribeRoomSse(roomId)
            } catch (err) {
              logger.warn('sse reconnect failed', {
                meta: {
                  room_id: roomId,
                  error: err instanceof Error ? err.message : String(err)
                }
              })
            }
          }
        }
      }
    }

    reconnectController = createReconnectController({
      ws,
      baseBackoffMs: config.reconnect?.baseBackoffMs ?? 1000,
      maxBackoffMs: config.reconnect?.maxBackoffMs ?? 30000,
      jitter: config.reconnect?.jitter ?? 0.2,
      onConnected: async () => {
        capture?.notifyReconnectSuccess()
        await postReconnectSequence()
      },
      onReconnectFailed: (attempt, error) => {
        capture?.notifyReconnectFailed(attempt, error).catch(() => {
        })
      },
      reconnectSse,
      logger
    })

    try {
      await ws.connect()
      reconnectController.start()

      /** @type {any[]} */
      const triggersList = bot.config.triggers ?? []
      const webhookTriggers = triggersList.filter((t) => t.type === 'webhook')
      const scheduleTriggers = triggersList.filter((t) => t.type === 'schedule')

      /** @type {any} */
      const typedWebhookTriggers = webhookTriggers
      /** @type {any} */
      const typedScheduleTriggers = scheduleTriggers

      if (webhookTriggers.length > 0) {
        const whHost = (config.webhook && typeof config.webhook.host === 'string') ? config.webhook.host : '127.0.0.1'
        const whPort = (config.webhook && typeof config.webhook.port === 'number') ? config.webhook.port : 0
        webhookServer = createWebhookServer({
          config: config.webhook ?? {
            host: '127.0.0.1',
            port: 0,
            basePath: '',
            maxBodyBytes: 1024 * 1024,
            timeoutMs: 5000
          },
          triggers: typedWebhookTriggers,
          makeBotCtx: makeBotCtxUntyped,
          idempotency,
          pausePolicy,
          shutdownTracker,
          env: process.env,
          logger,
          onWebhook: (ctx, payload) => bot.config.handlers?.webhook?.(ctx, payload)
        })
        await webhookServer.start()
        logger.info('webhook server started', {
          meta: {
            trigger_count: webhookTriggers.length,
            host: whHost,
            port: webhookServer.getBoundPort() ?? whPort
          }
        })
      }

      if (scheduleTriggers.length > 0) {
        cronEngine = createCronEngine({
          config: config.cron ?? {
            timezone: 'UTC',
            catchUp: false
          },
          triggers: typedScheduleTriggers,
          makeBotCtx: makeBotCtxUntyped,
          idempotency,
          stateStore: storage,
          pausePolicy,
          shutdownTracker,
          logger,
          handlerTimeoutMs: config.handlerTimeoutMs,
          onSchedule: (ctx, payload) => bot.config.handlers?.schedule?.(ctx, payload)
        })
        await cronEngine.start()
        logger.info('cron engine started', {
          meta: {
            trigger_count: scheduleTriggers.length
          }
        })
      }

      isStarted = true

      if (capture) {
        await capture.prune().catch((err) => {
          logger.warn('diagnostics prune on boot failed', {
            meta: { error: err instanceof Error ? err.message : String(err) }
          })
        })
      }

      const baseCtx = await makeBotCtx({})
      if (typeof bot.config.handlers?.install === 'function') {
        await bot.config.handlers.install(baseCtx)
      }

      logger.info('runtime ready')
    } catch (bootErr) {
      if (cronEngine) {
        await cronEngine.stop().catch((e) => logger.error('error stopping cron engine during rollback', { meta: { error: e?.message ?? String(e) } }))
        cronEngine = null
      }
      if (webhookServer) {
        await webhookServer.stop().catch((e) => logger.error('error stopping webhook server during rollback', { meta: { error: e?.message ?? String(e) } }))
        webhookServer = null
      }
      if (ws) {
        await ws.close().catch((e) => logger.error('error closing websocket during rollback', { meta: { error: e?.message ?? String(e) } }))
      }
      if (storage) {
        await storage.close().catch((e) => logger.error('error closing storage during rollback', { meta: { error: e?.message ?? String(e) } }))
      }
      throw bootErr
    }
  }

  /**
   * Stops the runtime and drains in-flight operations.
   *
   * @param {object} [opts] - Options object.
   * @param {number} [opts.drainMs=30000] - The drain budget.
   * @returns {Promise<{ drained: boolean, remaining: number }>}
   */
  function stop ({ drainMs = 30000 } = {}) {
    if (!isStarted) {
      return Promise.resolve({
        drained: true,
        remaining: 0
      })
    }
    if (stopping) {
      return stopping
    }

    stopping = (async () => {
      // Signal dispatch sites to refuse new work.
      if (shutdownTracker) {
        shutdownTracker.startShutdown()
      }

      // Reconnect controller: stop scheduling reconnects.
      if (reconnectController) {
        await reconnectController.stop()
        reconnectController = null
      }

      // Uninstall handler: author cleanup with a live runtime.
      lifecycleController.abort()
      const baseCtx = await makeBotCtx({})
      if (typeof bot.config.handlers?.uninstall === 'function') {
        await bot.config.handlers.uninstall(baseCtx)
      }

      // Tear down room subscriptions (SSE first, then WebSocket channel unsubscribes are handled by ws.close below).
      for (const [roomId, entry] of Array.from(subscriptions.entries())) {
        if (entry.kind === 'sse') {
          await entry.close().catch((err) => {
            logger.warn('room unsubscribe failed during shutdown', {
              meta: {
                room_id: roomId,
                error: err instanceof Error ? err.message : String(err)
              }
            })
          })
        }
      }
      for (const [roomId, entry] of Array.from(subscriptions.entries())) {
        if (entry.kind === 'websocket') {
          await entry.close().catch((err) => {
            logger.warn('room unsubscribe failed during shutdown', {
              meta: {
                room_id: roomId,
                error: err instanceof Error ? err.message : String(err)
              }
            })
          })
        }
      }
      subscriptions.clear()

      // Stop trigger servers.
      if (cronEngine) {
        await cronEngine.stop()
        logger.info('cron engine stopped')
        cronEngine = null
      }

      if (webhookServer) {
        await webhookServer.stop()
        logger.info('webhook server stopped')
        webhookServer = null
      }

      // Close the WebSocket.
      if (ws) {
        await ws.close()
      }

      if (settingsStore) {
        settingsStore.stop()
        settingsStore = null
      }

      // Drain in-flight handlers.
      let result = {
        drained: true,
        remaining: 0
      }
      if (shutdownTracker) {
        result = await shutdownTracker.waitForAll(drainMs)
        if (!result.drained) {
          logger.warn('shutdown: drain timeout', { meta: { remaining: result.remaining } })
        }
      }

      if (capture) {
        await capture.close()
      }

      // Close storage (flushes the write queue).
      if (storage) {
        await storage.close()
      }

      isStarted = false
      stopping = null
      logger.info('runtime stopped')

      return result
    })()

    return stopping
  }

  return {
    start,
    stop,
    makeBotCtx,
    subscriptions,
    get shutdownTracker () {
      return shutdownTracker
    }
  }
}
