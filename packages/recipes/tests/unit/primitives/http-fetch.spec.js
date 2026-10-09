// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { httpFetch } from '../../../src/primitives/http-fetch.js'

/**
 * Builds a mock Response object.
 * @param {object} spec - Response spec.
 * @param {number} [spec.status] - HTTP status. Defaults to 200.
 * @param {string} [spec.body] - Response body text.
 * @returns {object} A Response-shaped object.
 */
function createResponse (spec) {
  const status = spec.status === undefined ? 200 : spec.status
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => spec.body ?? ''
  }
}

/**
 * Builds a mock BotCtx whose fetch records calls and returns a
 * configured response.
 * @param {object} response - The response to return.
 * @returns {{ ctx: object, calls: object[] }} The mock context and
 *   a mutable array of fetch calls.
 */
function createMockCtx (response) {
  const calls = []
  const ctx = {
    fetch: async (url, init) => {
      calls.push({ url, init })
      return response
    }
  }
  return { ctx, calls }
}

/**
 * Builds a child handler that records its invocations.
 * @returns {{ child: Function, calls: unknown[] }} The child and a
 *   mutable array of its inputs.
 */
function createRecordingChild () {
  const calls = []
  const child = async (ctx, input) => {
    calls.push(input)
  }
  return { child, calls }
}

test('http-fetch has the expected shape', () => {
  assert.equal(httpFetch.id, 'http-fetch')
  assert.deepEqual(httpFetch.targets, ['bot'])
  assert.deepEqual(httpFetch.capabilities, [])
  assert.equal(typeof httpFetch.label, 'string')
  assert.equal(typeof httpFetch.description, 'string')
  assert.equal(typeof httpFetch.configSchema, 'object')
  assert.equal(typeof httpFetch.create, 'function')
})

test('config schema requires url', () => {
  assert.deepEqual(httpFetch.configSchema.required, ['url'])
})

test('create throws when url is missing', () => {
  assert.throws(
    () => httpFetch.create({}, []),
    /config\.url is required/
  )
})

test('create throws when method is invalid', () => {
  assert.throws(
    () => httpFetch.create({ url: 'https://x', method: 'HEAD' }, []),
    /config\.method must be one of GET, POST, PUT, PATCH, DELETE/
  )
})

test('create throws when responseMode is invalid', () => {
  assert.throws(
    () => httpFetch.create({ url: 'https://x', responseMode: 'xml' }, []),
    /config\.responseMode must be one of json, text, status/
  )
})

test('create throws when GET has a body', () => {
  assert.throws(
    () => httpFetch.create({ url: 'https://x', method: 'GET', body: 'x' }, []),
    /GET requests cannot have a body/
  )
})

test('create throws when headers is not a plain object', () => {
  assert.throws(
    () => httpFetch.create({ url: 'https://x', headers: [] }, []),
    /config\.headers must be a plain object/
  )
})

test('create throws when children is not an array', () => {
  assert.throws(
    () => httpFetch.create({ url: 'https://x' }, null),
    /children must be an array/
  )
})

test('handler calls ctx.fetch with the resolved URL', async () => {
  const response = createResponse({ body: '{}' })
  const { ctx, calls } = createMockCtx(response)
  const handler = httpFetch.create({ url: 'https://api.example.com/items/{{id}}' }, [])
  await handler(ctx, { id: 'abc' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.example.com/items/abc')
})

test('handler passes method and headers through', async () => {
  const response = createResponse({ body: '{}' })
  const { ctx, calls } = createMockCtx(response)
  const handler = httpFetch.create(
    { url: 'https://x', method: 'POST', headers: { 'x-token': '{{token}}' } },
    []
  )
  await handler(ctx, { token: 'secret' })
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['x-token'], 'secret')
})

test('handler serializes object bodies to JSON and sets content-type', async () => {
  const response = createResponse({ body: '{}' })
  const { ctx, calls } = createMockCtx(response)
  const handler = httpFetch.create(
    { url: 'https://x', method: 'POST', body: { text: '{{msg}}' } },
    []
  )
  await handler(ctx, { msg: 'hello' })
  assert.equal(calls[0].init.body, '{"text":"hello"}')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
})

test('handler passes string bodies through without content-type', async () => {
  const response = createResponse({ body: '{}' })
  const { ctx, calls } = createMockCtx(response)
  const handler = httpFetch.create(
    { url: 'https://x', method: 'POST', body: 'raw {{msg}}' },
    []
  )
  await handler(ctx, { msg: 'payload' })
  assert.equal(calls[0].init.body, 'raw payload')
  assert.equal(Object.hasOwn(calls[0].init.headers, 'content-type'), false)
})

test('handler does not override an explicit content-type', async () => {
  const response = createResponse({ body: '{}' })
  const { ctx, calls } = createMockCtx(response)
  const handler = httpFetch.create(
    { url: 'https://x', method: 'POST', body: { a: 1 }, headers: { 'content-type': 'application/vnd.custom' } },
    []
  )
  await handler(ctx, {})
  assert.equal(calls[0].init.headers['content-type'], 'application/vnd.custom')
})

test('handler passes parsed JSON to children in json mode', async () => {
  const response = createResponse({ body: '{"items":[1,2,3]}' })
  const { ctx } = createMockCtx(response)
  const { child, calls } = createRecordingChild()
  const handler = httpFetch.create({ url: 'https://x' }, [child])
  await handler(ctx, {})
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { items: [1, 2, 3] })
})

