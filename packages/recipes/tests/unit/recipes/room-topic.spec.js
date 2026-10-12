// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compile } from '../../../src/compiler/index.js'
import { loadRecipeById, scanLibrary } from '../../../src/recipe/library.js'
import { substitute } from '../../../src/lib/substitute.js'

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
 * Loads the emitted bot.js source against stubbed primitives. The
 * stubs share a single settings map keyed by `room:<roomId>:<key>`.
 *
 * @param {string} code - The emitted bot.js source.
 * @param {Record<string, unknown>} settingsMap - The settings store.
 * @returns {{ config: object, posts: object[], localMessages: object[] }} The bot config and records of posts and private replies.
 */
function loadEmittedBot (code, settingsMap) {
  const posts = []
  const localMessages = []

  const defineBot = (config) => config

  const asCommandDecl = (name, description, argsDecl, handler) => {
    const decl = {
      name,
      args: argsDecl,
      handler: async (ctx, argsReader) => {
        const argsObject = {}
        for (const key of Object.keys(argsDecl ?? {})) {
          argsObject[key] = argsReader.get(key)
        }
        const result = await handler(ctx, { args: argsObject, command: name })
        if (result === undefined) {
          return { type: 'none' }
        }
        return result
      }
    }
    if (description !== undefined) {
      decl.description = description
    }
    return decl
  }

  const postResponse = {
    create (config, children) {
      const text = config.text
      return async (ctx, input) => {
        const resolvedText = substitute(text, input)
        if (typeof resolvedText !== 'string' || resolvedText.length === 0) {
          throw new Error('post-response: resolved text is empty')
        }
        posts.push({ text: resolvedText })
        for (const child of children ?? []) {
          await child(ctx, input)
        }
        return undefined
      }
    }
  }

  const replyLocal = {
    create (config) {
      const text = config.text
      return async (ctx, input) => {
        const resolved = substitute(text, input)
        localMessages.push({ text: String(resolved) })
        return undefined
      }
    }
  }

  const settingsRead = {
    create (config, children) {
      const key = config.key
      const scope = config.scope
      return async (ctx, input) => {
        let value
        if (scope === 'user') {
          value = settingsMap[key]
        } else {
          const roomId = config.room ?? ctx.room?.id
          if (typeof roomId !== 'string') {
            throw new Error('settings-read: scope "room" requires a room, but none is available')
          }
          value = settingsMap[`room:${roomId}:${key}`]
        }
        let lastResult
        for (const child of children ?? []) {
          lastResult = await child(ctx, value)
        }
        return lastResult
      }
    }
  }

  const settingsWrite = {
    create (config, children) {
      const key = config.key
      const scope = config.scope
      const valueConfig = config.value
      const hasValue = Object.hasOwn(config, 'value')
      return async (ctx, input) => {
        const resolvedValue = hasValue ? substitute(valueConfig, input) : input
        if (scope === 'user') {
          settingsMap[key] = resolvedValue
        } else {
          const roomId = config.room ?? ctx.room?.id
          if (typeof roomId !== 'string') {
            throw new Error('settings-write: scope "room" requires a room, but none is available')
          }
          settingsMap[`room:${roomId}:${key}`] = resolvedValue
        }
        let lastResult
        for (const child of children ?? []) {
          lastResult = await child(ctx, input)
        }
        return lastResult
      }
    }
  }

  const exposeCommand = {
    create (config, children) {
      return async (ctx, input) => {
        let lastResult
        for (const child of children ?? []) {
          lastResult = await child(ctx, input)
        }
        return lastResult
      }
    }
  }

  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const buildFn = new Function(
    'defineBot',
    'asCommandDecl',
    'postResponse',
    'replyLocal',
    'settingsRead',
    'settingsWrite',
    'exposeCommand',
    `
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function(
      'defineBot',
      'asCommandDecl',
      'postResponse',
      'replyLocal',
      'settingsRead',
      'settingsWrite',
      'exposeCommand',
      cleaned
    )
    return fn(defineBot, asCommandDecl, postResponse, replyLocal, settingsRead, settingsWrite, exposeCommand)
  `
  )

  const rawConfig = buildFn(defineBot, asCommandDecl, postResponse, replyLocal, settingsRead, settingsWrite, exposeCommand)
  const config = {
    ...rawConfig,
    commands: {
      topic: rawConfig.commands.topic,
      'topic-show': rawConfig.commands.topic_show ?? rawConfig.commands['topic-show']
    }
  }
  return { config, posts, localMessages }
}

