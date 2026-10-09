// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { scheduleTask } from '../../../src/primitives/schedule-task.js'

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

test('schedule-task has the expected shape', () => {
  assert.equal(scheduleTask.id, 'schedule-task')
  assert.deepEqual(scheduleTask.targets, ['bot'])
  assert.deepEqual(scheduleTask.capabilities, [])
  assert.equal(typeof scheduleTask.label, 'string')
  assert.equal(typeof scheduleTask.description, 'string')
  assert.equal(typeof scheduleTask.configSchema, 'object')
  assert.equal(typeof scheduleTask.create, 'function')
})

test('config schema requires name and cron', () => {
  assert.deepEqual(scheduleTask.configSchema.required, ['name', 'cron'])
})

test('create throws when name is missing', () => {
  assert.throws(
    () => scheduleTask.create({ cron: '0 9 * * *' }, [async () => {}]),
    /config\.name is required/
  )
})

test('create throws when name is invalid', () => {
  assert.throws(
    () => scheduleTask.create({ name: 'Daily_Digest', cron: '0 9 * * *' }, [async () => {}]),
    /must match \^\[a-z\]\[a-z0-9-\]\*\$$/
  )
})

test('create throws when cron is missing', () => {
  assert.throws(
    () => scheduleTask.create({ name: 'digest' }, [async () => {}]),
    /config\.cron is required/
  )
})

test('create throws when cron is empty', () => {
  assert.throws(
    () => scheduleTask.create({ name: 'digest', cron: '' }, [async () => {}]),
    /config\.cron is required/
  )
})

test('create throws when cron has too few fields', () => {
  assert.throws(
    () => scheduleTask.create({ name: 'digest', cron: '0 9 *' }, [async () => {}]),
    /must have exactly 5 fields, got 3/
  )
})

test('create throws when cron has too many fields', () => {
  assert.throws(
    () => scheduleTask.create({ name: 'digest', cron: '0 9 * * * *' }, [async () => {}]),
    /must have exactly 5 fields, got 6/
  )
})

test('create accepts a standard five-field cron', () => {
  const handler = scheduleTask.create(
    { name: 'digest', cron: '0 9 * * 1' },
    [async () => {}]
  )
  assert.equal(typeof handler, 'function')
})

test('create accepts a timezone string', () => {
  const handler = scheduleTask.create(
    { name: 'digest', cron: '0 9 * * *', timezone: 'Europe/Madrid' },
    [async () => {}]
  )
  assert.equal(typeof handler, 'function')
})

test('create throws when timezone is not a string', () => {
  assert.throws(
    () => scheduleTask.create(
      { name: 'digest', cron: '0 9 * * *', timezone: 5 },
      [async () => {}]
    ),
    /config\.timezone must be a string/
  )
})

test('create throws when children is not an array', () => {
  assert.throws(
    () => scheduleTask.create({ name: 'digest', cron: '0 9 * * *' }, null),
    /children must be an array/
  )
})

test('create throws when there are no children', () => {
  assert.throws(
    () => scheduleTask.create({ name: 'digest', cron: '0 9 * * *' }, []),
    /at least one child is required/
  )
})

test('handler calls children with the schedule name and a timestamp', async () => {
  const { child, calls } = createRecordingChild()
  const handler = scheduleTask.create(
    { name: 'digest', cron: '0 9 * * *' },
    [child]
  )
  const firedAt = '2026-10-09T09:00:00.000Z'
  await handler(createMockCtx(), { firedAt })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'digest')
  assert.equal(calls[0].firedAt, firedAt)
})

test('handler synthesizes a firedAt when input is undefined', async () => {
  const { child, calls } = createRecordingChild()
  const handler = scheduleTask.create(
    { name: 'digest', cron: '0 9 * * *' },
    [child]
  )
  await handler(createMockCtx(), undefined)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'digest')
  assert.equal(typeof calls[0].firedAt, 'string')
  assert.ok(!Number.isNaN(Date.parse(calls[0].firedAt)))
})

test('handler synthesizes a firedAt when input lacks it', async () => {
  const { child, calls } = createRecordingChild()
  const handler = scheduleTask.create(
    { name: 'digest', cron: '0 9 * * *' },
    [child]
  )
  await handler(createMockCtx(), { other: true })
  assert.equal(calls.length, 1)
  assert.equal(typeof calls[0].firedAt, 'string')
  assert.ok(!Number.isNaN(Date.parse(calls[0].firedAt)))
})

test('handler calls all children in order', async () => {
  const first = createRecordingChild()
  const second = createRecordingChild()
  const handler = scheduleTask.create(
    { name: 'digest', cron: '0 9 * * *' },
    [first.child, second.child]
  )
  await handler(createMockCtx(), { firedAt: '2026-10-09T09:00:00.000Z' })
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 1)
  assert.equal(first.calls[0].name, 'digest')
  assert.equal(second.calls[0].name, 'digest')
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'schedule-task'), scheduleTask)
  assert.ok(Object.hasOwn(primitives.bot, 'schedule-task'))
  assert.ok(Object.hasOwn(primitives.bot, 'post-response'))
  assert.ok(Object.hasOwn(primitives.bot, 'send-local'))
  assert.ok(Object.hasOwn(primitives.bot, 'watch-pattern'))
  assert.ok(Object.hasOwn(primitives.bot, 'keyed-store'))
  assert.ok(Object.hasOwn(primitives.bot, 'expose-command'))
  assert.ok(Object.hasOwn(primitives.bot, 'webhook-receive'))
})
