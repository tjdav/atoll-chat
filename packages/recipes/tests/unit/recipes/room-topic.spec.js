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

const ROOM_ID = 'r_test_room'

/**
 * Compiles the room-topic recipe.
 * @returns {Promise<object>} The BotScript.
 */
async function build () {
  return compile(
    LIB_ROOT,
    { recipeId: 'room-topic', recipeVersion: '1.0.0', slots: {} },
    { botId: 'com.example.room-topic', label: 'Room Topic' }
  )
}

/**
 * Builds a mock ArgsReader.
 * @param {Record<string, unknown>} values - The backing values.
 * @returns {object} A reader-shaped object.
 */
function makeReader (values) {
  return { get: (key) => values[key] }
}

/**
 * Builds the shared helper's `options` for a given room.
 * @param {string} roomId - The room id the mock ctx should report.
 * @param {Record<string, unknown>} [settings] - Initial settings.
 * @returns {object} The options object.
 */
function optionsFor (roomId, settings) {
  return {
    room: { id: roomId, displayName: 'Room', memberCount: 1 },
    settings: settings ?? {}
  }
}

test('the recipe is present in the library and validates', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'room-topic')
  assert.equal(recipe.id, 'room-topic')
  assert.equal(recipe.version, '1.0.0')
  assert.equal(recipe.kind, 'pure')
})

test('the recipe declares a room-scoped topic setting', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'room-topic')
  assert.ok(recipe.settings)
  assert.ok(recipe.settings.topic)
  assert.equal(recipe.settings.topic.type, 'text')
  assert.equal(recipe.settings.topic.scope, 'room')
  assert.equal(recipe.settings.topic.default, 'No topic set.')
})

test('the recipe declares the topic and topic-show commands', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'room-topic')
  const names = Object.keys(recipe.commands).sort()
  assert.deepEqual(names, ['topic', 'topic-show'])
  assert.equal(recipe.commands.topic.config.name, 'topic')
  assert.equal(recipe.commands['topic-show'].config.name, 'topic-show')
})

test('the recipe declares the capabilities its primitives require', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'room-topic')
  assert.ok(recipe.capabilities.includes('read_commands'))
  assert.ok(recipe.capabilities.includes('post_message'))
})

test('the recipe compiles without error', async () => {
  const script = await build()
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'room-topic')
  assert.ok(script.composition.commands.topic)
  assert.ok(script.composition.commands['topic-show'])
})

test('the composition nests settings-write and reply-local under /topic', async () => {
  const script = await build()
  const topic = script.composition.commands.topic
  assert.equal(topic.children.length, 1)
  const write = topic.children[0]
  assert.equal(write.primitive, 'settings-write')
  assert.equal(write.config.key, 'topic')
  assert.equal(write.config.scope, 'room')
  assert.equal(write.config.value, '{{args.text}}')
  assert.equal(write.children.length, 1)
  const reply = write.children[0]
  assert.equal(reply.primitive, 'reply-local')
})

test('the composition nests settings-read and post-response under /topic-show', async () => {
  const script = await build()
  const show = script.composition.commands['topic-show']
  assert.equal(show.children.length, 1)
  const read = show.children[0]
  assert.equal(read.primitive, 'settings-read')
  assert.equal(read.config.key, 'topic')
  assert.equal(read.config.scope, 'room')
  assert.equal(read.children.length, 1)
  const post = read.children[0]
  assert.equal(post.primitive, 'post-response')
  assert.equal(post.config.text, '{{.}}')
})

