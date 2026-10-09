// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { llmComplete } from '../../../src/primitives/llm-complete.js'

/**
 * Builds a mock Response object.
 * @param {object} spec - Response spec.
 * @param {number} [spec.status] - HTTP status. Defaults to 200.
 * @param {unknown} [spec.body] - Response body, serialized to JSON.
 * @returns {object} A Response-shaped object.
 */
function createResponse (spec) {
  const status = spec.status === undefined ? 200 : spec.status
  const text = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body ?? {})
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text
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
 * Builds a child handler that records its inputs.
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

/**
 * Builds a minimal OpenAI-compatible completion response.
 * @param {string} content - The assistant content.
 * @returns {object} A completion response.
 */
function completion (content) {
  return { choices: [{ message: { role: 'assistant', content } }] }
}

test('llm-complete has the expected shape', () => {
  assert.equal(llmComplete.id, 'llm-complete')
  assert.deepEqual(llmComplete.targets, ['bot'])
  assert.deepEqual(llmComplete.capabilities, [])
  assert.equal(typeof llmComplete.label, 'string')
  assert.equal(typeof llmComplete.description, 'string')
  assert.equal(typeof llmComplete.configSchema, 'object')
  assert.equal(typeof llmComplete.create, 'function')
})

test('config schema requires baseUrl, model, userPrompt', () => {
  assert.deepEqual(llmComplete.configSchema.required, ['baseUrl', 'model', 'userPrompt'])
})

test('create throws when baseUrl is missing', () => {
  assert.throws(
    () => llmComplete.create({ model: 'm', userPrompt: 'hi' }, [async () => {}]),
    /config\.baseUrl is required/
  )
})

test('create throws when model is missing', () => {
  assert.throws(
    () => llmComplete.create({ baseUrl: 'https://x', userPrompt: 'hi' }, [async () => {}]),
    /config\.model is required/
  )
})

test('create throws when userPrompt is missing', () => {
  assert.throws(
    () => llmComplete.create({ baseUrl: 'https://x', model: 'm' }, [async () => {}]),
    /config\.userPrompt is required/
  )
})

test('create throws when mode is local', () => {
  assert.throws(
    () => llmComplete.create(
      { baseUrl: 'https://x', model: 'm', userPrompt: 'hi', mode: 'local' },
      [async () => {}]
    ),
    /config\.mode "local" is not implemented in v1/
  )
})

test('create throws when mode is invalid', () => {
  assert.throws(
    () => llmComplete.create(
      { baseUrl: 'https://x', model: 'm', userPrompt: 'hi', mode: 'cloud' },
      [async () => {}]
    ),
    /config\.mode must be one of saas, local/
  )
})

test('create throws when responseFormat is invalid', () => {
  assert.throws(
    () => llmComplete.create(
      { baseUrl: 'https://x', model: 'm', userPrompt: 'hi', responseFormat: 'xml' },
      [async () => {}]
    ),
    /config\.responseFormat must be one of text, json/
  )
})

test('create throws when temperature is out of range', () => {
  assert.throws(
    () => llmComplete.create(
      { baseUrl: 'https://x', model: 'm', userPrompt: 'hi', temperature: 3 },
      [async () => {}]
    ),
    /config\.temperature must be a number between 0 and 2/
  )
})

test('create throws when children is not an array', () => {
  assert.throws(
    () => llmComplete.create({ baseUrl: 'https://x', model: 'm', userPrompt: 'hi' }, null),
    /children must be an array/
  )
})

test('create throws when there are no children', () => {
  assert.throws(
    () => llmComplete.create({ baseUrl: 'https://x', model: 'm', userPrompt: 'hi' }, []),
    /at least one child is required/
  )
})

test('handler posts to the resolved baseUrl', async () => {
  const response = createResponse({ body: completion('hello') })
  const { ctx, calls } = createMockCtx(response)
  const handler = llmComplete.create(
    { baseUrl: 'https://engine.example.com/{{ver}}/llm/complete', model: 'm', userPrompt: 'hi' },
    [async () => {}]
  )
  await handler(ctx, { ver: 'v1' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://engine.example.com/v1/llm/complete')
})

test('handler sends the model, temperature, and messages', async () => {
  const response = createResponse({ body: completion('hello') })
  const { ctx, calls } = createMockCtx(response)
  const handler = llmComplete.create(
    {
      baseUrl: 'https://x',
      model: 'glm-4.5-flash',
      systemPrompt: 'You are terse.',
      userPrompt: 'Say hi to {{name}}'
    },
    [async () => {}]
  )
  await handler(ctx, { name: 'Alice' })
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'glm-4.5-flash')
  assert.equal(body.temperature, 0.1)
  assert.equal(body.messages.length, 2)
  assert.deepEqual(body.messages[0], { role: 'system', content: 'You are terse.' })
  assert.deepEqual(body.messages[1], { role: 'user', content: 'Say hi to Alice' })
  assert.equal(Object.hasOwn(body, 'response_format'), false)
})

test('handler omits system message when no systemPrompt is given', async () => {
  const response = createResponse({ body: completion('hi') })
  const { ctx, calls } = createMockCtx(response)
  const handler = llmComplete.create(
    { baseUrl: 'https://x', model: 'm', userPrompt: 'hi' },
    [async () => {}]
  )
  await handler(ctx, {})
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.messages.length, 1)
  assert.equal(body.messages[0].role, 'user')
})

