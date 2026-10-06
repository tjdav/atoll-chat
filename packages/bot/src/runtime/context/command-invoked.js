import crypto from 'node:crypto'
import { decrypt, encrypt, generateEphemeralKeypair } from '../crypto/command-result.js'

/**
 * The HKDF info string used when decrypting a command invocation.
 *
 * Assumed value. Spec §6.31 does not name the info string. The choice
 * mirrors the naming of `"bot-command-result-v1"` and
 * `"bot-settings-v1"`. When the server confirms the value, this
 * constant updates without any other change.
 */
export const COMMAND_INFO = 'bot-command-v1'

/**
 * @typedef {object} CommandInvokedEvent
 * @property {string} command_id - Server-assigned identifier.
 * @property {string} room_id - The room the command was invoked in.
 * @property {string} sender_user_id - The invoking user.
 * @property {string} sender_client_id - The invoking device.
 * @property {string} ciphertext - base64url command ciphertext.
 */

/**
 * @typedef {object} CommandInvocation
 * @property {string} commandId - Server-assigned identifier.
 * @property {string} roomId - The room the command was invoked in.
 * @property {string} senderUserId - The invoking user.
 * @property {string} senderClientId - The invoking device.
 * @property {string} commandName - Name of the invoked command.
 * @property {Record<string, unknown>} args - Parsed argument values.
 * @property {Uint8Array} ephemeralResultPubkey - 32 bytes ephemeral public key for result encryption.
 * @property {string} timestamp - ISO 8601, set at handler entry.
 */

/**
 * Creates the handler for `bot.command_invoked` events.
 *
 * The returned function decrypts the command, validates args, runs
 * the author's handler, dispatches the result, and acks the command.
 * It never throws; every failure path either dispatches an error
 * result or logs and acks.
 *
 * @param {object} deps - Factory dependencies.
 * @param {Uint8Array} deps.botCommandPrivateKey - The bot's 32-byte
 *   X25519 private scalar from the keystore (`bot_command_private`).
 * @param {Bot<any, any, any>} deps.bot - The bot's
 *   configuration handle from `defineBot`.
 * @param {import('../transport/http.js').HttpClient} deps.http - The
 *   HTTP client.
 * @param {(invocation: CommandInvocation) => Promise<BotCtx<any>>} deps.makeBotCtx -
 *   Constructs the BotCtx for a command invocation. Wired by B-029.
 * @param {import('../diagnostics/logger.js').Logger} [deps.logger] -
 *   Optional logger.
 * @param {number} [deps.handlerTimeoutMs=60000] - Per-handler timeout.
 * @param {() => string} [deps.generateRequestId=crypto.randomUUID] -
 *   Generates request ids. Parameterized for testing.
 * @param {() => { publicKey: Uint8Array, privateKey: Uint8Array }} [deps.generateEphemeral=generateEphemeralKeypair] -
 *   Generates ephemeral X25519 keypairs for result encryption.
 * @returns {(event: CommandInvokedEvent) => Promise<void>} The
 *   handler.
 */
