// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { settingsRead } from '../../../src/primitives/settings-read.js'

/**
 * Builds a mock BotCtx whose settings store records reads and
 * returns configured values.
 * @param {Record<string, unknown>} values - Backing values, keyed by
 *   the string the store is called with.
 * @returns {{ ctx: object, reads: object[] }} The mock context and
 *   a mutable array of read calls.
 */
function createMockCtx (values) {
  const reads = []
  const ctx = {
    settings: {
      get: async (key, opts) => {
        reads.push({ key, opts })
        if (opts && typeof opts === 'object' && typeof opts.room === 'string') {
          return values[`room:${opts.room}:${key}`]
        }
        return values[key]
      }
    }
  }
  return { ctx, reads }
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

test('settings-read has the expected shape', () => {
  assert.equal(settingsRead.id, 'settings-read')
  assert.deepEqual(settingsRead.targets, ['bot'])
  assert.deepEqual(settingsRead.capabilities, [])
  assert.equal(typeof settingsRead.label, 'string')
  assert.equal(typeof settingsRead.description, 'string')
  assert.equal(typeof settingsRead.configSchema, 'object')
  assert.equal(typeof settingsRead.create, 'function')
})

test('config schema requires key', () => {
  assert.deepEqual(settingsRead.configSchema.required, ['key'])
})

test('create throws when key is missing', () => {
  assert.throws(
    () => settingsRead.create({}, [async () => {}]),
    /config\.key is required/
  )
})

test('create throws when key is empty', () => {
  assert.throws(
    () => settingsRead.create({ key: '' }, [async () => {}]),
    /config\.key is required/
  )
})

test('create throws when room is empty', () => {
  assert.throws(
    () => settingsRead.create({ key: 'x', room: '' }, [async () => {}]),
    /config\.room must be a non-empty string/
  )
})

test('create throws when children is not an array', () => {
  assert.throws(
    () => settingsRead.create({ key: 'x' }, null),
    /children must be an array/
  )
})

test('create throws when there are no children', () => {
  assert.throws(
    () => settingsRead.create({ key: 'x' }, []),
    /at least one child is required/
  )
})

test('handler reads the user-scoped setting when no room is given', async () => {
  const { child, calls } = createRecordingChild()
  const handler = settingsRead.create({ key: 'greeting' }, [child])
  const { ctx, reads } = createMockCtx({ greeting: 'hello' })
  await handler(ctx, {})
  assert.equal(reads.length, 1)
  assert.equal(reads[0].key, 'greeting')
  assert.equal(reads[0].opts, undefined)
  assert.equal(calls[0], 'hello')
})

test('handler reads the room-scoped setting when room is given', async () => {
  const { child, calls } = createRecordingChild()
  const handler = settingsRead.create({ key: 'greeting', room: 'r_1' }, [child])
  const { ctx, reads } = createMockCtx({ 'room:r_1:greeting': 'hi room' })
  await handler(ctx, {})
  assert.equal(reads.length, 1)
  assert.equal(reads[0].key, 'greeting')
  assert.deepEqual(reads[0].opts, { room: 'r_1' })
  assert.equal(calls[0], 'hi room')
})

test('handler resolves templates in key', async () => {
  const { child, calls } = createRecordingChild()
  const handler = settingsRead.create({ key: 'token:{{service}}' }, [child])
  const { ctx, reads } = createMockCtx({ 'token:github': 'abc123' })
  await handler(ctx, { service: 'github' })
  assert.equal(reads[0].key, 'token:github')
  assert.equal(calls[0], 'abc123')
})

test('handler resolves templates in room', async () => {
  const { child, calls } = createRecordingChild()
  const handler = settingsRead.create({ key: 'greeting', room: '{{roomId}}' }, [child])
  const { ctx, reads } = createMockCtx({ 'room:r_5:greeting': 'hi five' })
  await handler(ctx, { roomId: 'r_5' })
  assert.deepEqual(reads[0].opts, { room: 'r_5' })
  assert.equal(calls[0], 'hi five')
})

test('handler passes undefined to children when setting is unset', async () => {
  const { child, calls } = createRecordingChild()
  const handler = settingsRead.create({ key: 'missing' }, [child])
  const { ctx } = createMockCtx({})
  await handler(ctx, {})
  assert.equal(calls.length, 1)
  assert.equal(calls[0], undefined)
})

test('handler passes object values unchanged', async () => {
  const { child, calls } = createRecordingChild()
  const handler = settingsRead.create({ key: 'config' }, [child])
  const { ctx } = createMockCtx({ config: { a: 1, b: ['x'] } })
  await handler(ctx, {})
  assert.deepEqual(calls[0], { a: 1, b: ['x'] })
})

test('handler calls all children in order', async () => {
  const first = createRecordingChild()
  const second = createRecordingChild()
  const handler = settingsRead.create({ key: 'greeting' }, [first.child, second.child])
  const { ctx } = createMockCtx({ greeting: 'hi' })
  await handler(ctx, {})
  assert.equal(first.calls[0], 'hi')
  assert.equal(second.calls[0], 'hi')
})

test('handler throws when resolved key is empty', async () => {
  const { child } = createRecordingChild()
  const handler = settingsRead.create({ key: '{{name}}' }, [child])
  const { ctx } = createMockCtx({})
  await assert.rejects(
    () => handler(ctx, { name: '' }),
    /resolved key is empty/
  )
})

test('handler throws when resolved room is empty', async () => {
  const { child } = createRecordingChild()
  const handler = settingsRead.create({ key: 'x', room: '{{roomId}}' }, [child])
  const { ctx } = createMockCtx({})
  await assert.rejects(
    () => handler(ctx, { roomId: '' }),
    /resolved room is empty/
  )
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'settings-read'), settingsRead)
  assert.ok(Object.hasOwn(primitives.bot, 'settings-read'))
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
  assert.ok(Object.hasOwn(primitives.bot, 'send-local'))
  assert.ok(Object.hasOwn(primitives.bot, 'watch-pattern'))
  assert.ok(Object.hasOwn(primitives.bot, 'keyed-store'))
  assert.ok(Object.hasOwn(primitives.bot, 'expose-command'))
  assert.ok(Object.hasOwn(primitives.bot, 'schedule-task'))
  assert.ok(Object.hasOwn(primitives.bot, 'webhook-receive'))
  assert.ok(Object.hasOwn(primitives.bot, 'http-fetch'))
})
