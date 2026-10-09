// SPDX-License-Identifier: AGPL-3.0-or-later

import { substitute } from '../lib/substitute.js'

const VALID_AUDIENCES = ['private', 'public']
const VALID_ON_TIMEOUT = ['ignore', 'canned']
const QUEUE_PREFIX = 'operator:queue:'

/**
 * Generates a request identifier. Uses the global crypto API when
 * available, falls back to a time-and-randomness scheme.
 * @returns {string} A request identifier.
 */
function generateRequestId () {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const time = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `${time}-${random}`
}

/**
 * queue-for-operator writes a request to the operator queue and
 * returns. The operator console picks it up out of band; the runtime
 * invokes the declared response handlers when the response arrives.
 *
 * In v1 the primitive writes the queue entry but does not invoke its
 * children. The response flow requires runtime cooperation that is
 * deferred to v1.1. Children are declared and stored; they are not
 * called from this primitive in the current version.
 * @type {Primitive}
 */
export const queueForOperator = {
  id: 'queue-for-operator',
  targets: ['bot'],
  capabilities: [],
  label: 'Queue for Operator',
  description: 'Queues a request for a human operator to answer.',
  configSchema: {
    type: 'object',
    properties: {
      audience: { type: 'string', enum: ['private', 'public'], default: 'private' },
      timeout: { type: 'string', default: 'never' },
      onTimeout: { type: 'string', enum: ['ignore', 'canned'], default: 'ignore' },
      cannedResponse: { type: 'string' },
      requestId: { type: 'string' }
    },
    additionalProperties: false
  },
  create: (config, children) => {
    const audience = config.audience === undefined ? 'private' : config.audience
    const timeout = config.timeout === undefined ? 'never' : config.timeout
    const onTimeout = config.onTimeout === undefined ? 'ignore' : config.onTimeout
    const cannedResponse = config.cannedResponse
    const requestId = config.requestId

    if (!VALID_AUDIENCES.includes(audience)) {
      throw new Error('queue-for-operator: config.audience must be one of private, public')
    }
    if (typeof timeout !== 'string' || timeout.length === 0) {
      throw new Error('queue-for-operator: config.timeout must be a non-empty string')
    }
    if (timeout !== 'never') {
      const seconds = Number(timeout)
      if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new Error('queue-for-operator: config.timeout must be "never" or a positive integer')
      }
    }
    if (!VALID_ON_TIMEOUT.includes(onTimeout)) {
      throw new Error('queue-for-operator: config.onTimeout must be one of ignore, canned')
    }
    if (onTimeout === 'canned') {
      if (typeof cannedResponse !== 'string' || cannedResponse.length === 0) {
        throw new Error('queue-for-operator: config.cannedResponse is required when onTimeout is "canned"')
      }
    } else if (cannedResponse !== undefined) {
      throw new Error('queue-for-operator: config.cannedResponse is only valid when onTimeout is "canned"')
    }
    if (requestId !== undefined && (typeof requestId !== 'string' || requestId.length === 0)) {
      throw new Error('queue-for-operator: config.requestId must be a non-empty string when provided')
    }
    if (!Array.isArray(children)) {
      throw new Error('queue-for-operator: children must be an array')
    }
    if (children.length === 0) {
      throw new Error('queue-for-operator: at least one child is required')
    }

    return async (ctx, input) => {
      const resolvedAudience = audience
      const resolvedRequestId = requestId === undefined
        ? generateRequestId()
        : substitute(requestId, input)

      if (typeof resolvedRequestId !== 'string' || resolvedRequestId.length === 0) {
        throw new Error('queue-for-operator: resolved requestId is empty')
      }

      const entry = {
        requestId: resolvedRequestId,
        payload: input,
        audience: resolvedAudience,
        queuedAt: new Date().toISOString(),
        timeout,
        onTimeout,
        status: 'pending'
      }
      if (onTimeout === 'canned') {
        entry.cannedResponse = cannedResponse
      }

      await ctx.storage.set(QUEUE_PREFIX + resolvedRequestId, entry)
    }
  }
}
