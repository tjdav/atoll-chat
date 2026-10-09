// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { webhookReceive } from '../../../src/primitives/webhook-receive.js'

/**
 * Builds a mock BotCtx. The handler under test only passes ctx
 * through to children.
 * @returns {object} A minimal ctx.
 */
function createMockCtx () {
  return {}
}

/**
 * Builds a child handler that records its invocations.
 * @returns {{ child: Function, calls: object[] }} The child and a
 *   mutable array of its payloads.
 */
function createRecordingChild () {
  const calls = []
  const child = async (ctx, payload) => {
    calls.push(payload)
  }
  return { child, calls }
}

test('webhook-receive has the expected shape', () => {
  assert.equal(webhookReceive.id, 'webhook-receive')
  assert.deepEqual(webhookReceive.targets, ['bot'])
  assert.deepEqual(webhookReceive.capabilities, [])
  assert.equal(typeof webhookReceive.label, 'string')
  assert.equal(typeof webhookReceive.description, 'string')
  assert.equal(typeof webhookReceive.configSchema, 'object')
  assert.equal(typeof webhookReceive.create, 'function')
})

test('config schema requires path', () => {
  assert.deepEqual(webhookReceive.configSchema.required, ['path'])
})

test('config schema declares allowed methods', () => {
  const method = webhookReceive.configSchema.properties.method
  assert.deepEqual(method.enum, ['POST', 'PUT', 'PATCH'])
})

test('create throws when path is missing', () => {
  assert.throws(
    () => webhookReceive.create({}, [async () => {}]),
    /config\.path is required/
  )
})

test('create throws when path is empty', () => {
  assert.throws(
    () => webhookReceive.create({ path: '' }, [async () => {}]),
    /config\.path is required/
  )
})

test('create throws when path does not start with a slash', () => {
  assert.throws(
    () => webhookReceive.create({ path: 'import' }, [async () => {}]),
    /config\.path must start with "\/"/
  )
})

test('create throws when method is not allowed', () => {
  assert.throws(
    () => webhookReceive.create({ path: '/x', method: 'GET' }, [async () => {}]),
    /config\.method must be one of POST, PUT, PATCH/
  )
})

test('create throws when secret is not a string', () => {
  assert.throws(
    () => webhookReceive.create({ path: '/x', secret: 5 }, [async () => {}]),
    /config\.secret must be a string/
  )
})

test('create throws when idempotency is not a string', () => {
  assert.throws(
    () => webhookReceive.create({ path: '/x', idempotency: {} }, [async () => {}]),
    /config\.idempotency must be a string/
  )
})

test('create throws when retries is negative', () => {
  assert.throws(
    () => webhookReceive.create({ path: '/x', retries: -1 }, [async () => {}]),
    /config\.retries must be a non-negative integer/
  )
})

test('create throws when retries is not an integer', () => {
  assert.throws(
    () => webhookReceive.create({ path: '/x', retries: 1.5 }, [async () => {}]),
    /config\.retries must be a non-negative integer/
  )
})

test('create throws when retryDelayMs is negative', () => {
  assert.throws(
    () => webhookReceive.create({ path: '/x', retryDelayMs: -1 }, [async () => {}]),
    /config\.retryDelayMs must be a non-negative number/
  )
})

test('create throws when children is not an array', () => {
  assert.throws(
    () => webhookReceive.create({ path: '/x' }, null),
    /children must be an array/
  )
})

test('create throws when there are no children', () => {
  assert.throws(
    () => webhookReceive.create({ path: '/x' }, []),
    /at least one child is required/
  )
})

test('create accepts all valid method values', () => {
  for (const method of ['POST', 'PUT', 'PATCH']) {
    const handler = webhookReceive.create(
      { path: '/x', method },
      [async () => {}]
    )
    assert.equal(typeof handler, 'function')
  }
})

test('handler calls children with path, body, and headers', async () => {
  const { child, calls } = createRecordingChild()
  const handler = webhookReceive.create({ path: '/import' }, [child])
  const input = {
    path: '/import',
    body: '{"url":"https://example.com"}',
    headers: { 'content-type': 'application/json' }
  }
  await handler(createMockCtx(), input)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/import')
  assert.equal(calls[0].body, '{"url":"https://example.com"}')
  assert.equal(calls[0].headers['content-type'], 'application/json')
})

test('handler defaults body to empty string when missing', async () => {
  const { child, calls } = createRecordingChild()
  const handler = webhookReceive.create({ path: '/x' }, [child])
  await handler(createMockCtx(), { path: '/x' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body, '')
})

test('handler defaults headers to an empty object when missing', async () => {
  const { child, calls } = createRecordingChild()
  const handler = webhookReceive.create({ path: '/x' }, [child])
  await handler(createMockCtx(), { path: '/x', body: 'x' })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].headers, {})
})

test('handler falls back to config path when input path is missing', async () => {
  const { child, calls } = createRecordingChild()
  const handler = webhookReceive.create({ path: '/import' }, [child])
  await handler(createMockCtx(), { body: 'x' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/import')
})

test('handler does nothing when input is undefined', async () => {
  const { child, calls } = createRecordingChild()
  const handler = webhookReceive.create({ path: '/x' }, [child])
  await handler(createMockCtx(), undefined)
  assert.equal(calls.length, 0)
})

test('handler does nothing when input is not an object', async () => {
  const { child, calls } = createRecordingChild()
  const handler = webhookReceive.create({ path: '/x' }, [child])
  await handler(createMockCtx(), 'not an object')
  assert.equal(calls.length, 0)
})

test('handler calls all children in order', async () => {
  const first = createRecordingChild()
  const second = createRecordingChild()
  const handler = webhookReceive.create({ path: '/x' }, [first.child, second.child])
  await handler(createMockCtx(), { path: '/x', body: 'x', headers: {} })
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 1)
  assert.equal(first.calls[0].body, 'x')
  assert.equal(second.calls[0].body, 'x')
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'webhook-receive'), webhookReceive)
  assert.ok(Object.hasOwn(primitives.bot, 'webhook-receive'))
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
  assert.ok(Object.hasOwn(primitives.bot, 'send-local'))
  assert.ok(Object.hasOwn(primitives.bot, 'watch-pattern'))
  assert.ok(Object.hasOwn(primitives.bot, 'keyed-store'))
  assert.ok(Object.hasOwn(primitives.bot, 'expose-command'))
})
