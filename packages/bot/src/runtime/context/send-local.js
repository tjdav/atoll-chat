import crypto from 'node:crypto'
import { SendLocalFailedError, HttpRequestError } from '../../errors.js'
import { encrypt, generateEphemeralKeypair } from '../crypto/command-result.js'

/**
 * Creates the `ctx.sendLocal` handler.
 *
 * `ctx.sendLocal` encrypts a short text message to the bot's owner's
 * X25519 public key and posts it via `POST /bots/me/messages` with
 * `target: "owner"` and `result_type: "local_message"`. The message is
 * visible only to the owner.
 *
 * Best-effort: the handler does not retry 5xx failures. If the owner
 * is offline, the message is lost. Callers that need guaranteed
 * delivery should use `ctx.reply` in a room.
 *
 * @param {object} deps - Factory dependencies.
 * @param {import('../transport/http.js').HttpClient} deps.http - The HTTP client.
 * @param {() => Promise<Uint8Array>} deps.getOwnerPubkey - Resolves the owner's 32-byte X25519 public key.
 * @param {import('../diagnostics/logger.js').Logger} [deps.logger] - Optional logger.
 * @param {() => string} [deps.generateRequestId=crypto.randomUUID] - Generates a fresh `request_id` per call.
 * @param {() => { publicKey: Uint8Array, privateKey: Uint8Array }} [deps.generateEphemeral=generateEphemeralKeypair] - The ephemeral X25519 keypair generator.
 * @returns {(opts: LocalOptions) => Promise<void>} The handler.
 */
export function createSendLocalHandler ({
  http,
  getOwnerPubkey,
  logger,
  generateRequestId = crypto.randomUUID,
  generateEphemeral = generateEphemeralKeypair
}) {
  return async function sendLocal (opts) {
    const startTime = Date.now()

    if (!opts || typeof opts.text !== 'string') {
      const reason = 'ctx.sendLocal requires opts.text to be a string'
      if (logger?.warn) {
        logger.warn('ctx.sendLocal validation failed', { reason })
      }
      throw new SendLocalFailedError(reason)
    }

    const format = opts.format ?? 'text'
    if (format !== 'text' && format !== 'markdown') {
      const reason = `ctx.sendLocal: opts.format must be 'text' or 'markdown', got ${JSON.stringify(opts.format)}`
      if (logger?.warn) {
        logger.warn('ctx.sendLocal validation failed', { reason })
      }
      throw new SendLocalFailedError(reason)
    }

    if (logger?.debug) {
      logger.debug('ctx.sendLocal started', {
        format,
        text_length: opts.text.length
      })
    }

    let ownerPublicKey
    try {
      ownerPublicKey = await getOwnerPubkey()
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err))
      const error = new SendLocalFailedError('ctx.sendLocal: could not resolve owner public key', { cause })
      if (logger?.error) {
        logger.error('ctx.sendLocal public key resolution failed', { code: error.code })
      }
      throw error
    }

    if (!(ownerPublicKey instanceof Uint8Array) || ownerPublicKey.length !== 32) {
      const error = new SendLocalFailedError('ctx.sendLocal: owner public key is not 32 bytes')
      if (logger?.error) {
        logger.error('ctx.sendLocal public key validation failed', { code: error.code })
      }
      throw error
    }

    const plaintextObject = {
      text: opts.text,
      format
    }
    const plaintextBytes = Buffer.from(JSON.stringify(plaintextObject), 'utf8')

    const ephemeral = generateEphemeral()

    const ciphertext = encrypt({
      privateKey: ephemeral.privateKey,
      peerPublicKey: ownerPublicKey,
      info: 'bot-command-result-v1',
      plaintext: plaintextBytes
    })

    const requestId = generateRequestId()
    const body = {
      target: 'owner',
      result_type: 'local_message',
      ciphertext: Buffer.from(ciphertext).toString('base64url'),
      bot_result_pubkey: Buffer.from(ephemeral.publicKey).toString('base64url'),
      request_id: requestId
    }

    try {
      await http.request('POST', '/bots/me/messages', {
        body,
        retry: false
      })
    } catch (err) {
      if (err instanceof HttpRequestError) {
        if (logger?.error) {
          logger.error('ctx.sendLocal transport failed', {
            status: err.status,
            code: 'send_local_failed'
          })
        }
        throw new SendLocalFailedError(
          `ctx.sendLocal failed: ${err.message}`,
          { cause: err }
        )
      }
      throw err
    }

    if (logger?.debug) {
      logger.debug('ctx.sendLocal succeeded', {
        duration_ms: Date.now() - startTime
      })
    }
  }
}