export function createCommandInvocationHandler ({
  botCommandPrivateKey,
  bot,
  http,
  makeBotCtx,
  logger,
  handlerTimeoutMs = 60000,
  generateRequestId = crypto.randomUUID,
  generateEphemeral = generateEphemeralKeypair
}) {
  return async function onCommandInvoked (event) {
    const timestamp = new Date().toISOString()

    logger?.debug('command_invoked received', {
      meta: {
        command_id: event.command_id,
        room_id: event.room_id
      }
    })

    // Decrypt the ciphertext.
    let decrypted
    try {
      decrypted = decryptCommand(event.ciphertext, botCommandPrivateKey)
    } catch (_err) {
      logger?.warn('command decryption failed', {
        meta: {
          command_id: event.command_id
        }
      })
      await safeAck(http, event.command_id, logger)
      return
    }

    // Parse the plaintext.
    let parsed
    try {
      parsed = parseCommandPlaintext(decrypted)
    } catch (_err) {
      logger?.warn('command plaintext malformed', {
        meta: {
          command_id: event.command_id
        }
      })
      await safeAck(http, event.command_id, logger)
      return
    }

    const invocation = {
      commandId: event.command_id,
      roomId: event.room_id,
      senderUserId: event.sender_user_id,
      senderClientId: event.sender_client_id,
      commandName: parsed.command_name,
      args: parsed.args,
      ephemeralResultPubkey: parsed.ephemeral_result_pubkey,
      timestamp
    }

    // Look up the command declaration.
    const commandDecl = bot.config.commands?.[parsed.command_name]
    if (!commandDecl) {
      logger?.warn('unknown command invoked', {
        meta: {
          command_id: event.command_id,
          command_name: parsed.command_name
        }
      })
      /** @type {CommandResult} */
      const result = {
        type: 'local_message',
        content: `Unknown command: /${parsed.command_name}`
      }
      await safeDispatchResult({
        result,
        ephemeralResultPubkey: parsed.ephemeral_result_pubkey,
        roomId: event.room_id,
        http,
        generateRequestId,
        generateEphemeral,
        logger,
        invocation
      })
      await safeAck(http, event.command_id, logger)
      return
    }

    // Validate args.
    let argsReader
    try {
      argsReader = buildArgsReader(commandDecl.args ?? {}, parsed.args)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger?.warn('command args validation failed', {
        meta: {
          command_id: event.command_id,
          command_name: parsed.command_name,
          error: errorMsg
        }
      })
      /** @type {CommandResult} */
      const result = {
        type: 'local_message',
        content: `Invalid arguments for /${parsed.command_name}: ${errorMsg}`
      }
      await safeDispatchResult({
        result,
        ephemeralResultPubkey: parsed.ephemeral_result_pubkey,
        roomId: event.room_id,
        http,
        generateRequestId,
        generateEphemeral,
        logger,
        invocation
      })
      await safeAck(http, event.command_id, logger)
      return
    }

    // Construct the BotCtx.
    let ctx
    try {
      ctx = await makeBotCtx(invocation)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger?.error('makeBotCtx failed', {
        meta: {
          command_id: event.command_id,
          error: errorMsg
        }
      })
      await safeAck(http, event.command_id, logger)
      return
    }

    // Run the handler with a timeout.
    let result
    try {
      result = await withTimeout(
        Promise.resolve().then(() => commandDecl.handler(ctx, argsReader)),
        handlerTimeoutMs
      )
    } catch (err) {
      /** @type {any} */
      const errObj = err
      const errorMsg = err instanceof Error ? err.message : String(err)
      if (errObj.isTimeout) {
        result = {
          type: 'local_message',
          content: `Command /${parsed.command_name} timed out.`
        }
      } else {
        logger?.error('command handler threw', {
          meta: {
            command_id: event.command_id,
            error: errorMsg
          }
        })
        result = {
          type: 'local_message',
          content: `Command /${parsed.command_name} failed: ${errorMsg}`
        }
      }
    }

    // Dispatch the result.
    await safeDispatchResult({
      result,
      ephemeralResultPubkey: parsed.ephemeral_result_pubkey,
      roomId: event.room_id,
      http,
      ctx,
      generateRequestId,
      generateEphemeral,
      logger,
      invocation
    })

    // Ack the command.
    await safeAck(http, event.command_id, logger)
  }
}

/**
 * Dispatches a command result to the appropriate channel.
 *
 * - `local_message`, `toast`, `panel` → POST /bots/me/messages with
 *   `target: 'invoker'`.
 * - `room_message` → `ctx.post` on the invoking room.
 * - `none` → no-op.
 *
 * The `invoker` variants encrypt the content to the invoker's
 * ephemeral X25519 public key from the command payload, using the same
 * info string as command results (`"bot-command-result-v1"`).
 *
 * @param {object} params - Dispatch parameters.
 * @param {CommandResult} params.result - Command result object.
 * @param {Uint8Array} params.ephemeralResultPubkey - 32 bytes.
 * @param {string} params.roomId - The invoking room.
 * @param {import('../transport/http.js').HttpClient} params.http - HTTP client.
 * @param {BotCtx<any>} [params.ctx] - Used for
 *   `room_message` routing via `ctx.post`.
 * @param {() => string} [params.generateRequestId=crypto.randomUUID] - Function to generate request ids.
 * @param {() => { publicKey: Uint8Array, privateKey: Uint8Array }} [params.generateEphemeral=generateEphemeralKeypair] - Function to generate ephemeral keypairs.
 * @param {import('../diagnostics/logger.js').Logger} [params.logger] - Optional logger.
 * @returns {Promise<void>}
 */