test('handler passes raw text to children in text mode', async () => {
  const response = createResponse({ body: 'plain text' })
  const { ctx } = createMockCtx(response)
  const { child, calls } = createRecordingChild()
  const handler = httpFetch.create({ url: 'https://x', responseMode: 'text' }, [child])
  await handler(ctx, {})
  assert.equal(calls[0], 'plain text')
})

test('handler passes status to children in status mode', async () => {
  const response = createResponse({ status: 204, body: '' })
  const { ctx } = createMockCtx(response)
  const { child, calls } = createRecordingChild()
  const handler = httpFetch.create({ url: 'https://x', responseMode: 'status' }, [child])
  await handler(ctx, {})
  assert.equal(calls[0], 204)
})

test('handler throws on non-2xx responses', async () => {
  const response = createResponse({ status: 404, body: 'not found' })
  const { ctx } = createMockCtx(response)
  const handler = httpFetch.create({ url: 'https://x' }, [])
  await assert.rejects(
    () => handler(ctx, {}),
    /request failed with status 404/
  )
})

test('handler throws on invalid JSON in json mode', async () => {
  const response = createResponse({ body: 'not json' })
  const { ctx } = createMockCtx(response)
  const handler = httpFetch.create({ url: 'https://x' }, [])
  await assert.rejects(
    () => handler(ctx, {}),
    /response is not valid JSON/
  )
})

test('handler supports zero children', async () => {
  const response = createResponse({ body: '{}' })
  const { ctx, calls } = createMockCtx(response)
  const handler = httpFetch.create({ url: 'https://x', method: 'DELETE' }, [])
  await handler(ctx, {})
  assert.equal(calls.length, 1)
})

test('handler calls all children in order', async () => {
  const response = createResponse({ body: '{"n":1}' })
  const { ctx } = createMockCtx(response)
  const first = createRecordingChild()
  const second = createRecordingChild()
  const handler = httpFetch.create({ url: 'https://x' }, [first.child, second.child])
  await handler(ctx, {})
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 1)
  assert.deepEqual(first.calls[0], { n: 1 })
  assert.deepEqual(second.calls[0], { n: 1 })
})

test('handler throws when the resolved URL is empty', async () => {
  const response = createResponse({ body: '{}' })
  const { ctx } = createMockCtx(response)
  const handler = httpFetch.create({ url: '{{base}}{{path}}' }, [])
  await assert.rejects(
    () => handler(ctx, { base: '', path: '' }),
    /resolved url is empty/
  )
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'http-fetch'), httpFetch)
  assert.ok(Object.hasOwn(primitives.bot, 'http-fetch'))
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
  assert.ok(Object.hasOwn(primitives.bot, 'send-local'))
  assert.ok(Object.hasOwn(primitives.bot, 'watch-pattern'))
  assert.ok(Object.hasOwn(primitives.bot, 'keyed-store'))
  assert.ok(Object.hasOwn(primitives.bot, 'expose-command'))
  assert.ok(Object.hasOwn(primitives.bot, 'schedule-task'))
  assert.ok(Object.hasOwn(primitives.bot, 'webhook-receive'))
})
