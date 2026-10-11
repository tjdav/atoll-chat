// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { postResponse } from '../../../src/primitives/post-response.js'

/**
 * Builds a minimal mock BotCtx that records post calls.
 * @param {string | null} roomId - The room id to attach, or null.
 * @returns {{ ctx: any, calls: any[] }} The mock context and
 *   a mutable array of captured post calls.
 */
function createMockCtx (roomId) {
  /** @type {any[]} */
  const calls = []
  const ctx = {
    room: roomId
      ? {
        id: roomId,
        displayName: 'Test',
        memberCount: 1
      }
      : null,
    /**
     * @param {any} opts - The options passed to post.
     */
    post: async (opts) => {
      calls.push(opts)
      return {
        id: 'm_1',
        roomId: opts.roomId,
        createdAt: '2026-01-01T00:00:00Z'
      }
    }
  }
  return {
    ctx,
    calls
  }
}

test('post-response has the expected shape', () => {
  assert.equal(postResponse.id, 'post-response')
  assert.deepEqual(postResponse.targets, ['bot'])
  assert.deepEqual(postResponse.capabilities, ['post_message'])
  assert.equal(typeof postResponse.label, 'string')
  assert.equal(typeof postResponse.description, 'string')
  assert.equal(typeof postResponse.configSchema, 'object')
  assert.equal(typeof postResponse.create, 'function')
})

test('post-response config schema requires text', () => {
  /** @type {any} */
  const schema = postResponse.configSchema
  assert.deepEqual(schema.required, ['text'])
  assert.equal(schema.properties.text.type, 'string')
})

test('create returns a function', () => {
  const handler = postResponse.create({ text: 'hello' })
  assert.equal(typeof handler, 'function')
})

test('create throws when text is missing', () => {
  assert.throws(
    () => postResponse.create({}),
    /config\.text is required/
  )
})

test('create throws when text is empty', () => {
  assert.throws(
    () => postResponse.create({ text: '' }),
    /config\.text is required/
  )
})

test('create throws when roomId is not a string', () => {
  assert.throws(
    () => postResponse.create({
      text: 'hi',
      roomId: 42
    }),
    /config\.roomId must be a string/
  )
})

test('handler posts the config text to the ctx room', async () => {
  /** @type {any} */
  const handler = postResponse.create({ text: 'hello' })
  const { ctx, calls } = createMockCtx('r_1')
  await handler(ctx)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].text, 'hello')
  assert.equal(calls[0].roomId, 'r_1')
})

test('handler uses config roomId when provided', async () => {
  /** @type {any} */
  const handler = postResponse.create({
    text: 'hello',
    roomId: 'r_2'
  })
  const { ctx, calls } = createMockCtx('r_1')
  await handler(ctx)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].roomId, 'r_2')
})

test('handler uses config roomId when ctx.room is null', async () => {
  /** @type {any} */
  const handler = postResponse.create({
    text: 'hello',
    roomId: 'r_2'
  })
  const { ctx, calls } = createMockCtx(null)
  await handler(ctx)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].roomId, 'r_2')
})

test('handler throws when neither config.roomId nor ctx.room is set', async () => {
  /** @type {any} */
  const handler = postResponse.create({ text: 'hello' })
  const { ctx } = createMockCtx(null)
  await assert.rejects(
    () => handler(ctx),
    /no target room available/
  )
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'post-response'), postResponse)
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
})

test('handler substitutes a single-token template in text', async () => {
  const handler = postResponse.create({ text: '{{match}}' })
  const { ctx, calls } = createMockCtx('r_1')
  await handler(ctx, { match: 'https://example.com' })
  assert.equal(calls[0].text, 'https://example.com')
})

test('handler substitutes a mixed template in text', async () => {
  const handler = postResponse.create({ text: 'Found: {{match}}' })
  const { ctx, calls } = createMockCtx('r_1')
  await handler(ctx, { match: 'hello' })
  assert.equal(calls[0].text, 'Found: hello')
})

test('handler substitutes a nested path in text', async () => {
  const handler = postResponse.create({ text: '{{args.question}}' })
  const { ctx, calls } = createMockCtx('r_1')
  await handler(ctx, { args: { question: 'why?' } })
  assert.equal(calls[0].text, 'why?')
})

test('handler substitutes a single-token template in roomId', async () => {
  const handler = postResponse.create({ text: 'hi', roomId: '{{targetRoom}}' })
  const { ctx, calls } = createMockCtx('r_1')
  await handler(ctx, { targetRoom: 'r_2' })
  assert.equal(calls[0].roomId, 'r_2')
})

test('handler substitutes a mixed template in roomId', async () => {
  const handler = postResponse.create({ text: 'hi', roomId: 'room-{{id}}' })
  const { ctx, calls } = createMockCtx('r_1')
  await handler(ctx, { id: 'abc' })
  assert.equal(calls[0].roomId, 'room-abc')
})

test('handler throws when resolved text is empty', async () => {
  const handler = postResponse.create({ text: '{{value}}' })
  const { ctx } = createMockCtx('r_1')
  await assert.rejects(
    () => handler(ctx, { value: '' }),
    /resolved text is empty/
  )
})

test('handler throws when a template path is unresolvable', async () => {
  const handler = postResponse.create({ text: '{{missing}}' })
  const { ctx } = createMockCtx('r_1')
  await assert.rejects(
    () => handler(ctx, {}),
    /path "missing" is not resolvable/
  )
})

test('handler still works when input is undefined', async () => {
  const handler = postResponse.create({ text: 'plain text' })
  const { ctx, calls } = createMockCtx('r_1')
  await handler(ctx)
  assert.equal(calls[0].text, 'plain text')
})