export async function dispatchCommandResult (params) {
  if (!params || typeof params !== 'object' || !params.result || typeof params.result !== 'object') {
    throw new Error('result must be an object')
  }

  const {
    result,
    ephemeralResultPubkey,
    roomId,
    http,
    ctx,
    generateRequestId = crypto.randomUUID,
    generateEphemeral = generateEphemeralKeypair
  } = params

  switch (result.type) {
    case 'none':
      return
    case 'room_message': {
      if (!ctx || typeof ctx.post !== 'function') {
        throw new Error('ctx.post is required for room_message result dispatch')
      }
      /** @type {PostOptions} */
      const postOpts = {
        roomId,
        text: result.content
      }
      if (result.attachments !== undefined) {
        postOpts.attachments = result.attachments
      }
      if (result.replyTo !== undefined) {
        postOpts.replyTo = result.replyTo
      }
      await ctx.post(postOpts)
      break
    }
    case 'local_message':
    case 'toast':
    case 'panel': {
      const plaintext = Buffer.from(JSON.stringify({ content: result.content }), 'utf8')
      const ephemeral = generateEphemeral()
      const ciphertext = encrypt({
        privateKey: ephemeral.privateKey,
        peerPublicKey: ephemeralResultPubkey,
        info: 'bot-command-result-v1',
        plaintext
      })
      await http.request('POST', '/bots/me/messages', {
        body: {
          target: 'invoker',
          result_type: result.type,
          ciphertext: Buffer.from(ciphertext).toString('base64url'),
          bot_result_pubkey: Buffer.from(ephemeral.publicKey).toString('base64url'),
          request_id: generateRequestId()
        },
        retry: false
      })
      break
    }
    default: {
      /** @type {any} */
      const untypedResult = result
      throw new Error(`Unknown result type '${untypedResult.type}'`)
    }
  }
}

/**
 * Decrypts a base64url command ciphertext using the bot's private key.
 *
 * @param {string} base64urlCiphertext - Wire ciphertext string.
 * @param {Uint8Array} botCommandPrivateKey - 32-byte bot private key.
 * @returns {Uint8Array} Decrypted plaintext bytes.
 */
function decryptCommand (base64urlCiphertext, botCommandPrivateKey) {
  if (typeof base64urlCiphertext !== 'string' || base64urlCiphertext.length === 0) {
    throw new Error('ciphertext must be a non-empty string')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(base64urlCiphertext)) {
    throw new Error('ciphertext must be base64url encoded')
  }
  const wire = Buffer.from(base64urlCiphertext, 'base64url')
  if (wire.length < 60) {
    throw new Error('command wire too short')
  }
  const ephemeralPub = new Uint8Array(wire.subarray(0, 32))
  const inner = new Uint8Array(wire.subarray(32))
  return decrypt({
    privateKey: botCommandPrivateKey,
    peerPublicKey: ephemeralPub,
    info: COMMAND_INFO,
    ciphertext: inner
  })
}

/**
 * Parses decrypted command JSON bytes.
 *
 * @param {Uint8Array} bytes - Decrypted bytes.
 * @returns {{ command_name: string, args: Record<string, unknown>, ephemeral_result_pubkey: Uint8Array }} Parsed command.
 */
function parseCommandPlaintext (bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('plaintext is not a JSON object')
  }
  if (typeof parsed.command_name !== 'string' || parsed.command_name.length === 0) {
    throw new Error('plaintext.command_name is required')
  }
  if (!parsed.args || typeof parsed.args !== 'object' || Array.isArray(parsed.args)) {
    throw new Error('plaintext.args must be an object')
  }
  if (typeof parsed.ephemeral_result_pubkey !== 'string') {
    throw new Error('plaintext.ephemeral_result_pubkey is required')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(parsed.ephemeral_result_pubkey)) {
    throw new Error('plaintext.ephemeral_result_pubkey must be base64url')
  }
  const ephemeralResultPubkey = Buffer.from(parsed.ephemeral_result_pubkey, 'base64url')
  if (ephemeralResultPubkey.length !== 32) {
    throw new Error('plaintext.ephemeral_result_pubkey must decode to 32 bytes')
  }
  return {
    command_name: parsed.command_name,
    args: parsed.args,
    ephemeral_result_pubkey: new Uint8Array(ephemeralResultPubkey)
  }
}