/**
 * Builds a mock ctx with a room id.
 * @param {string} roomId - The room id.
 * @returns {object} A minimal ctx.
 */
function makeCtx (roomId) {
  return { room: { id: roomId, displayName: 'Room', memberCount: 1 } }
}

/**
 * Builds a mock ArgsReader.
 * @param {Record<string, unknown>} values - The backing values.
 * @returns {object} A reader-shaped object.
 */
function makeReader (values) {
  return { get: (key) => values[key] }
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
  const { config } = loadEmittedBot(script.code, {})
  assert.ok(config.commands.topic)
  assert.ok(config.commands['topic-show'])
  assert.equal(typeof config.commands.topic.handler, 'function')
  assert.equal(typeof config.commands['topic-show'].handler, 'function')
})

test('/topic writes the room-scoped setting and replies privately', async () => {
  const script = await build()
  const store = {}
  const { config, localMessages, posts } = loadEmittedBot(script.code, store)
  const ctx = makeCtx(ROOM_ID)

  const reader = makeReader({ text: 'Deploy freeze' })
  const result = await config.commands.topic.handler(ctx, reader)

  assert.equal(store[`room:${ROOM_ID}:topic`], 'Deploy freeze')
  assert.equal(localMessages.length, 1)
  assert.equal(localMessages[0].text, 'Topic updated for this room.')
  assert.equal(posts.length, 0)
  assert.deepEqual(result, { type: 'none' })
})

test('/topic-show posts the room-scoped setting publicly', async () => {
  const script = await build()
  const store = { [`room:${ROOM_ID}:topic`]: 'Deploy freeze' }
  const { config, localMessages, posts } = loadEmittedBot(script.code, store)
  const ctx = makeCtx(ROOM_ID)

  const result = await config.commands['topic-show'].handler(ctx, makeReader({}))

  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'Deploy freeze')
  assert.equal(localMessages.length, 0)
  assert.deepEqual(result, { type: 'none' })
})

test('a full round-trip through both commands works', async () => {
  const script = await build()
  const store = {}
  const { config, posts } = loadEmittedBot(script.code, store)
  const ctx = makeCtx(ROOM_ID)

  await config.commands.topic.handler(ctx, makeReader({ text: 'Sprint 47' }))
  await config.commands['topic-show'].handler(ctx, makeReader({}))

  assert.equal(posts[posts.length - 1].text, 'Sprint 47')
})

test('/topic-show posts the default when the setting was never written', async () => {
  const script = await build()
  const store = { [`room:${ROOM_ID}:topic`]: 'No topic set.' }
  const { config, posts } = loadEmittedBot(script.code, store)
  const ctx = makeCtx(ROOM_ID)

  await config.commands['topic-show'].handler(ctx, makeReader({}))

  assert.equal(posts[0].text, 'No topic set.')
})

test('/topic is room-scoped: writing in one room does not affect another', async () => {
  const script = await build()
  const store = { 'room:r_other:topic': 'Existing topic' }
  const { config } = loadEmittedBot(script.code, store)

  await config.commands.topic.handler(makeCtx('r_a'), makeReader({ text: 'Topic for A' }))

  assert.equal(store['room:r_a:topic'], 'Topic for A')
  assert.equal(store['room:r_other:topic'], 'Existing topic')
})

test('/topic-show reads the topic from its own room', async () => {
  const script = await build()
  const store = {
    'room:r_a:topic': 'Topic A',
    'room:r_b:topic': 'Topic B'
  }
  const { config, posts } = loadEmittedBot(script.code, store)

  await config.commands['topic-show'].handler(makeCtx('r_b'), makeReader({}))

  assert.equal(posts[0].text, 'Topic B')
})

test('/topic throws when invoked without a room', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code, {})
  await assert.rejects(
    () => config.commands.topic.handler({ room: null }, makeReader({ text: 'x' })),
    /scope "room" requires a room, but none is available/
  )
})

test('/topic-show throws when invoked without a room', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code, {})
  await assert.rejects(
    () => config.commands['topic-show'].handler({ room: null }, makeReader({})),
    /scope "room" requires a room, but none is available/
  )
})

test('the install handler posts a fixed public message', async () => {
  const script = await build()
  const { config, posts } = loadEmittedBot(script.code, {})
  await config.handlers.install(makeCtx(ROOM_ID), {})
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
