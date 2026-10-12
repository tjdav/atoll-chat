// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compile } from '../../../src/compiler/index.js'
import { loadRecipeById, scanLibrary } from '../../../src/recipe/library.js'
import { loadEmittedBot } from './_helpers/load-emitted-bot.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB_ROOT = join(HERE, '..', '..', '..', 'recipes')

const TEST_ROOM = 'r_test_room'

/**
 * Compiles the daily-reminder recipe with test slot values.
 * @param {object} [slots] - Slot overrides.
 * @returns {Promise<object>} The BotScript.
 */
async function build (slots) {
  return compile(
    LIB_ROOT,
    {
      recipeId: 'daily-reminder',
      recipeVersion: '1.0.0',
      slots: { roomId: TEST_ROOM, ...(slots ?? {}) }
    },
    { botId: 'com.example.daily-reminder', label: 'Daily Reminder' }
  )
}

test('the recipe is present in the library and validates', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'daily-reminder')
  assert.equal(recipe.id, 'daily-reminder')
  assert.equal(recipe.version, '1.0.0')
  assert.equal(recipe.kind, 'pure')
})

test('the recipe declares the roomId, cron, and timezone slots', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'daily-reminder')
  const names = recipe.slots.map((s) => s.name).sort()
  assert.deepEqual(names, ['cron', 'roomId', 'timezone'])
  const byName = Object.fromEntries(recipe.slots.map((s) => [s.name, s]))
  assert.equal(byName.roomId.required, true)
  assert.equal(byName.cron.default, '0 9 * * *')
  assert.equal(byName.timezone.default, 'UTC')
})

test('the recipe declares a user-scoped message setting', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'daily-reminder')
  assert.ok(recipe.settings)
  assert.ok(recipe.settings.message)
  assert.equal(recipe.settings.message.scope, 'user')
  assert.equal(recipe.settings.message.default, 'Daily check-in')
})

test('the recipe declares a schedule-task trigger', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'daily-reminder')
  assert.ok(Array.isArray(recipe.triggers))
  assert.equal(recipe.triggers.length, 1)
  assert.equal(recipe.triggers[0].primitive, 'schedule-task')
})

test('the recipe declares the post_message capability only', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'daily-reminder')
  assert.deepEqual(recipe.capabilities, ['post_message'])
})

test('the recipe compiles with the required roomId slot', async () => {
  const script = await build()
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'daily-reminder')
  assert.equal(script.composition.target, 'bot')
})

test('the composer throws when the required roomId slot is missing', async () => {
  await assert.rejects(
    () => compile(
      LIB_ROOT,
      { recipeId: 'daily-reminder', recipeVersion: '1.0.0', slots: {} },
      { botId: 'com.example.daily-reminder', label: 'Daily Reminder' }
    ),
    /slot "roomId" is required and has no default/
  )
})

test('the roomId slot substitutes into the trigger and install handler configs', async () => {
  const script = await build()
  const trigger = script.composition.triggers[0]
  const post = trigger.children[0].children[0]
  assert.equal(post.config.roomId, TEST_ROOM)

  const install = script.composition.handlers.install
  assert.equal(install.config.roomId, TEST_ROOM)
})

test('the cron and timezone slots substitute into the schedule config', async () => {
  const script = await build({ cron: '30 14 * * 5', timezone: 'Europe/Madrid' })
  const trigger = script.composition.triggers[0]
  assert.equal(trigger.config.cron, '30 14 * * 5')
  assert.equal(trigger.config.timezone, 'Europe/Madrid')
})

test('the recipe defaults produce a daily 09:00 UTC schedule', async () => {
  const script = await build()
  const trigger = script.composition.triggers[0]
  assert.equal(trigger.config.name, 'daily-reminder')
  assert.equal(trigger.config.cron, '0 9 * * *')
  assert.equal(trigger.config.timezone, 'UTC')
})

test('the composition nests settings-read and post-response under the trigger', async () => {
  const script = await build()
  const trigger = script.composition.triggers[0]
  assert.equal(trigger.children.length, 1)
  const read = trigger.children[0]
  assert.equal(read.primitive, 'settings-read')
  assert.equal(read.config.key, 'message')
  assert.equal(read.children.length, 1)
  const post = read.children[0]
  assert.equal(post.primitive, 'post-response')
  assert.equal(post.config.text, '{{.}}')
})

