import crypto from 'node:crypto'
import { PostFailedError, HttpRequestError } from '../../errors.js'
import { encrypt, generateEphemeralKeypair } from '../crypto/command-result.js'
import { sign, encodeBotMessagePayload } from '../crypto/signing.js'

/**
 * The HKDF info string used when encrypting to a room's publisher key.
 * Spec §6.1 step 4.
 */
export const PUBLISHER_MESSAGE_INFO = 'publisher-message-v1'

/**
 * Generates a fresh `request_id` for a bot message. The default
 * implementation uses `crypto.randomUUID()`, which produces a v4 UUID.
 *
 * @returns {string} - A fresh id.
 */
export function generateRequestId () {
  return crypto.randomUUID()
}

/**
 * Creates the `ctx.post` handler.
 *
 * The returned function posts a message to a room by encrypting it to
 * the room's publisher key and signing the ciphertext with the bot's
 * Ed25519 identity key.
 *
 * Only `write_only` and `observer` modes are supported. In `member`
 * mode, the function throws `PostFailedError` with reason
 * `member_mode_requires_mls` — the bot runtime does not currently
 * implement MLS.
 *
 * @param {object} deps - The dependencies object.
 * @param {import('../transport/http.js').HttpClient} deps.http - The HTTP client.
 * @param {import('../crypto/publisher.js').PublisherKeyCache} deps.publisherKeys - The publisher key cache.
 * @param {Uint8Array} deps.botIdentityPrivateKey - The bot's 32-byte Ed25519 identity seed from the keystore (`bot_identity_private`).
 * @param {import('../diagnostics/logger.js').Logger} [deps.logger] - Optional logger.
 * @param {() => string} [deps.generateRequestId=generateRequestId] - Generates a fresh `request_id` per call. Parameterized for testing.
 * @param {() => { publicKey: Uint8Array, privateKey: Uint8Array }} [deps.generateEphemeral=generateEphemeralKeypair] - The ephemeral X25519 keypair generator. Parameterized for testing.
 * @returns {(opts: PostOptions, ctx: { grant: { roomId: string, mode: string } | null }) => Promise<MessageRef>} - The handler.
 */
export function createPostHandler ({
  http,
  publisherKeys,
  botIdentityPrivateKey,
  logger,
  generateRequestId: genReqId = generateRequestId,
  generateEphemeral = generateEphemeralKeypair
}) {
  return async function post (opts, ctx) {
    const roomId = opts?.roomId ?? ctx?.grant?.roomId
    if (!roomId) {
      const cause = new TypeError('no room id: opts.roomId is unset and the invocation has no room grant')
      throw new PostFailedError(cause.message, { cause })
    }

    const mode = ctx?.grant?.mode
    if (mode === 'member') {
      if (logger) {
        logger.warn('member mode rejected', { room_id: roomId })
      }
      const cause = new PostFailedError('member_mode_requires_mls', {
        cause: new Error('member mode requires MLS, which the bot runtime does not implement')
      })
      throw new PostFailedError('member mode requires MLS, which the bot runtime does not implement', { cause })
    }

    if (logger) {
      logger.debug('ctx.post called', {
        meta: {
          room_id: roomId,
          has_text: Boolean(opts?.text),
          attachment_count: Array.isArray(opts?.attachments) ? opts.attachments.length : 0,
          reply_to: Boolean(opts?.replyTo)
        }
      })
    }

    const epoch = publisherKeys.getCurrentEpoch(roomId)
    if (epoch === undefined) {
      const cause = new Error(`no current epoch for room ${roomId}`)
      throw new PostFailedError('no publisher key for this room', { cause })
    }

    let publisherPublicKey
    try {
      publisherPublicKey = await publisherKeys.getPublisherKey(roomId, epoch)
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err))
      throw new PostFailedError(`no publisher key for this room: ${cause.message}`, {
        cause
      })
    }

    const plaintextObject = {
      text: opts?.text ?? null,
      attachments: opts?.attachments ?? null,
      reply_to: opts?.replyTo ?? null
    }
    const plaintextBytes = Buffer.from(JSON.stringify(plaintextObject), 'utf8')

    const ephemeral = generateEphemeral()

    const inner = encrypt({
      privateKey: ephemeral.privateKey,
      peerPublicKey: publisherPublicKey,
      info: PUBLISHER_MESSAGE_INFO,
      plaintext: plaintextBytes
    })

    const ciphertext = Buffer.concat([ephemeral.publicKey, inner])

    const signingPayload = encodeBotMessagePayload({
      roomId,
      epoch,
      contentType: 'bot',
      ciphertext
    })

    const signature = sign(signingPayload, botIdentityPrivateKey)

    const requestId = genReqId()
    /** @type {Record<string, any>} */
    const body = {
      epoch,
      ciphertext: Buffer.from(ciphertext).toString('base64url'),
      content_type: 'bot',
      signature: Buffer.from(signature).toString('base64url'),
      request_id: requestId
    }
    if (opts?.replyTo) {
      body.reply_to = opts.replyTo
    }

    const startMs = Date.now()
    let response
    try {
      response = await http.request('POST', `/rooms/${encodeURIComponent(roomId)}/bot-messages`, {
        body,
        retry: true
      })
    } catch (err) {
      if (logger) {
        logger.error('post HTTP request failed', {
          meta: {
            room_id: roomId,
            status: err instanceof HttpRequestError ? err.status : undefined
          }
        })
      }
      if (err instanceof HttpRequestError) {
        throw new PostFailedError(`post failed: ${err.message}`, { cause: err })
      }
      throw err
    }

    const durationMs = Date.now() - startMs

    /** @type {any} */
    const responseBody = response.body
    if (!responseBody || typeof responseBody !== 'object' || typeof responseBody.id !== 'string') {
      const cause = new TypeError('server response did not include a valid string id')
      throw new PostFailedError('post succeeded but the server response did not include an id', { cause })
    }

    if (logger) {
      logger.debug('post succeeded', {
        meta: {
          room_id: roomId,
          message_id: responseBody.id,
          duration_ms: durationMs
        }
      })
    }

    return {
      id: responseBody.id,
      roomId,
      createdAt: typeof responseBody.created_at === 'string'
        ? responseBody.created_at
        : new Date().toISOString()
    }
  }
}
