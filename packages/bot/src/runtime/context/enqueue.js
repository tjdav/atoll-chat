import crypto from 'node:crypto'
import {
  EnqueuePayloadTooLargeError,
  EnqueuePayloadNotSerializableError,
  EnqueueInvalidRequestIdError,
  EnqueueInvalidTimeoutError,
  EnqueueMissingCannedResponseError,
  EnqueueRequestIdReusedError,
  EnqueueNetworkFailureError,
  EnqueueBudgetExhaustedError,
  EnqueueInvalidRoutingError,
  HttpRequestError
} from '../../errors.js'

/**
 * Creates the `ctx.enqueue` method.
 *
 * Enqueues a request for operator response. Validates inputs,
 * serializes the payload, checks size limits, and posts to
 * `POST /bots/me/operator-queue` with retries. Returns the request
 * handle.
 *
 * @param {object} deps
 * @param {import('../transport/http.js').HttpClient} deps.http - The
 *   authenticated HTTP client. Must be the `apiHttp` client (paths
 *   are relative to `/api/v1/`).
 * @param {import('../diagnostics/logger.js').Logger} [deps.logger] -
 *   Optional logger.
 * @param {() => string} [deps.generateRequestId] - Generates a
 *   request id when the caller does not supply one. Defaults to
 *   `crypto.randomUUID()`. Parameterized for testing.
 * @param {number} [deps.maxPayloadBytes=65536] - Maximum serialized
 *   payload size in bytes. Parameterized for testing.
 * @returns {(payload: object, options?: object) => Promise<string>} The
 *   method.
 */
export function createEnqueueMethod ({
  http,
  logger,
  generateRequestId = () => crypto.randomUUID(),
  maxPayloadBytes = 65536
}) {
  /**
   * @param {object} payload - The request payload.
   * @param {{ requestId?: string, audience?: 'private' | 'public', timeout?: number | null, onTimeout?: 'ignore' | 'canned', cannedResponse?: string, roomId?: string | null }} [options] - Enqueue options.
   * @returns {Promise<string>} The request id handle.
   */
  return async function enqueue (payload, options = {}) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new EnqueuePayloadNotSerializableError(
        'ctx.enqueue: payload must be a plain object'
      )
    }

    let serialized
    try {
      serialized = JSON.stringify(payload)
    } catch (err) {
      throw new EnqueuePayloadNotSerializableError(
        'ctx.enqueue: payload is not JSON-serializable',
        { cause: err instanceof Error ? err : new Error(String(err)) }
      )
    }

    if (serialized === undefined) {
      throw new EnqueuePayloadNotSerializableError(
        'ctx.enqueue: payload is not JSON-serializable'
      )
    }

    const payloadBytes = Buffer.byteLength(serialized, 'utf8')
    if (payloadBytes > maxPayloadBytes) {
      throw new EnqueuePayloadTooLargeError(
        `ctx.enqueue: payload is ${payloadBytes} bytes, exceeds ${maxPayloadBytes}`
      )
    }

    const requestId = options.requestId ?? generateRequestId()
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
      throw new EnqueueInvalidRequestIdError(
        `ctx.enqueue: requestId must match ^[a-zA-Z0-9_-]{1,128}$, got ${JSON.stringify(requestId)}`
      )
    }

    const audience = options.audience ?? 'private'
    if (audience !== 'private' && audience !== 'public') {
      throw new EnqueueInvalidRoutingError(
        `ctx.enqueue: audience must be 'private' or 'public', got ${JSON.stringify(audience)}`
      )
    }

    const timeout = options.timeout ?? null
    if (timeout !== null) {
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2592000) {
        throw new EnqueueInvalidTimeoutError(
          `ctx.enqueue: timeout must be null or an integer in [1, 2592000], got ${JSON.stringify(timeout)}`
        )
      }
    }

    const onTimeout = options.onTimeout ?? 'ignore'
    if (onTimeout !== 'ignore' && onTimeout !== 'canned') {
      throw new TypeError("ctx.enqueue: onTimeout must be 'ignore' or 'canned'")
    }

    let cannedResponse = null
    if (onTimeout === 'canned') {
      if (typeof options.cannedResponse !== 'string') {
        throw new EnqueueMissingCannedResponseError(
          'ctx.enqueue: cannedResponse is required when onTimeout is "canned"'
        )
      }
      if (options.cannedResponse.length > 16384) {
        throw new EnqueuePayloadTooLargeError(
          'ctx.enqueue: cannedResponse exceeds 16384 characters'
        )
      }
      cannedResponse = options.cannedResponse
    }

    const roomId = options.roomId ?? null
    if (roomId !== null && typeof roomId !== 'string') {
      throw new EnqueueInvalidRoutingError('ctx.enqueue: roomId must be a string or null')
    }

    const body = {
      request_id: requestId,
      payload: JSON.parse(serialized),
      audience,
      room_id: roomId,
      timeout,
      on_timeout: onTimeout,
      canned_response: cannedResponse
    }

    try {
      await http.request('POST', '/bots/me/operator-queue', {
        body,
        retry: true
      })
    } catch (err) {
      const errRecord =
        /** @type {Record<string, any>} */
        (err)
      const isHttpErr = err instanceof HttpRequestError || (err && typeof err === 'object' && errRecord.code === 'http_request_failed')
      if (isHttpErr) {
        const causeErr = err instanceof Error ? err : new Error(String(err))
        if (errRecord.responseErrorCode === 'request_id_reused') {
          throw new EnqueueRequestIdReusedError(
            `ctx.enqueue: request_id ${requestId} was already used`,
            { cause: causeErr }
          )
        }
        if (errRecord.status === 0) {
          throw new EnqueueNetworkFailureError(
            'ctx.enqueue: network failure after retries',
            { cause: causeErr }
          )
        }
        if (errRecord.status === 429) {
          throw new EnqueueBudgetExhaustedError(
            'ctx.enqueue: rate limited after retries',
            { cause: causeErr }
          )
        }
        throw new EnqueueNetworkFailureError(
          `ctx.enqueue: server error ${errRecord.status} after retries`,
          { cause: causeErr }
        )
      }
      throw err
    }

    logger?.debug('enqueue succeeded', {
      meta: {
        request_id: requestId,
        audience
      }
    })

    return requestId
  }
}
