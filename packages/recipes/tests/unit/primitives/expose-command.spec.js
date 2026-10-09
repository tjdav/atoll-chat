// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { exposeCommand } from '../../../src/primitives/expose-command.js'

/**
 * Builds a mock ArgsReader that returns values from a plain object.
 * @param {Record<string, unknown>} values - The backing values.
 * @returns {object} An ArgsReader-shaped mock.
 */
function createMockArgs (values) {
  return {
    get: (key) => values[key]
  }
}

/**
 * Builds a mock BotCtx. The handler under test only passes ctx
 * through to children.
 * @returns {object} A minimal ctx.
 */
function createMockCtx () {
  return {}
}

/**
 * Builds a child handler that records its invocations.
 * @returns {{ child: Function, calls: object[] }} The child and a
 *   mutable array of its payloads.
 */
function createRecordingChild () {
  const calls = []
  const child = async (ctx, payload) => {
    calls.push(payload)
  }
  return { child, calls }
}

test('expose-command has the expected shape', () => {
  assert.equal(exposeCommand.id, 'expose-command')
  assert.deepEqual(exposeCommand.targets, ['bot'])
  assert.deepEqual(exposeCommand.capabilities, ['read_commands'])
  assert.equal(typeof exposeCommand.label, 'string')
  assert.equal(typeof exposeCommand.description, 'string')
  assert.equal(typeof exposeCommand.configSchema, 'object')
  assert.equal(typeof exposeCommand.create, 'function')
})

test('config schema requires name', () => {
  assert.deepEqual(exposeCommand.configSchema.required, ['name'])
})

test('create throws when name is missing', () => {
  assert.throws(
    () => exposeCommand.create({}, []),
    /config\.name is required/
  )
})

test('create throws when name is empty', () => {
  assert.throws(
    () => exposeCommand.create({ name: '' }, []),
    /config\.name is required/
  )
})

test('create throws when name starts with uppercase', () => {
  assert.throws(
    () => exposeCommand.create({ name: 'Save' }, []),
    /must match \^\[a-z\]\[a-z0-9-\]\*\$$/
  )
})

test('create throws when name contains an underscore', () => {
  assert.throws(
    () => exposeCommand.create({ name: 'save_all' }, []),
    /must match \^\[a-z\]\[a-z0-9-\]\*\$$/
  )
})

test('create accepts a name with a hyphen', () => {
  const handler = exposeCommand.create({ name: 'save-bookmark' }, [async () => {}])
  assert.equal(typeof handler, 'function')
})

test('create throws when description is not a string', () => {
  assert.throws(
    () => exposeCommand.create({ name: 'save', description: 5 }, [async () => {}]),
    /config\.description must be a string/
  )
})

test('create throws when args is not a plain object', () => {
  assert.throws(
    () => exposeCommand.create({ name: 'save', args: [] }, [async () => {}]),
    /config\.args must be a plain object/
  )
})

test('create throws when args is null', () => {
  assert.throws(
    () => exposeCommand.create({ name: 'save', args: null }, [async () => {}]),
    /config\.args must be a plain object/
  )
})

test('create throws when children is not an array', () => {
  assert.throws(
    () => exposeCommand.create({ name: 'save' }, null),
    /children must be an array/
  )
})

test('create throws when there are no children', () => {
  assert.throws(
    () => exposeCommand.create({ name: 'save' }, []),
    /at least one child is required/
  )
})

test('handler calls children with args and command name', async () => {
  const { child, calls } = createRecordingChild()
  const handler = exposeCommand.create({ name: 'save' }, [child])
  const args = createMockArgs({ url: 'https://example.com' })
  await handler(createMockCtx(), { args })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args, args)
  assert.equal(calls[0].command, 'save')
})

test('handler calls all children in order', async () => {
  const first = createRecordingChild()
  const second = createRecordingChild()
  const handler = exposeCommand.create({ name: 'save' }, [first.child, second.child])
  const args = createMockArgs({ url: 'x' })
  await handler(createMockCtx(), { args })
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 1)
  assert.equal(first.calls[0].command, 'save')
  assert.equal(second.calls[0].command, 'save')
})

test('handler does nothing when input has no args', async () => {
  const { child, calls } = createRecordingChild()
  const handler = exposeCommand.create({ name: 'save' }, [child])
  await handler(createMockCtx(), {})
  assert.equal(calls.length, 0)
})

test('handler does nothing when args has no get method', async () => {
  const { child, calls } = createRecordingChild()
  const handler = exposeCommand.create({ name: 'save' }, [child])
  await handler(createMockCtx(), { args: { url: 'x' } })
  assert.equal(calls.length, 0)
})

test('handler does nothing when input is undefined', async () => {
  const { child, calls } = createRecordingChild()
  const handler = exposeCommand.create({ name: 'save' }, [child])
  await handler(createMockCtx(), undefined)
  assert.equal(calls.length, 0)
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'expose-command'), exposeCommand)
  assert.ok(Object.hasOwn(primitives.bot, 'expose-command'))
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
  assert.ok(Object.hasOwn(primitives.bot, 'send-local'))
  assert.ok(Object.hasOwn(primitives.bot, 'watch-pattern'))
  assert.ok(Object.hasOwn(primitives.bot, 'keyed-store'))
})
