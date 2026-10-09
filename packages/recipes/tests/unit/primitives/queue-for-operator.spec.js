// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { queueForOperator } from '../../../src/primitives/queue-for-operator.js'

/**
 * Builds a mock BotCtx with an in-memory storage map that records
 * every write.
 * @returns {{ ctx: object, store: Map<string, unknown>, writes: object[] }} The mock context, its backing store, and a record of writes.
 */
function createMockCtx () {
  const store = new Map()
  const writes = []
  const ctx = {
    storage: {
      set: async (key, value) => {
        writes.push({ key, value })
        store.set(key, value)
      },
      get: async (key) => store.get(key)
    }
  }
  return { ctx, store, writes }
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

test('queue-for-operator has the expected shape', () => {
  assert.equal(queueForOperator.id, 'queue-for-operator')
  assert.deepEqual(queueForOperator.targets, ['bot'])
  assert.deepEqual(queueForOperator.capabilities, [])
  assert.equal(typeof queueForOperator.label, 'string')
  assert.equal(typeof queueForOperator.description, 'string')
  assert.equal(typeof queueForOperator.configSchema, 'object')
  assert.equal(typeof queueForOperator.create, 'function')
})

test('config schema has no required fields', () => {
  assert.equal(Object.hasOwn(queueForOperator.configSchema, 'required'), false)
})

test('create throws when audience is invalid', () => {
  assert.throws(
    () => queueForOperator.create({ audience: 'group' }, [async () => {}]),
    /config\.audience must be one of private, public/
  )
})

test('create throws when timeout is invalid', () => {
  assert.throws(
    () => queueForOperator.create({ timeout: '5m' }, [async () => {}]),
    /config\.timeout must be "never" or a positive integer/
  )
})

test('create throws when timeout is zero', () => {
  assert.throws(
    () => queueForOperator.create({ timeout: '0' }, [async () => {}]),
    /config\.timeout must be "never" or a positive integer/
  )
})

test('create throws when timeout is negative', () => {
  assert.throws(
    () => queueForOperator.create({ timeout: '-5' }, [async () => {}]),
    /config\.timeout must be "never" or a positive integer/
  )
})

test('create throws when onTimeout is invalid', () => {
  assert.throws(
    () => queueForOperator.create({ onTimeout: 'reply' }, [async () => {}]),
    /config\.onTimeout must be one of ignore, canned/
  )
})

test('create throws when onTimeout is canned but cannedResponse is missing', () => {
  assert.throws(
    () => queueForOperator.create({ onTimeout: 'canned' }, [async () => {}]),
    /config\.cannedResponse is required when onTimeout is "canned"/
  )
})

test('create throws when cannedResponse is set but onTimeout is ignore', () => {
  assert.throws(
    () => queueForOperator.create({ cannedResponse: 'x' }, [async () => {}]),
    /config\.cannedResponse is only valid when onTimeout is "canned"/
  )
})

test('create throws when requestId is empty', () => {
  assert.throws(
    () => queueForOperator.create({ requestId: '' }, [async () => {}]),
    /config\.requestId must be a non-empty string/
  )
})

test('create throws when children is not an array', () => {
  assert.throws(
    () => queueForOperator.create({}, null),
    /children must be an array/
  )
})

test('create throws when there are no children', () => {
  assert.throws(
    () => queueForOperator.create({}, []),
    /at least one child is required/
  )
})

test('handler writes a queue entry to storage', async () => {
  const { child } = createRecordingChild()
  const handler = queueForOperator.create({}, [child])
  const { ctx, writes, store } = createMockCtx()
  const input = { question: 'What does the goblin do?' }
  await handler(ctx, input)
  assert.equal(writes.length, 1)
  assert.match(writes[0].key, /^operator:queue:/)
})

test('queue entry carries the request payload', async () => {
  const { child } = createRecordingChild()
  const handler = queueForOperator.create({}, [child])
  const { ctx, store } = createMockCtx()
  const input = { question: 'What does the goblin do?' }
  await handler(ctx, input)
  const keys = Array.from(store.keys())
  const entry = store.get(keys[0])
  assert.equal(entry.payload, input)
  assert.equal(entry.status, 'pending')
  assert.equal(typeof entry.queuedAt, 'string')
  assert.ok(!Number.isNaN(Date.parse(entry.queuedAt)))
  assert.equal(typeof entry.requestId, 'string')
  assert.ok(entry.requestId.length > 0)
})

test('queue entry defaults to private audience and never timeout', async () => {
  const { child } = createRecordingChild()
  const handler = queueForOperator.create({}, [child])
  const { ctx, store } = createMockCtx()
  await handler(ctx, {})
  const entry = store.get(Array.from(store.keys())[0])
  assert.equal(entry.audience, 'private')
  assert.equal(entry.timeout, 'never')
  assert.equal(entry.onTimeout, 'ignore')
  assert.equal(Object.hasOwn(entry, 'cannedResponse'), false)
})

test('queue entry carries a canned response when configured', async () => {
  const { child } = createRecordingChild()
  const handler = queueForOperator.create(
    { onTimeout: 'canned', timeout: '30', cannedResponse: 'The goblin is asleep.' },
    [child]
  )
  const { ctx, store } = createMockCtx()
  await handler(ctx, {})
  const entry = store.get(Array.from(store.keys())[0])
  assert.equal(entry.timeout, '30')
  assert.equal(entry.onTimeout, 'canned')
  assert.equal(entry.cannedResponse, 'The goblin is asleep.')
})

test('handler uses the configured requestId when given', async () => {
  const { child } = createRecordingChild()
  const handler = queueForOperator.create({ requestId: 'fixed-1' }, [child])
  const { ctx, store } = createMockCtx()
  await handler(ctx, {})
  assert.ok(store.has('operator:queue:fixed-1'))
})

test('handler resolves templates in the requestId', async () => {
  const { child } = createRecordingChild()
  const handler = queueForOperator.create(
    { requestId: 'req-{{eventId}}' },
    [child]
  )
  const { ctx, store } = createMockCtx()
  await handler(ctx, { eventId: 'evt_42' })
  assert.ok(store.has('operator:queue:req-evt_42'))
})

test('handler throws when resolved requestId is empty', async () => {
  const { child } = createRecordingChild()
  const handler = queueForOperator.create({ requestId: '{{id}}' }, [child])
  const { ctx } = createMockCtx()
  await assert.rejects(
    () => handler(ctx, { id: '' }),
    /resolved requestId is empty/
  )
})

test('handler does not invoke children in v1', async () => {
  const { child, calls } = createRecordingChild()
  const handler = queueForOperator.create({}, [child])
  const { ctx } = createMockCtx()
  await handler(ctx, { question: 'anything' })
  assert.equal(calls.length, 0)
})

test('handler writes a separate entry per invocation', async () => {
  const { child } = createRecordingChild()
  const handler = queueForOperator.create({}, [child])
  const { ctx, store } = createMockCtx()
  await handler(ctx, { n: 1 })
  await handler(ctx, { n: 2 })
  assert.equal(store.size, 2)
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'queue-for-operator'), queueForOperator)
  assert.ok(Object.hasOwn(primitives.bot, 'queue-for-operator'))
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
