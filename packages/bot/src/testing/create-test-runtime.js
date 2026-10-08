import crypto from 'node:crypto'
import { createMockServer } from './mock-server.js'
import { createHttpClient } from '../runtime/transport/http.js'
import { PublisherKeyCache } from '../runtime/crypto/publisher.js'
import { createPostHandler } from '../runtime/context/post.js'
import { createReplyHandler } from '../runtime/context/reply.js'
import { createSendLocalHandler } from '../runtime/context/send-local.js'
import { createFetchMethods } from '../runtime/context/fetch.js'
import { createCommandInvocationHandler, COMMAND_INFO } from '../runtime/context/command-invoked.js'
import { parseCron, nextFireTime } from '../runtime/triggers/cron.js'
import { generateEphemeralKeypair, encrypt, keyObjectFromX25519Private } from '../runtime/crypto/command-result.js'
import { sign, keyObjectFromSeed, encodePublisherKeyPayload } from '../runtime/crypto/signing.js'

/**
 * @typedef {object} TestRuntime
 * @property {(event: { type: string, payload?: any }) => Promise<{ ok: boolean, error?: Error }>} inject
 * @property {(payload: { path: string, body: string, headers?: Record<string, string> }) => Promise<void>} dispatchWebhook
 * @property {(name: string) => Promise<void>} fireSchedule
 * @property {(ms: number) => Promise<void>} advanceTime
 * @property {() => Promise<void>} restart
 * @property {(path: string, response: { status?: number, body?: unknown, headers?: Record<string, string> }, method?: string) => void} simulateResponse
 * @property {import('./mock-server.js').RecordedRequest[]} calls
 * @property {() => []} getPendingOutbound
 * @property {() => Map<string, { roomId: string, mode: string, scopes: string[] }>} getGrants
 * @property {() => Map<string, { epoch: number, publisherPublicKey: Uint8Array }>} getPublisherKeys
 * @property {() => Promise<void>} close
 */

/**
 * Generates an Ed25519 keypair.
 *
 * @returns {{ privateKey: Uint8Array, publicKey: Uint8Array }} The private seed and public key.
 */
function generateEd25519Keypair () {
  const seed = new Uint8Array(crypto.randomBytes(32))
  const keyObj = keyObjectFromSeed(seed)
  const pubKeyObj = crypto.createPublicKey(keyObj)
  const spki = pubKeyObj.export({ type: 'spki', format: 'der' })
  const pubKey = new Uint8Array(spki.subarray(12))
  return { privateKey: seed, publicKey: pubKey }
}

/**
 * Creates a test runtime for a bot.
 *
 * The runtime runs the bot's handlers through the real dispatch path
 * against a mock server. HTTP requests are recorded by the mock;
 * WebSocket events are injected via `inject`; schedule fires are
 * triggered by `advanceTime`. No real network, crypto, or clock is
 * used beyond what the mock server and the caller provide.
 *
 * @param {any} bot - The bot handle from `defineBot`.
 * @param {object} [options]
 * @param {{ roomId: string, mode: 'write_only' | 'observer' | 'member',
 *   scopes: string[] }[]} [options.grants=[]] - Initial grants.
 * @param {Record<string, any>} [options.keystoreData] - A synthetic keystore plaintext.
 * @param {{ validateCrypto?: boolean }} [options.options] - Mock server options.
 * @param {string} [options.botId='b_test'] - The bot id the mock reports.
 * @param {string} [options.ownerUserId='u_test'] - The owner id.
 * @param {Uint8Array} [options.botIdentityPubkey] - The bot's Ed25519 public key.
 * @param {any[]} [options.roomsList=[]] - The rooms `ctx.rooms.list()` returns.
 * @param {Record<string, unknown>} [options.settings={}] - Initial settings.
 * @param {Record<string, unknown>} [options.storage={}] - Initial storage values.
 * @param {any} [options.fetchImpl] - Fetch implementation.
 * @returns {Promise<TestRuntime>}
 */
