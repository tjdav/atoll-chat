// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { settingsWrite } from '../../../src/primitives/settings-write.js'

/**
 * Builds a mock BotCtx whose settings store records writes.
 * @returns {{ ctx: object, writes: object[], store: Map<string, unknown> }} The mock context, a mutable array of write calls, and the backing store.
 */
function createMockCtx () {
  const writes = []
  const store = new Map()
  const ctx = {
    settings: {
      set: async (key, value, opts) => {
        writes.push({ key, value, opts })
        const composite = opts && typeof opts.room === 'string'
          ? `room:${opts.room}:${key}`
          : key
        store.set(composite, value)
      }
    }
  }
  return { ctx, writes, store }
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

test('settings-write has the expected shape', () => {
  assert.equal(settingsWrite.id, 'settings-write')
  assert.deepEqual(settingsWrite.targets, ['bot'])
  assert.deepEqual(settingsWrite.capabilities, [])
  assert.equal(typeof settingsWrite.label, 'string')
  assert.equal(typeof settingsWrite.description, 'string')
  assert.equal(typeof settingsWrite.configSchema, 'object')
  assert.equal(typeof settingsWrite.create, 'function')
})

test('config schema requires key', () => {
  assert.deepEqual(settingsWrite.configSchema.required, ['key'])
})

test('create throws when key is missing', () => {
  assert.throws(
    () => settingsWrite.create({ value: 'x' }, []),
    /config\.key is required/
  )
})

test('create throws when key is empty', () => {
  assert.throws(
    () => settingsWrite.create({ key: '', value: 'x' }, []),
    /config\.key is required/
  )
})

test('create throws when room is empty', () => {
  assert.throws(
    () => settingsWrite.create({ key: 'x', value: 'v', room: '' }, []),
    /config\.room must be a non-empty string/
  )
})

test('create throws when value is missing', () => {
  assert.throws(
    () => settingsWrite.create({ key: 'x' }, []),
    /config\.value is required/
  )
})

test('create accepts an explicit null value', () => {
  const handler = settingsWrite.create({ key: 'x', value: null }, [])
  assert.equal(typeof handler, 'function')
})

test('create accepts an explicit undefined value', () => {
  const handler = settingsWrite.create({ key: 'x', value: undefined }, [])
  assert.equal(typeof handler, 'function')
})

test('create throws when children is not an array', () => {
  assert.throws(
    () => settingsWrite.create({ key: 'x', value: 'v' }, null),
    /children must be an array/
  )
})

test('handler writes a literal value under a literal key', async () => {
  const handler = settingsWrite.create({ key: 'greeting', value: 'hi' }, [])
  const { ctx, writes } = createMockCtx()
  await handler(ctx, {})
  assert.equal(writes.length, 1)
  assert.equal(writes[0].key, 'greeting')
  assert.equal(writes[0].value, 'hi')
  assert.equal(writes[0].opts, undefined)
})

test('handler writes a room-scoped value when room is given', async () => {
  const handler = settingsWrite.create(
    { key: 'greeting', room: 'r_1', value: 'hi room' },
    []
  )
  const { ctx, writes } = createMockCtx()
  await handler(ctx, {})
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].opts, { room: 'r_1' })
})

test('handler resolves templates in key', async () => {
  const handler = settingsWrite.create({ key: 'token:{{service}}', value: 'x' }, [])
  const { ctx, writes } = createMockCtx()
  await handler(ctx, { service: 'github' })
  assert.equal(writes[0].key, 'token:github')
})

test('handler resolves templates in room', async () => {
  const handler = settingsWrite.create(
    { key: 'greeting', room: '{{roomId}}', value: 'x' },
    []
  )
  const { ctx, writes } = createMockCtx()
  await handler(ctx, { roomId: 'r_5' })
  assert.deepEqual(writes[0].opts, { room: 'r_5' })
})

test('handler resolves templates in value', async () => {
  const handler = settingsWrite.create(
    { key: 'last', value: { match: '{{match}}', at: '{{at}}' } },
    []
  )
  const { ctx, writes } = createMockCtx()
  await handler(ctx, { match: 'abc', at: 'now' })
  assert.deepEqual(writes[0].value, { match: 'abc', at: 'now' })
})

test('handler writes a value with preserved type when it is a single token', async () => {
  const handler = settingsWrite.create({ key: 'count', value: '{{n}}' }, [])
  const { ctx, writes } = createMockCtx()
  await handler(ctx, { n: 7 })
  assert.equal(writes[0].value, 7)
})

test('handler calls children after the write with the original input', async () => {
  const { child, calls } = createRecordingChild()
  const handler = settingsWrite.create({ key: 'k', value: 'v' }, [child])
  const { ctx, writes } = createMockCtx()
  const input = { match: 'x' }
  await handler(ctx, input)
  assert.equal(writes.length, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0], input)
})

test('handler calls all children in order', async () => {
  const first = createRecordingChild()
  const second = createRecordingChild()
  const handler = settingsWrite.create(
    { key: 'k', value: 'v' },
    [first.child, second.child]
  )
  const { ctx } = createMockCtx()
  await handler(ctx, { match: 'x' })
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 1)
  assert.equal(first.calls[0], second.calls[0])
})

test('handler supports zero children', async () => {
  const handler = settingsWrite.create({ key: 'k', value: 'v' }, [])
  const { ctx, writes } = createMockCtx()
  await handler(ctx, {})
  assert.equal(writes.length, 1)
})

test('handler throws when resolved key is empty', async () => {
  const handler = settingsWrite.create({ key: '{{name}}', value: 'v' }, [])
  const { ctx } = createMockCtx()
  await assert.rejects(
    () => handler(ctx, { name: '' }),
    /resolved key is empty/
  )
})

test('handler throws when resolved room is empty', async () => {
  const handler = settingsWrite.create(
    { key: 'k', room: '{{roomId}}', value: 'v' },
    []
  )
  const { ctx } = createMockCtx()
  await assert.rejects(
    () => handler(ctx, { roomId: '' }),
    /resolved room is empty/
  )
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'settings-write'), settingsWrite)
  assert.ok(Object.hasOwn(primitives.bot, 'settings-write'))
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
  assert.ok(Object.hasOwn(primitives.bot, 'send-local'))
  assert.ok(Object.hasOwn(primitives.bot, 'watch-pattern'))
  assert.ok(Object.hasOwn(primitives.bot, 'keyed-store'))
  assert.ok(Object.hasOwn(primitives.bot, 'expose-command'))
  assert.ok(Object.hasOwn(primitives.bot, 'schedule-task'))
  assert.ok(Object.hasOwn(primitives.bot, 'webhook-receive'))
  assert.ok(Object.hasOwn(primitives.bot, 'http-fetch'))
  assert.ok(Object.hasOwn(primitives.bot, 'settings-read'))
})
