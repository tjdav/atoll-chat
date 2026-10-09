// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sendLocal } from '../../../src/primitives/send-local.js'

/**
 * Builds a minimal mock BotCtx that records sendLocal calls.
 * @returns {{ ctx: object, calls: object[] }} The mock context and
 *   a mutable array of captured sendLocal calls.
 */
function createMockCtx () {
  const calls = []
  const ctx = {
    sendLocal: async (opts) => {
      calls.push(opts)
    }
  }
  return { ctx, calls }
}

test('send-local has the expected shape', () => {
  assert.equal(sendLocal.id, 'send-local')
  assert.deepEqual(sendLocal.targets, ['bot'])
  assert.deepEqual(sendLocal.capabilities, [])
  assert.equal(typeof sendLocal.label, 'string')
  assert.equal(typeof sendLocal.description, 'string')
  assert.equal(typeof sendLocal.configSchema, 'object')
  assert.equal(typeof sendLocal.create, 'function')
})

test('send-local config schema requires text', () => {
  assert.deepEqual(sendLocal.configSchema.required, ['text'])
  assert.equal(sendLocal.configSchema.properties.text.type, 'string')
})

test('send-local config schema accepts format values', () => {
  const format = sendLocal.configSchema.properties.format
  assert.deepEqual(format.enum, ['text', 'markdown'])
})

test('create returns a function', () => {
  const handler = sendLocal.create({ text: 'hello' })
  assert.equal(typeof handler, 'function')
})

test('create throws when text is missing', () => {
  assert.throws(
    () => sendLocal.create({}),
    /config\.text is required/
  )
})

test('create throws when text is empty', () => {
  assert.throws(
    () => sendLocal.create({ text: '' }),
    /config\.text is required/
  )
})

test('create throws when format is not a known value', () => {
  assert.throws(
    () => sendLocal.create({ text: 'hi', format: 'html' }),
    /config\.format must be "text" or "markdown"/
  )
})

test('handler sends the config text with no format when none given', async () => {
  const handler = sendLocal.create({ text: 'hello' })
  const { ctx, calls } = createMockCtx()
  await handler(ctx)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].text, 'hello')
  assert.equal(Object.hasOwn(calls[0], 'format'), false)
})

test('handler sends the config text with format when given', async () => {
  const handler = sendLocal.create({ text: 'hello', format: 'markdown' })
  const { ctx, calls } = createMockCtx()
  await handler(ctx)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].text, 'hello')
  assert.equal(calls[0].format, 'markdown')
})

test('handler works with no ctx.room present', async () => {
  const handler = sendLocal.create({ text: 'hello' })
  const { ctx, calls } = createMockCtx()
  await handler(ctx)
  assert.equal(calls.length, 1)
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'send-local'), sendLocal)
  assert.ok(Object.hasOwn(primitives.bot, 'send-local'))
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
})
