// SPDX-License-Identifier: AGPL-3.0-or-later

const VALID_METHODS = ['POST', 'PUT', 'PATCH']

/**
 * webhook-receive registers an HTTP endpoint with the runtime. On
 * each matching request, it calls each child handler with the raw
 * request body and headers.
 *
 * This is the fourth composite trigger primitive. It follows the
 * same contract as watch-pattern, expose-command, and schedule-task:
 * create receives resolved children, and the handler it returns
 * invokes them with a payload.
 * @type {Primitive}
 */
export const webhookReceive = {
  id: 'webhook-receive',
  targets: ['bot'],
  capabilities: [],
  label: 'Webhook Receive',
  description: 'Handles inbound HTTP webhook requests.',
  configSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'], default: 'POST' },
      secret: { type: 'string' },
      idempotency: { type: 'string' },
      retries: { type: 'number', minimum: 0 },
      retryDelayMs: { type: 'number', minimum: 0 }
    },
    required: ['path'],
    additionalProperties: false
  },
  create: (config, children) => {
    const path = config.path
    const method = config.method === undefined ? 'POST' : config.method
    const secret = config.secret
    const idempotency = config.idempotency
    const retries = config.retries === undefined ? 0 : config.retries
    const retryDelayMs = config.retryDelayMs

    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('webhook-receive: config.path is required')
    }
    if (!path.startsWith('/')) {
      throw new Error('webhook-receive: config.path must start with "/"')
    }
    if (!VALID_METHODS.includes(method)) {
      throw new Error(
        'webhook-receive: config.method must be one of POST, PUT, PATCH'
      )
    }
    if (secret !== undefined && typeof secret !== 'string') {
      throw new Error('webhook-receive: config.secret must be a string')
    }
    if (idempotency !== undefined && typeof idempotency !== 'string') {
      throw new Error('webhook-receive: config.idempotency must be a string')
    }
    if (typeof retries !== 'number' || retries < 0 || !Number.isInteger(retries)) {
      throw new Error('webhook-receive: config.retries must be a non-negative integer')
    }
    if (retryDelayMs !== undefined) {
      if (typeof retryDelayMs !== 'number' || retryDelayMs < 0) {
        throw new Error('webhook-receive: config.retryDelayMs must be a non-negative number')
      }
    }
    if (!Array.isArray(children)) {
      throw new Error('webhook-receive: children must be an array')
    }
    if (children.length === 0) {
      throw new Error('webhook-receive: at least one child is required')
    }

    return async (ctx, input) => {
      if (!input || typeof input !== 'object') {
        return
      }
      const body = input.body
      const headers = input.headers

      const payload = {
        path: typeof input.path === 'string' ? input.path : path,
        body: typeof body === 'string' ? body : '',
        headers: headers && typeof headers === 'object' ? headers : {}
      }

      for (const child of children) {
        await child(ctx, payload)
      }
    }
  }
}
