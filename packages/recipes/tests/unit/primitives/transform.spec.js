// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { transform } from '../../../src/primitives/transform.js'

/**
 * Builds a mock BotCtx. The handler under test only passes ctx
 * through to children.
 * @returns {object} A minimal ctx.
 */
function createMockCtx () {
  return {}
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

test('transform has the expected shape', () => {
  assert.equal(transform.id, 'transform')
  assert.deepEqual(transform.targets, ['bot'])
  assert.deepEqual(transform.capabilities, [])
  assert.equal(typeof transform.label, 'string')
  assert.equal(typeof transform.description, 'string')
  assert.equal(typeof transform.configSchema, 'object')
  assert.equal(typeof transform.create, 'function')
})

test('config schema requires op', () => {
  assert.deepEqual(transform.configSchema.required, ['op'])
})

test('create throws when op is missing', () => {
  assert.throws(
    () => transform.create({}, [async () => {}]),
    /config\.op must be one of json, stringify, pick/
  )
})

test('create throws when op is invalid', () => {
  assert.throws(
    () => transform.create({ op: 'shuffle' }, [async () => {}]),
    /config\.op must be one of json, stringify, pick/
  )
})

test('create throws when pick is missing path', () => {
  assert.throws(
    () => transform.create({ op: 'pick' }, [async () => {}]),
    /config\.path is required when op is "pick"/
  )
})

test('create throws when pick has empty path', () => {
  assert.throws(
    () => transform.create({ op: 'pick', path: '' }, [async () => {}]),
    /config\.path is required when op is "pick"/
  )
})

test('create throws when non-pick has a path', () => {
  assert.throws(
    () => transform.create({ op: 'json', path: 'a' }, [async () => {}]),
    /config\.path is only valid when op is "pick"/
  )
})

test('create throws when children is not an array', () => {
  assert.throws(
    () => transform.create({ op: 'json' }, null),
    /children must be an array/
  )
})

test('create throws when there are no children', () => {
  assert.throws(
    () => transform.create({ op: 'json' }, []),
    /at least one child is required/
  )
})

test('json op parses a valid JSON string', async () => {
  const { child, calls } = createRecordingChild()
  const handler = transform.create({ op: 'json' }, [child])
  await handler(createMockCtx(), '{"items":[1,2,3]}')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { items: [1, 2, 3] })
})

test('json op parses a JSON array', async () => {
  const { child, calls } = createRecordingChild()
  const handler = transform.create({ op: 'json' }, [child])
  await handler(createMockCtx(), '[1,2,3]')
  assert.deepEqual(calls[0], [1, 2, 3])
})

test('json op parses a JSON number', async () => {
  const { child, calls } = createRecordingChild()
  const handler = transform.create({ op: 'json' }, [child])
  await handler(createMockCtx(), '42')
  assert.equal(calls[0], 42)
})

test('json op throws on invalid JSON', async () => {
  const { child } = createRecordingChild()
  const handler = transform.create({ op: 'json' }, [child])
  await assert.rejects(
    () => handler(createMockCtx(), 'not json'),
    /input is not valid JSON/
  )
})

test('json op throws when input is not a string', async () => {
  const { child } = createRecordingChild()
  const handler = transform.create({ op: 'json' }, [child])
  await assert.rejects(
    () => handler(createMockCtx(), { a: 1 }),
    /op "json" requires a string input/
  )
})

test('stringify op serializes an object', async () => {
  const { child, calls } = createRecordingChild()
  const handler = transform.create({ op: 'stringify' }, [child])
  await handler(createMockCtx(), { a: 1, b: [2, 3] })
  assert.equal(calls[0], '{"a":1,"b":[2,3]}')
})

test('stringify op serializes a string', async () => {
  const { child, calls } = createRecordingChild()
  const handler = transform.create({ op: 'stringify' }, [child])
  await handler(createMockCtx(), 'hello')
  assert.equal(calls[0], '"hello"')
})

test('stringify op serializes null', async () => {
  const { child, calls } = createRecordingChild()
  const handler = transform.create({ op: 'stringify' }, [child])
  await handler(createMockCtx(), null)
  assert.equal(calls[0], 'null')
})

test('stringify op throws on circular references', async () => {
  const { child } = createRecordingChild()
  const handler = transform.create({ op: 'stringify' }, [child])
  const circular = { a: 1 }
  circular.self = circular
  await assert.rejects(
    () => handler(createMockCtx(), circular),
    /input is not serializable/
  )
})

test('pick op extracts a top-level field', async () => {
  const { child, calls } = createRecordingChild()
  const handler = transform.create({ op: 'pick', path: 'title' }, [child])
  await handler(createMockCtx(), { title: 'Hello', body: 'x' })
  assert.equal(calls[0], 'Hello')
})

test('pick op extracts a nested field', async () => {
  const { child, calls } = createRecordingChild()
  const handler = transform.create({ op: 'pick', path: 'commit.message' }, [child])
  await handler(createMockCtx(), { commit: { message: 'fix: bug' } })
  assert.equal(calls[0], 'fix: bug')
})

test('pick op extracts an array index', async () => {
  const { child, calls } = createRecordingChild()
  const handler = transform.create({ op: 'pick', path: 'items.0.url' }, [child])
  await handler(createMockCtx(), { items: [{ url: 'https://example.com' }] })
  assert.equal(calls[0], 'https://example.com')
})

test('pick op passes the whole object when path is a single segment', async () => {
  const { child, calls } = createRecordingChild()
  const handler = transform.create({ op: 'pick', path: 'nested' }, [child])
  const nested = { a: 1 }
  await handler(createMockCtx(), { nested })
  assert.equal(calls[0], nested)
})

test('pick op throws when the path is unresolvable', async () => {
  const { child } = createRecordingChild()
  const handler = transform.create({ op: 'pick', path: 'missing.field' }, [child])
  await assert.rejects(
    () => handler(createMockCtx(), { other: 1 }),
    /path "missing.field" is not resolvable/
  )
})

test('handler calls all children in order', async () => {
  const first = createRecordingChild()
  const second = createRecordingChild()
  const handler = transform.create({ op: 'json' }, [first.child, second.child])
  await handler(createMockCtx(), '{"x":1}')
  assert.deepEqual(first.calls[0], { x: 1 })
  assert.deepEqual(second.calls[0], { x: 1 })
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'transform'), transform)
  assert.ok(Object.hasOwn(primitives.bot, 'transform'))
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
})
