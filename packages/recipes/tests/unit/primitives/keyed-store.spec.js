// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { keyedStore } from '../../../src/primitives/keyed-store.js'

/**
 * Builds a mock BotCtx with an in-memory storage map.
 * @param {Record<string, unknown>} [initial] - Initial storage values.
 * @returns {{ ctx: object, store: Map<string, unknown> }} The mock
 *   context and its backing store.
 */
function createMockCtx (initial) {
  const store = new Map(Object.entries(initial ?? {}))
  const ctx = {
    storage: {
      get: async (key) => store.get(key),
      set: async (key, value) => {
        store.set(key, value)
      }
    }
  }
  return { ctx, store }
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

test('keyed-store has the expected shape', () => {
  assert.equal(keyedStore.id, 'keyed-store')
  assert.deepEqual(keyedStore.targets, ['bot'])
  assert.deepEqual(keyedStore.capabilities, [])
  assert.equal(typeof keyedStore.label, 'string')
  assert.equal(typeof keyedStore.description, 'string')
  assert.equal(typeof keyedStore.configSchema, 'object')
  assert.equal(typeof keyedStore.create, 'function')
})

test('config schema requires key', () => {
  assert.deepEqual(keyedStore.configSchema.required, ['key'])
})

test('create throws when key is missing', () => {
  assert.throws(
    () => keyedStore.create({}, []),
    /config\.key is required/
  )
})

test('create throws when key is empty', () => {
  assert.throws(
    () => keyedStore.create({ key: '' }, []),
    /config\.key is required/
  )
})

test('create throws when mode is invalid', () => {
  assert.throws(
    () => keyedStore.create({ key: 'k', mode: 'delete' }, []),
    /config\.mode must be "set" or "get"/
  )
})

test('create throws when get mode has no children', () => {
  assert.throws(
    () => keyedStore.create({ key: 'k', mode: 'get' }, []),
    /mode "get" requires at least one child/
  )
})

test('create throws when children is not an array', () => {
  assert.throws(
    () => keyedStore.create({ key: 'k' }, null),
    /children must be an array/
  )
})

test('set mode writes a literal value under a literal key', async () => {
  const handler = keyedStore.create({ key: 'greeting', value: 'hi' }, [])
  const { ctx, store } = createMockCtx()
  await handler(ctx, {})
  assert.equal(store.get('greeting'), 'hi')
})

test('set mode resolves {{path}} in key', async () => {
  const handler = keyedStore.create({ key: 'item:{{match}}', value: 'x' }, [])
  const { ctx, store } = createMockCtx()
  await handler(ctx, { match: 'abc' })
  assert.equal(store.get('item:abc'), 'x')
})

test('set mode resolves {{path}} in value', async () => {
  const handler = keyedStore.create(
    { key: 'k', value: { url: '{{match}}', at: 'now' } },
    []
  )
  const { ctx, store } = createMockCtx()
  await handler(ctx, { match: 'https://example.com' })
  assert.deepEqual(store.get('k'), {
    url: 'https://example.com',
    at: 'now'
  })
})

test('set mode stores the whole input when value is omitted', async () => {
  const handler = keyedStore.create({ key: 'k' }, [])
  const { ctx, store } = createMockCtx()
  const input = { match: 'x', event: { id: 'e_1' } }
  await handler(ctx, input)
  assert.equal(store.get('k'), input)
})

test('set mode throws when resolved key is empty', async () => {
  const handler = keyedStore.create({ key: '{{match}}' }, [])
  const { ctx } = createMockCtx()
  await assert.rejects(
    () => handler(ctx, { match: '' }),
    /resolved key is empty/
  )
})

test('get mode passes the stored value to children', async () => {
  const { child, calls } = createRecordingChild()
  const handler = keyedStore.create({ key: 'k', mode: 'get' }, [child])
  const { ctx } = createMockCtx({ k: { stored: true } })
  await handler(ctx, {})
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { stored: true })
})

test('get mode passes undefined to children when key is missing', async () => {
  const { child, calls } = createRecordingChild()
  const handler = keyedStore.create({ key: 'k', mode: 'get' }, [child])
  const { ctx } = createMockCtx()
  await handler(ctx, {})
  assert.equal(calls.length, 1)
  assert.equal(calls[0], undefined)
})

test('get mode resolves {{path}} in key', async () => {
  const { child, calls } = createRecordingChild()
  const handler = keyedStore.create(
    { key: 'item:{{match}}', mode: 'get' },
    [child]
  )
  const { ctx } = createMockCtx({ 'item:abc': 'stored' })
  await handler(ctx, { match: 'abc' })
  assert.equal(calls[0], 'stored')
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'keyed-store'), keyedStore)
  assert.ok(Object.hasOwn(primitives.bot, 'keyed-store'))
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
  assert.ok(Object.hasOwn(primitives.bot, 'send-local'))
  assert.ok(Object.hasOwn(primitives.bot, 'watch-pattern'))
})
