// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { watchPattern } from '../../../src/primitives/watch-pattern.js'

/**
 * Builds a mock BotCtx that does nothing. The handler under test
 * only passes ctx through to children.
 * @returns {object} A minimal ctx.
 */
function createMockCtx () {
  return {}
}

/**
 * Builds a mock message event with the given plaintext.
 * @param {string | null} plaintext - The message text, or null.
 * @returns {object} A message event.
 */
function createMessageEvent (plaintext) {
  return {
    id: 'e_1',
    type: 'message.new',
    roomId: 'r_1',
    timestamp: '2026-01-01T00:00:00Z',
    data: {
      id: 'm_1',
      plaintext
    }
  }
}

/**
 * Builds a child handler that records its invocations.
 * @returns {{ child: Handler, calls: Record<string, unknown>[] }} The child and a
 *   mutable array of its call records.
 */
function createRecordingChild () {
  /** @type {Record<string, unknown>[]} */
  const calls = []
  /** @type {Handler} */
  const child = (_ctx, payload) => {
    /** @type {any} */
    const record = payload
    calls.push(record)
    return undefined
  }
  return {
    child,
    calls
  }
}

test('watch-pattern has the expected shape', () => {
  assert.equal(watchPattern.id, 'watch-pattern')
  assert.deepEqual(watchPattern.targets, ['bot'])
  assert.deepEqual(watchPattern.capabilities, ['read_content'])
  assert.equal(typeof watchPattern.label, 'string')
  assert.equal(typeof watchPattern.description, 'string')
  assert.equal(typeof watchPattern.configSchema, 'object')
  assert.equal(typeof watchPattern.create, 'function')
})

test('config schema requires pattern', () => {
  /** @type {Record<string, any>} */
  const schema = watchPattern.configSchema
  assert.deepEqual(schema.required, ['pattern'])
  assert.equal(schema.properties.pattern.type, 'string')
})

test('create throws when pattern is missing', () => {
  assert.throws(
    () => watchPattern.create({}, []),
    /config\.pattern is required/
  )
})

test('create throws when pattern is empty', () => {
  assert.throws(
    () => watchPattern.create({ pattern: '' }, []),
    /config\.pattern is required/
  )
})

test('create throws when pattern is not a valid regex', () => {
  assert.throws(
    () => watchPattern.create({ pattern: '(' }, []),
    /invalid pattern/
  )
})

test('create throws when flags is not a string', () => {
  assert.throws(
    () => watchPattern.create({
      pattern: 'x',
      flags: 5
    }, []),
    /config\.flags must be a string/
  )
})

test('create throws when enabled is not a boolean', () => {
  assert.throws(
    () => watchPattern.create({
      pattern: 'x',
      enabled: 'yes'
    }, []),
    /config\.enabled must be a boolean/
  )
})

test('create throws when children is not an array', () => {
  /** @type {any} */
  const invalidChildren = null
  assert.throws(
    () => watchPattern.create({ pattern: 'x' }, invalidChildren),
    /children must be an array/
  )
})

test('handler calls children when the pattern matches', async () => {
  const { child, calls } = createRecordingChild()
  const handler = watchPattern.create({ pattern: 'https?://\\S+' }, [child])
  const event = createMessageEvent('check this out https://example.com')
  await handler(createMockCtx(), event)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.match, 'https://example.com')
  assert.equal(calls[0]?.event, event)
})

test('handler does not call children when the pattern does not match', async () => {
  const { child, calls } = createRecordingChild()
  const handler = watchPattern.create({ pattern: 'https?://\\S+' }, [child])
  const event = createMessageEvent('no link here')
  await handler(createMockCtx(), event)
  assert.equal(calls.length, 0)
})

test('handler does nothing when enabled is false', async () => {
  const { child, calls } = createRecordingChild()
  const handler = watchPattern.create({
    pattern: '.*',
    enabled: false
  }, [child])
  const event = createMessageEvent('anything')
  await handler(createMockCtx(), event)
  assert.equal(calls.length, 0)
})

test('handler ignores events with no data', async () => {
  const { child, calls } = createRecordingChild()
  const handler = watchPattern.create({ pattern: '.*' }, [child])
  await handler(createMockCtx(), { id: 'e_1' })
  assert.equal(calls.length, 0)
})

test('handler ignores observer-mode events with no plaintext', async () => {
  const { child, calls } = createRecordingChild()
  const handler = watchPattern.create({ pattern: '.*' }, [child])
  const event = {
    id: 'e_1',
    data: {
      id: 'm_1',
      sizeBytes: 512
    }
  }
  await handler(createMockCtx(), event)
  assert.equal(calls.length, 0)
})

test('handler ignores events whose plaintext is null', async () => {
  const { child, calls } = createRecordingChild()
  const handler = watchPattern.create({ pattern: '.*' }, [child])
  await handler(createMockCtx(), createMessageEvent(null))
  assert.equal(calls.length, 0)
})

test('handler calls all children in order', async () => {
  const first = createRecordingChild()
  const second = createRecordingChild()
  const handler = watchPattern.create({ pattern: '\\w+' }, [first.child, second.child])
  const event = createMessageEvent('hello')
  await handler(createMockCtx(), event)
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 1)
  assert.equal(first.calls[0]?.match, 'hello')
  assert.equal(second.calls[0]?.match, 'hello')
})

test('handler applies regex flags when given', async () => {
  const { child, calls } = createRecordingChild()
  const handler = watchPattern.create({
    pattern: 'hello',
    flags: 'i'
  }, [child])
  const event = createMessageEvent('HELLO world')
  await handler(createMockCtx(), event)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.match, 'HELLO')
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'watch-pattern'), watchPattern)
  assert.ok(Object.hasOwn(primitives.bot, 'watch-pattern'))
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
  assert.ok(Object.hasOwn(primitives.bot, 'send-local'))
})