export async function createTestRuntime (bot, options = {}) {
  const botId = options.botId ?? 'b_test'
  const ownerUserId = options.ownerUserId ?? 'u_test'

  // Synthetic or caller-provided keystore data
  const keystoreData = options.keystoreData ?? {
    bot_id: botId,
    bot_token: 'test-bot-token',
    bot_identity_private: Buffer.alloc(32, 0x11).toString('base64url'),
    bot_command_private: Buffer.alloc(32, 0x22).toString('base64url'),
    identity_private: Buffer.alloc(32, 0x33).toString('base64url'),
    storage_seed: Buffer.alloc(32, 0x44).toString('base64url'),
    created_at: new Date(0).toISOString(),
    rotated_at: new Date(0).toISOString()
  }

  // Derive Ed25519 public key if not explicitly passed
  let botIdentityPubkey = options.botIdentityPubkey
  if (!botIdentityPubkey && keystoreData.bot_identity_private) {
    const seed = Buffer.from(keystoreData.bot_identity_private, 'base64url')
    const keyObj = keyObjectFromSeed(seed)
    const pubKeyObj = crypto.createPublicKey(keyObj)
    const spki = pubKeyObj.export({ type: 'spki', format: 'der' })
    botIdentityPubkey = new Uint8Array(spki.subarray(12))
  }

  // Start mock server
  const mockServerOptions = {
    ...options.options,
    botId,
    ownerUserId,
    botIdentityPubkey
  }
  const mockServer = await createMockServer(mockServerOptions)
  const recordedRequests = mockServer.requests

  // In-memory state
  const grants = new Map()
  if (Array.isArray(options.grants)) {
    for (const g of options.grants) {
      if (g && typeof g.roomId === 'string') {
        grants.set(g.roomId, {
          roomId: g.roomId,
          mode: g.mode,
          scopes: Array.isArray(g.scopes) ? [...g.scopes] : []
        })
      }
    }
  }

  const settings = new Map(Object.entries(options.settings ?? {}))
  const storage = new Map(Object.entries(options.storage ?? {}))
  const roomsList = Array.isArray(options.roomsList) ? [...options.roomsList] : []

  // Simulated clock
  const initialNowMs = Date.now()
  let nowMs = initialNowMs

  // Synthetic signer keypair for publisher key signatures
  const signerKeypair = generateEd25519Keypair()
  const signerUserId = 'u_signer'
  mockServer.setResponse('GET', '/api/v1/kt/user/u_signer', {
    body: {
      user_id: signerUserId,
      identity_pubkey: Buffer.from(signerKeypair.publicKey).toString('base64url')
    }
  })

  // Publisher keys map and cache
  const publisherKeys = new Map()
  const publisherKeyCache = new PublisherKeyCache({
    lookupSignerPubkey: async (uid) => {
      if (uid === signerUserId) {
        return signerKeypair.publicKey
      }
      return null
    },
    now: () => nowMs
  })

  // Owner X25519 keypair for sendLocal
  const ownerEphemeral = generateEphemeralKeypair()

  // Initialize publisher keys for initial grants
  for (const roomId of grants.keys()) {
    const ephem = generateEphemeralKeypair()
    const epoch = 1
    publisherKeys.set(roomId, {
      epoch,
      publisherPublicKey: ephem.publicKey
    })

    const payload = encodePublisherKeyPayload({
      roomId,
      epoch,
      publisherPublicKey: ephem.publicKey
    })
    const signature = sign(payload, signerKeypair.privateKey)

    await publisherKeyCache.recordPublication({
      roomId,
      epoch,
      publisherPublicKey: ephem.publicKey,
      signerUserId,
      signature
    })
  }

  // HTTP Client
  const http = createHttpClient({
    serverUrl: `${mockServer.getUrl()}/api/v1`,
    botToken: String(keystoreData.bot_token),
    backoffMs: [10, 10, 10],
    defaultTimeoutMs: 1000,
    fetchImpl: options.fetchImpl ?? globalThis.fetch
  })

  // Derived Bot Command Public Key
  const botCommandPrivBytes = Buffer.from(String(keystoreData.bot_command_private), 'base64url')
  const botCommandPrivKo = keyObjectFromX25519Private(botCommandPrivBytes)
  const botCommandPubKo = crypto.createPublicKey(botCommandPrivKo)
  const botCommandSpki = botCommandPubKo.export({ type: 'spki', format: 'der' })
  const botCommandPublicKey = new Uint8Array(botCommandSpki.subarray(12))

  // In-memory Stores
  /** @type {any} */
  const settingsStore = {
    /**
     * @param {string} key - Key.
     * @param {any} [opts] - Options.
     * @returns {Promise<any>}
     */
    async get (key, opts) {
      const roomId = typeof opts?.room === 'string' ? opts.room : opts?.room?.id
      const storageKey = roomId ? `room:${roomId}:${key}` : key
      return settings.get(storageKey)
    },
    /**
     * @param {string} key - Key.
     * @param {any} value - Value.
     * @param {any} [opts] - Options.
     * @returns {Promise<void>}
     */
    async set (key, value, opts) {
      const roomId = typeof opts?.room === 'string' ? opts.room : opts?.room?.id
      const storageKey = roomId ? `room:${roomId}:${key}` : key
      settings.set(storageKey, value)
    },
    /**
     * @param {string} key - Key.
     * @param {any} [opts] - Options.
     * @returns {Promise<void>}
     */
    async delete (key, opts) {
      const roomId = typeof opts?.room === 'string' ? opts.room : opts?.room?.id
      const storageKey = roomId ? `room:${roomId}:${key}` : key
      settings.delete(storageKey)
    },
    subscribe () {
      return () => {}
    }
  }

  /** @type {any} */
  const storageStore = {
    /**
     * @param {string} key - Key.
     * @returns {Promise<any>}
     */
    async get (key) {
      return storage.get(key)
    },
    /**
     * @param {string} key - Key.
     * @param {any} value - Value.
     * @returns {Promise<void>}
     */
    async set (key, value) {
      storage.set(key, value)
    },
    /**
     * @param {string} key - Key.
     * @returns {Promise<void>}
     */
    async delete (key) {
      storage.delete(key)
    },
    async clear () {
      storage.clear()
    }
  }

  /** @type {any} */
  const roomsStore = {
    async list () {
      return [...roomsList]
    },
    /**
     * @param {string} roomId - Room ID.
     * @returns {Promise<any>}
     */
    async get (roomId) {
      if (typeof roomId !== 'string') {
        return null
      }
      return roomsList.find((r) => r.id === roomId) ?? null
    }
  }

  // Real Handler Factories
  /** @type {(opts: any, ctx: any) => Promise<any>} */
  let postHandler
  /** @type {(opts: any, ctx: any) => Promise<any>} */
  let replyHandler
  /** @type {(opts: any) => Promise<void>} */
  let sendLocalHandler
  /** @type {{ fetch: (url: string, opts?: any) => Promise<Response>, fetchUserUrl: (url: string, opts?: any) => Promise<Response> }} */
  let fetchMethods
  /** @type {(event: any) => Promise<void>} */
  let commandInvocationHandler

  function buildHandlers () {
    const botIdentityPrivateKey = Buffer.from(String(keystoreData.bot_identity_private), 'base64url')

    postHandler = createPostHandler({
      http,
      publisherKeys: publisherKeyCache,
      botIdentityPrivateKey
    })

    replyHandler = createReplyHandler({
      post: postHandler
    })

    sendLocalHandler = createSendLocalHandler({
      http,
      getOwnerPubkey: async () => ownerEphemeral.publicKey
    })

    const defaultFetch = options.fetchImpl ?? globalThis.fetch
    /** @type {any} */
    const customFetch = async (/** @type {any} */ url, /** @type {any} */ opts) => {
      let targetUrl = typeof url === 'string' ? url : String(url)
      if (typeof url === 'string') {
        try {
          const u = new URL(url)
          if (u.hostname === 'mock' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
            const mockUrl = new URL(mockServer.getUrl())
            u.protocol = mockUrl.protocol
            u.hostname = mockUrl.hostname
            u.port = mockUrl.port
            targetUrl = u.toString()
          }
        } catch {
          if (url.startsWith('/')) {
            targetUrl = `${mockServer.getUrl()}${url}`
          }
        }
      }
      return defaultFetch(targetUrl, opts)
    }

    fetchMethods = createFetchMethods({
      fetchImpl: customFetch
    })

    commandInvocationHandler = createCommandInvocationHandler({
      botCommandPrivateKey: botCommandPrivBytes,
      bot,
      http,
      makeBotCtx: (invocation) => makeBotCtx(invocation)
    })
  }

  buildHandlers()

  /**
   * Internal BotCtx Constructor.
   *
   * @param {any} [invocation] - Invocation context.
   * @returns {any} BotCtx object.
   */
  function makeBotCtx (invocation) {
    const roomId = invocation?.roomId
    const grant = roomId ? grants.get(roomId) ?? null : null
    const room = roomId ? roomsList.find((r) => r.id === roomId) ?? null : null
    const signal = invocation?.signal ?? new AbortController().signal

    /** @type {any} */
    const ctx = {
      bot: {
        id: botId,
        label: bot.config.label,
        ownerUserId,
        avatar: { fileId: null, emoji: bot.config.avatar?.emoji ?? null }
      },
      grant,
      room,
      event: invocation?.event ?? null,
      settings: settingsStore,
      storage: storageStore,
      rooms: roomsStore,
      log: () => {},
      fetch: fetchMethods.fetch,
      fetchUserUrl: fetchMethods.fetchUserUrl,
      signal,
      uploadAvatar: async () => {
        throw new Error('uploadAvatar is not yet implemented')
      }
    }

    /** @param {any} opts */
    ctx.post = (opts) => postHandler(opts, ctx)
    /** @param {any} opts */
    ctx.reply = (opts) => replyHandler(opts, ctx)
    /** @param {any} opts */
    ctx.sendLocal = (opts) => sendLocalHandler(opts)

    return ctx
  }

  // Schedule Triggers State
  /** @type {Map<string, { trigger: any, nextFireAt: number }>} */
  const scheduleState = new Map()

  function initScheduleState () {
    scheduleState.clear()
    const triggers = Array.isArray(bot.config?.triggers) ? bot.config.triggers : []
    const defaultTz = bot.config?.timezone ?? 'UTC'

    for (const t of triggers) {
      if (t && t.type === 'schedule' && typeof t.name === 'string' && typeof t.cron === 'string') {
        try {
          const parsed = parseCron(t.cron)
          const tz = t.timezone ?? defaultTz
          const nextDate = nextFireTime(parsed, new Date(nowMs), tz)
          scheduleState.set(t.name, {
            trigger: t,
            nextFireAt: nextDate.getTime()
          })
        } catch (_err) {
          // Ignore invalid schedule triggers during construction
        }
      }
    }
  }

  initScheduleState()

  // TestRuntime object
  /** @type {TestRuntime} */
  const runtime = {
    async inject (event) {
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
        return { ok: false, error: new Error('Invalid event') }
      }

      try {
        switch (event.type) {
          case 'command': {
            const payload = event.payload ?? {}
            const senderEphemeral = generateEphemeralKeypair()
            const resultEphemeral = generateEphemeralKeypair()

            const plaintextObj = {
              command_name: payload.commandName,
              args: payload.args ?? {},
              ephemeral_result_pubkey: Buffer.from(resultEphemeral.publicKey).toString('base64url')
            }
            const plaintextBytes = Buffer.from(JSON.stringify(plaintextObj), 'utf8')

            const innerCiphertext = encrypt({
              privateKey: senderEphemeral.privateKey,
              peerPublicKey: botCommandPublicKey,
              info: COMMAND_INFO,
              plaintext: plaintextBytes
            })

            const wire = Buffer.concat([senderEphemeral.publicKey, innerCiphertext])
            const ciphertext = wire.toString('base64url')

            await commandInvocationHandler({
              command_id: payload.commandId ?? 'cmd_1',
              room_id: payload.roomId ?? 'r_test',
              sender_user_id: payload.senderUserId ?? 'u_test',
              sender_client_id: payload.senderClientId ?? 'c_test',
              ciphertext
            })
            return { ok: true }
          }
          case 'message': {
            const payload = event.payload ?? {}
            const roomId = payload.roomId
            const handler = bot.config.handlers?.message
            if (typeof handler === 'function') {
              const ctx = makeBotCtx({
                roomId,
                event: {
                  id: payload.data?.id ?? 'evt_msg_1',
                  type: 'message',
                  roomId,
                  timestamp: new Date(nowMs).toISOString()
                }
              })
              await handler(ctx, payload)
            }
            return { ok: true }
          }
          case 'room': {
            const payload = event.payload ?? {}
            const roomId = payload.roomId
            const handler = bot.config.handlers?.room
            if (typeof handler === 'function') {
              const ctx = makeBotCtx({
                roomId,
                event: {
                  id: payload.data?.id ?? 'evt_room_1',
                  type: 'room',
                  roomId,
                  timestamp: new Date(nowMs).toISOString()
                }
              })
              await handler(ctx, payload)
            }
            return { ok: true }
          }
          case 'grant_updated': {
            const payload = event.payload ?? {}
            if (typeof payload.roomId === 'string') {
              if (payload.newMode) {
                grants.set(payload.roomId, {
                  roomId: payload.roomId,
                  mode: payload.newMode,
                  scopes: Array.isArray(payload.scopes) ? [...payload.scopes] : []
                })
              } else {
                grants.delete(payload.roomId)
              }
            }
            const handler = bot.config.handlers?.grantUpdated
            if (typeof handler === 'function') {
              const ctx = makeBotCtx({
                roomId: payload.roomId,
                event: {
                  id: 'evt_grant_1',
                  type: 'grant_updated',
                  roomId: payload.roomId,
                  timestamp: new Date(nowMs).toISOString()
                }
              })
              await handler(ctx, payload)
            }
            return { ok: true }
          }
          default:
            return { ok: false, error: new Error(`Unknown event type '${event.type}'`) }
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) }
      }
    },

    async dispatchWebhook (payload) {
      const handler = bot.config.handlers?.webhook
      if (typeof handler !== 'function') {
        return
      }
      const ctx = makeBotCtx({ roomId: null })
      await handler(ctx, {
        path: payload.path,
        body: payload.body,
        headers: payload.headers ?? {}
      })
    },

    async fireSchedule (name) {
      const triggers = Array.isArray(bot.config?.triggers) ? bot.config.triggers : []
      const trigger = triggers.find((/** @type {any} */ t) => t && t.type === 'schedule' && t.name === name)
      if (!trigger) {
        throw new Error(`Schedule trigger '${name}' not found`)
      }
      const handler = bot.config.handlers?.schedule
      if (typeof handler !== 'function') {
        return
      }
      const ctx = makeBotCtx({ roomId: null })
      await handler(ctx, { name })
    },

    async advanceTime (ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
        throw new TypeError('advanceTime requires a non-negative finite number')
      }

      const targetMs = nowMs + ms
      const handler = bot.config.handlers?.schedule
      const defaultTz = bot.config?.timezone ?? 'UTC'

      while (true) {
        // Find trigger with the earliest nextFireAt <= targetMs
        let earliestName = null
        let earliestFireAt = Infinity
        let earliestTrigger = null

        for (const [name, state] of scheduleState.entries()) {
          if (state.nextFireAt <= targetMs && state.nextFireAt < earliestFireAt) {
            earliestName = name
            earliestFireAt = state.nextFireAt
            earliestTrigger = state.trigger
          }
        }

        if (earliestName === null || earliestTrigger === null) {
          break
        }

        nowMs = earliestFireAt

        if (typeof handler === 'function') {
          const ctx = makeBotCtx({ roomId: null })
          try {
            await handler(ctx, { name: earliestName })
          } catch (_err) {
            // Catch handler throw matching cron engine behavior; clock still advances
          }
        }

        // Advance nextFireAt for earliestTrigger
        try {
          const parsed = parseCron(earliestTrigger.cron)
          const tz = earliestTrigger.timezone ?? defaultTz
          const nextDate = nextFireTime(parsed, new Date(nowMs), tz)
          const stateEntry = scheduleState.get(earliestName)
          if (stateEntry) {
            stateEntry.nextFireAt = nextDate.getTime()
          }
        } catch (_err) {
          scheduleState.delete(earliestName)
        }
      }

      nowMs = targetMs
    },

    async restart () {
      nowMs = initialNowMs
      buildHandlers()
      initScheduleState()
    },

    simulateResponse (path, response, method = '*') {
      const ms = /** @type {any} */ (mockServer)
      if (!ms) {
        return
      }
      const normalizedPath = path.startsWith('/') ? path : '/' + path
      const paths = [normalizedPath]
      if (!normalizedPath.startsWith('/api/v1/')) {
        paths.push('/api/v1' + normalizedPath)
      }
      const methods = method === '*' ? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] : [method]
      for (const p of paths) {
        for (const m of methods) {
          ms.setResponse(m, p, response)
        }
      }
    },

    get calls () {
      return recordedRequests
    },

    getPendingOutbound () {
      // B-031 flagged that the outbound queue is an architectural vestige; returns [].
      return []
    },

    getGrants () {
      return grants
    },

    getPublisherKeys () {
      return publisherKeys
    },

    async close () {
      const ms = /** @type {any} */ (mockServer)
      if (ms && typeof ms.close === 'function') {
        await ms.close()
      }
    }
  }

  return runtime
}