test('handler sends response_format when responseFormat is json', async () => {
  const response = createResponse({ body: completion('{"x":1}') })
  const { ctx, calls } = createMockCtx(response)
  const handler = llmComplete.create(
    { baseUrl: 'https://x', model: 'm', userPrompt: 'hi', responseFormat: 'json' },
    [async () => {}]
  )
  await handler(ctx, {})
  const body = JSON.parse(calls[0].init.body)
  assert.deepEqual(body.response_format, { type: 'json_object' })
})

test('handler passes text content to children in text mode', async () => {
  const response = createResponse({ body: completion('the answer is 42') })
  const { ctx } = createMockCtx(response)
  const { child, calls } = createRecordingChild()
  const handler = llmComplete.create(
    { baseUrl: 'https://x', model: 'm', userPrompt: 'hi' },
    [child]
  )
  await handler(ctx, {})
  assert.equal(calls.length, 1)
  assert.equal(calls[0], 'the answer is 42')
})

test('handler passes parsed JSON to children in json mode', async () => {
  const response = createResponse({ body: completion('{"items":[1,2]}') })
  const { ctx } = createMockCtx(response)
  const { child, calls } = createRecordingChild()
  const handler = llmComplete.create(
    { baseUrl: 'https://x', model: 'm', userPrompt: 'hi', responseFormat: 'json' },
    [child]
  )
  await handler(ctx, {})
  assert.deepEqual(calls[0], { items: [1, 2] })
})

test('handler throws on non-2xx response', async () => {
  const response = createResponse({ status: 429, body: { error: 'rate limited' } })
  const { ctx } = createMockCtx(response)
  const handler = llmComplete.create(
    { baseUrl: 'https://x', model: 'm', userPrompt: 'hi' },
    [async () => {}]
  )
  await assert.rejects(
    () => handler(ctx, {}),
    /request failed with status 429/
  )
})

test('handler throws on malformed response', async () => {
  const response = createResponse({ body: { not: 'a completion' } })
  const { ctx } = createMockCtx(response)
  const handler = llmComplete.create(
    { baseUrl: 'https://x', model: 'm', userPrompt: 'hi' },
    [async () => {}]
  )
  await assert.rejects(
    () => handler(ctx, {}),
    /response has no choices/
  )
})

test('handler throws on invalid JSON in json mode', async () => {
  const response = createResponse({ body: completion('not json') })
  const { ctx } = createMockCtx(response)
  const handler = llmComplete.create(
    { baseUrl: 'https://x', model: 'm', userPrompt: 'hi', responseFormat: 'json' },
    [async () => {}]
  )
  await assert.rejects(
    () => handler(ctx, {}),
    /response content is not valid JSON/
  )
})

test('handler throws when resolved userPrompt is empty', async () => {
  const response = createResponse({ body: completion('hi') })
  const { ctx } = createMockCtx(response)
  const handler = llmComplete.create(
    { baseUrl: 'https://x', model: 'm', userPrompt: '{{text}}' },
    [async () => {}]
  )
  await assert.rejects(
    () => handler(ctx, { text: '' }),
    /resolved userPrompt is empty/
  )
})

test('handler calls all children in order', async () => {
  const response = createResponse({ body: completion('same') })
  const { ctx } = createMockCtx(response)
  const first = createRecordingChild()
  const second = createRecordingChild()
  const handler = llmComplete.create(
    { baseUrl: 'https://x', model: 'm', userPrompt: 'hi' },
    [first.child, second.child]
  )
  await handler(ctx, {})
  assert.equal(first.calls[0], 'same')
  assert.equal(second.calls[0], 'same')
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'llm-complete'), llmComplete)
  assert.ok(Object.hasOwn(primitives.bot, 'llm-complete'))
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
  assert.ok(Object.hasOwn(primitives.bot, 'send-local'))
  assert.ok(Object.hasOwn(primitives.bot, 'watch-pattern'))
  assert.ok(Object.hasOwn(primitives.bot, 'keyed-store'))
  assert.ok(Object.hasOwn(primitives.bot, 'expose-command'))
  assert.ok(Object.hasOwn(primitives.bot, 'schedule-task'))
  assert.ok(Object.hasOwn(primitives.bot, 'webhook-receive'))
  assert.ok(Object.hasOwn(primitives.bot, 'http-fetch'))
  assert.ok(Object.hasOwn(primitives.bot, 'settings-read'))
  assert.ok(Object.hasOwn(primitives.bot, 'settings-write'))
  assert.ok(Object.hasOwn(primitives.bot, 'transform'))
})