test('the emitted code contains the schedule-task trigger block', async () => {
  const script = await build()
  assert.match(script.code, /const triggers = \[/)
  assert.match(script.code, /scheduleTask\.create\(/)
  assert.match(script.code, /"name": "daily-reminder"/)
  assert.match(script.code, /"cron": "0 9 \* \* \*"/)
  assert.match(script.code, /"timezone": "UTC"/)
  assert.match(script.code, /Recipe: daily-reminder@1\.0\.0/)
})

test('the emitted code contains the settings and handlers', async () => {
  const script = await build()
  assert.match(script.code, /settings: \{/)
  assert.match(script.code, /"message"/)
  assert.match(script.code, /settingsRead\.create\(/)
  assert.match(script.code, /postResponse\.create\(/)
  assert.match(script.code, /const handlers = \{/)
})

test('the emitted bot config carries the settings', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)
  assert.ok(config.settings)
  assert.ok(config.settings.message)
})

test('the emitted bot exposes the trigger as a function', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)
  assert.ok(Array.isArray(config.triggers))
  assert.equal(config.triggers.length, 1)
  assert.equal(typeof config.triggers[0], 'function')
})

test('a schedule fire posts the configured message to the configured room', async () => {
  const script = await build()
  const { config, ctx, posts } = loadEmittedBot(script.code, {
    settings: { message: 'Standup in 15' }
  })
  const firedAt = '2026-01-15T09:00:00.000Z'
  await config.triggers[0](ctx, { firedAt })
  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'Standup in 15')
  assert.equal(posts[0].roomId, TEST_ROOM)
})

test('the schedule handler uses the setting value at fire time, not at build time', async () => {
  const script = await build()
  const options = { settings: { message: 'First' } }
  const { config, ctx, posts, settings } = loadEmittedBot(script.code, options)

  await config.triggers[0](ctx, { firedAt: '2026-01-15T09:00:00.000Z' })
  settings.set('message', 'Second')
  await config.triggers[0](ctx, { firedAt: '2026-01-16T09:00:00.000Z' })

  assert.equal(posts.length, 2)
  assert.equal(posts[0].text, 'First')
  assert.equal(posts[1].text, 'Second')
})

test('the schedule handler ignores its input when resolving the message', async () => {
  const script = await build()
  const { config, ctx, posts } = loadEmittedBot(script.code, {
    settings: { message: 'Configured' }
  })
  await config.triggers[0](ctx, { name: 'ignored', firedAt: '2026-01-15T09:00:00.000Z' })
  assert.equal(posts[0].text, 'Configured')
})

test('the schedule handler throws when the setting value is empty', async () => {
  const script = await build()
  const { config, ctx } = loadEmittedBot(script.code, { settings: { message: '' } })
  await assert.rejects(
    () => config.triggers[0](ctx, { firedAt: '2026-01-15T09:00:00.000Z' }),
    /resolved text is empty/
  )
})

test('the schedule handler throws when the setting is undefined', async () => {
  const script = await build()
  const { config, ctx } = loadEmittedBot(script.code)
  await assert.rejects(
    () => config.triggers[0](ctx, { firedAt: '2026-01-15T09:00:00.000Z' }),
    /resolved text is empty/
  )
})

test('the install handler posts to the configured room', async () => {
  const script = await build()
  const { config, ctx, posts } = loadEmittedBot(script.code)
  await config.handlers.install(ctx, {})
  assert.equal(posts.length, 1)
  assert.equal(posts[0].roomId, TEST_ROOM)
  assert.match(posts[0].text, /Daily Reminder is ready/)
})

test('the emitted code is deterministic', async () => {
  const first = await build()
  const second = await build()
  assert.equal(first.code, second.code)
})

test('the library scans cleanly with daily-reminder present', async () => {
  const { recipes, errors } = await scanLibrary(LIB_ROOT)
  const ids = recipes.map((r) => r.id).sort()
  assert.ok(ids.includes('daily-reminder'))
  assert.ok(ids.includes('room-topic'))
  assert.ok(ids.includes('sticky'))
  assert.deepEqual(errors, [])
})