test('the emitted code contains a settings block', async () => {
  const script = await build()
  assert.match(script.code, /settings: \{/)
  assert.match(script.code, /"topic"/)
  assert.match(script.code, /"Room topic"/)
  assert.match(script.code, /"scope": "room"/)
})

test('the emitted code contains the expected primitives', async () => {
  const script = await build()
  assert.match(script.code, /settingsWrite\.create\(/)
  assert.match(script.code, /settingsRead\.create\(/)
  assert.match(script.code, /replyLocal\.create\(/)
  assert.match(script.code, /postResponse\.create\(/)
  assert.match(script.code, /asCommandDecl\(/)
  assert.match(script.code, /Recipe: room-topic@1\.0\.0/)
})

test('the emitted bot exposes both commands with handlers', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code, optionsFor(ROOM_ID))
  assert.ok(config.commands.topic)
  assert.ok(config.commands.topic_show)
  assert.equal(typeof config.commands.topic.handler, 'function')
  assert.equal(typeof config.commands.topic_show.handler, 'function')
})

test('/topic writes the room-scoped setting and returns a local_message', async () => {
  const script = await build()
  const { config, ctx, settings, posts } = loadEmittedBot(script.code, optionsFor(ROOM_ID))

  const reader = makeReader({ text: 'Deploy freeze' })
  const result = await config.commands.topic.handler(ctx, reader)

  assert.equal(settings.get(`room:${ROOM_ID}:topic`), 'Deploy freeze')
  assert.deepEqual(result, {
    type: 'local_message',
    content: 'Topic updated for this room.'
  })
  assert.equal(posts.length, 0)
})

test('/topic-show posts the room-scoped setting publicly and returns none', async () => {
  const script = await build()
  const options = optionsFor(ROOM_ID, { [`room:${ROOM_ID}:topic`]: 'Deploy freeze' })
  const { config, ctx, posts } = loadEmittedBot(script.code, options)

  const result = await config.commands.topic_show.handler(ctx, makeReader({}))

  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'Deploy freeze')
  assert.deepEqual(result, { type: 'none' })
})

test('a full round-trip through both commands works', async () => {
  const script = await build()
  const { config, ctx, posts } = loadEmittedBot(script.code, optionsFor(ROOM_ID))

  await config.commands.topic.handler(ctx, makeReader({ text: 'Sprint 47' }))
  await config.commands.topic_show.handler(ctx, makeReader({}))

  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'Sprint 47')
})

test('/topic-show posts the stored default when the setting was never written', async () => {
  const script = await build()
  const options = optionsFor(ROOM_ID, { [`room:${ROOM_ID}:topic`]: 'No topic set.' })
  const { config, ctx, posts } = loadEmittedBot(script.code, options)

  await config.commands.topic_show.handler(ctx, makeReader({}))

  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'No topic set.')
})

test('/topic is room-scoped: writing in one room does not affect another', async () => {
  const script = await build()
  const options = optionsFor('r_a', { 'room:r_other:topic': 'Existing topic' })
  const { config, ctx, settings } = loadEmittedBot(script.code, options)

  await config.commands.topic.handler(ctx, makeReader({ text: 'Topic for A' }))

  assert.equal(settings.get('room:r_a:topic'), 'Topic for A')
  assert.equal(settings.get('room:r_other:topic'), 'Existing topic')
})

test('/topic-show reads the topic from its own room', async () => {
  const script = await build()
  const options = optionsFor('r_b', {
    'room:r_a:topic': 'Topic A',
    'room:r_b:topic': 'Topic B'
  })
  const { config, ctx, posts } = loadEmittedBot(script.code, options)

  await config.commands.topic_show.handler(ctx, makeReader({}))

  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'Topic B')
})

test('/topic throws when invoked without a room', async () => {
  const script = await build()
  const { config, ctx } = loadEmittedBot(script.code, { room: null })
  await assert.rejects(
    () => config.commands.topic.handler(ctx, makeReader({ text: 'x' })),
    /scope "room" requires a room, but none is available/
  )
})

test('/topic-show throws when invoked without a room', async () => {
  const script = await build()
  const { config, ctx } = loadEmittedBot(script.code, { room: null })
  await assert.rejects(
    () => config.commands.topic_show.handler(ctx, makeReader({})),
    /scope "room" requires a room, but none is available/
  )
})

test('the install handler posts a fixed public message', async () => {
  const script = await build()
  const { config, ctx, posts } = loadEmittedBot(script.code, optionsFor(ROOM_ID))
  await config.handlers.install(ctx, {})
  assert.equal(posts.length, 1)
  assert.match(posts[0].text, /Room Topic is ready/)
})

test('the emitted code is deterministic', async () => {
  const first = await build()
  const second = await build()
  assert.equal(first.code, second.code)
})

test('the library scans cleanly with room-topic present', async () => {
  const { recipes, errors } = await scanLibrary(LIB_ROOT)
  const ids = recipes.map((r) => r.id).sort()
  assert.ok(ids.includes('room-topic'))
  assert.ok(ids.includes('sticky'))
  assert.ok(ids.includes('webhook-notify'))
  assert.deepEqual(errors, [])
})