/**
 * Builds an ArgsReader while validating argument values against declarations.
 *
 * @param {Record<string, ArgDecl>} argDecls - Argument declarations.
 * @param {Record<string, unknown>} values - Argument values from invocation.
 * @returns {ArgsReader<any>} An ArgsReader object.
 */
function buildArgsReader (argDecls, values) {
  for (const [name, decl] of Object.entries(argDecls)) {
    const value = values[name]
    if (value === undefined) {
      if (decl.required === true) {
        throw new Error(`missing required argument '${name}'`)
      }
      continue
    }
    switch (decl.type) {
      case 'string':
        if (typeof value !== 'string') {
          throw new Error(`argument '${name}' must be a string`)
        }
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(`argument '${name}' must be a finite number`)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`argument '${name}' must be a boolean`)
        }
        break
      case 'select':
        if (typeof value !== 'string') {
          throw new Error(`argument '${name}' must be a string`)
        }
        if (Array.isArray(decl.options) && decl.options.length > 0 && !decl.options.includes(value)) {
          throw new Error(`argument '${name}' must be one of: ${decl.options.join(', ')}`)
        }
        break
      default:
        throw new Error(`argument '${name}' has unknown type '${decl.type}'`)
    }
  }

  for (const name of Object.keys(values)) {
    if (!(name in argDecls)) {
      throw new Error(`unknown argument '${name}'`)
    }
  }

  return {
    get (name) {
      /** @type {any} */
      const val = values[name]
      return val
    }
  }
}

/**
 * Dispatches command result while swallowing exceptions.
 *
 * @param {object} params - Dispatch parameters.
 * @param {CommandResult} [params.result] - Result object.
 * @param {Uint8Array} [params.ephemeralResultPubkey] - Ephemeral result pubkey.
 * @param {string} [params.roomId] - Room id.
 * @param {import('../transport/http.js').HttpClient} [params.http] - Http client.
 * @param {BotCtx<any>} [params.ctx] - BotCtx instance.
 * @param {() => string} [params.generateRequestId] - ID generator.
 * @param {() => { publicKey: Uint8Array, privateKey: Uint8Array }} [params.generateEphemeral] - Keypair generator.
 * @param {import('../diagnostics/logger.js').Logger} [params.logger] - Logger.
 * @param {CommandInvocation} [params.invocation] - Command invocation details.
 * @returns {Promise<void>}
 */
async function safeDispatchResult (params) {
  try {
    /** @type {any} */
    const dispatchParams = params
    await dispatchCommandResult(dispatchParams)
    params.logger?.debug('command result dispatched', {
      meta: {
        command_id: params.invocation?.commandId,
        result_type: params.result?.type
      }
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    params.logger?.error('failed to dispatch command result', {
      meta: {
        command_id: params.invocation?.commandId,
        error: errorMsg
      }
    })
  }
}

/**
 * Acknowledges a command with the server while swallowing failures.
 *
 * @param {import('../transport/http.js').HttpClient} http - HTTP client.
 * @param {string} commandId - Server assigned command id.
 * @param {import('../diagnostics/logger.js').Logger} [logger] - Optional logger.
 * @returns {Promise<void>}
 */
async function safeAck (http, commandId, logger) {
  try {
    await http.request('POST', `/bots/me/commands/${encodeURIComponent(commandId)}/ack`, {
      retry: false
    })
  } catch (_err) {
    logger?.warn('command ack failed', { meta: { command_id: commandId } })
  }
}

/**
 * Wraps a promise with a timeout deadline.
 *
 * @template T
 * @param {Promise<T>} promise - The promise to await.
 * @param {number} ms - Timeout in milliseconds.
 * @returns {Promise<T>} Resolves or rejects with timeout error.
 */
function withTimeout (promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`handler timed out after ${ms}ms`)
      /** @type {any} */
      const errorObj = err
      errorObj.isTimeout = true
      reject(err)
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}
