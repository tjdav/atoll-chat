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

/**
 * Compiles the notes recipe.
 * @returns {Promise<object>} The BotScript.
 */
async function build () {
  return compile(
    LIB_ROOT,
    { recipeId: 'notes', recipeVersion: '1.0.0', slots: {} },
    { botId: 'com.example.notes', label: 'Notes' }
  )
}

/**
 * Loads the emitted bot.js source against stubbed primitives and
 * returns the config plus a shared in-memory store.
 *
 * The stubs mirror the real primitives: `postResponse` and
 * `keyedStore` perform template substitution; `replyLocal` returns a
 * `local_message`; `exposeCommand` propagates the last child's return.
 *
 * @param {string} code - The emitted bot.js source.
 * @returns {{ config: object, store: Map<string, unknown>, posts: object[] }} The bot config, the shared store, and a record of posts.
 */
function loadEmittedBot (code) {
  const posts = []
  const store = new Map()

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
      return async (ctx, input) => {
        const resolved = {}
        for (const key of Object.keys(config)) {
          resolved[key] = substitute(config[key], input)
        }
        posts.push(resolved)
        for (const child of children ?? []) {
          await child(ctx, input)
        }
      }
    }
  }

  const keyedStore = {
    create (config, children) {
      const mode = config.mode === undefined ? 'set' : config.mode
      const keyConfig = config.key
      const valueConfig = config.value
      const defaultValue = config.default
      const hasValue = Object.hasOwn(config, 'value')
      const hasDefault = Object.hasOwn(config, 'default')
      return async (ctx, input) => {
        const resolvedKey = substitute(keyConfig, input)
        if (mode === 'set') {
          const resolvedValue = hasValue ? substitute(valueConfig, input) : input
          store.set(resolvedKey, resolvedValue)
          return undefined
        }
        const stored = store.get(resolvedKey)
        let valueToPass = stored
        if (stored === undefined && hasDefault) {
          valueToPass = substitute(defaultValue, input)
        }
        let lastResult
        for (const child of children ?? []) {
          lastResult = await child(ctx, valueToPass)
        }
        return lastResult
      }
    }
  }

  const replyLocal = {
    create (config) {
      const text = config.text
      return async (ctx, input) => {
        const resolved = substitute(text, input)
        return { type: 'local_message', content: String(resolved) }
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
  const build = new Function('defineBot', 'asCommandDecl', 'postResponse', 'keyedStore', 'replyLocal', 'exposeCommand', `
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function(
      'defineBot',
      'asCommandDecl',
      'postResponse',
      'keyedStore',
      'replyLocal',
      'exposeCommand',
      cleaned
    )
    return fn(defineBot, asCommandDecl, postResponse, keyedStore, replyLocal, exposeCommand)
  `)

  const config = build(defineBot, asCommandDecl, postResponse, keyedStore, replyLocal, exposeCommand)
  return { config, store, posts }
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
  const recipe = await loadRecipeById(LIB_ROOT, 'notes')
  assert.equal(recipe.id, 'notes')
  assert.equal(recipe.version, '1.0.0')
  assert.equal(recipe.kind, 'pure')
  assert.ok(recipe.commands)
})

test('the recipe declares the save and recall commands', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'notes')
  const names = Object.keys(recipe.commands).sort()
  assert.deepEqual(names, ['recall', 'save'])
})

test('each command declares its name and arguments', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'notes')
  assert.equal(recipe.commands.save.config.name, 'save')
  assert.equal(recipe.commands.save.config.args.name.required, true)
  assert.equal(recipe.commands.save.config.args.value.required, true)
  assert.equal(recipe.commands.recall.config.name, 'recall')
  assert.equal(recipe.commands.recall.config.args.name.required, true)
})

test('the recipe declares the capabilities its primitives require', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'notes')
  assert.ok(recipe.capabilities.includes('read_commands'))
  assert.ok(recipe.capabilities.includes('post_message'))
})

test('the recipe compiles without error', async () => {
  const script = await build()
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'notes')
  assert.ok(script.composition.commands.save)
  assert.ok(script.composition.commands.recall)
})

test('the emitted code contains both commands and the install handler', async () => {
  const script = await build()
  assert.match(script.code, /const commands = \{/)
  assert.match(script.code, /"save"/)
  assert.match(script.code, /"recall"/)
  assert.match(script.code, /asCommandDecl\(/)
  assert.match(script.code, /replyLocal\.create\(/)
  assert.match(script.code, /keyedStore\.create\(/)
  assert.match(script.code, /const handlers = \{/)
  assert.match(script.code, /Recipe: notes@1\.0\.0/)
})

test('the emitted bot exposes both commands with handlers', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)
  assert.ok(config.commands.save)
  assert.ok(config.commands.recall)
  assert.equal(typeof config.commands.save.handler, 'function')
  assert.equal(typeof config.commands.recall.handler, 'function')
  assert.equal(config.commands.save.description, 'Save a note under a name.')
  assert.equal(config.commands.recall.description, 'Recall a note by name.')
})

test('the save command stores the value and returns a private reply', async () => {
  const script = await build()
  const { config, store } = loadEmittedBot(script.code)

  const reader = makeReader({ name: 'deploy-url', value: 'https://deploy.example.com' })
  const result = await config.commands.save.handler({}, reader)

  assert.equal(store.size, 1)
  const stored = store.get('notes:deploy-url')
  assert.deepEqual(stored, { name: 'deploy-url', value: 'https://deploy.example.com' })

  assert.deepEqual(result, {
    type: 'local_message',
    content: 'Saved "deploy-url" to the shared pad.'
  })
})

test('the recall command retrieves the value and returns it privately', async () => {
  const script = await build()
  const { config, store } = loadEmittedBot(script.code)

  store.set('notes:deploy-url', {
    name: 'deploy-url',
    value: 'https://deploy.example.com'
  })

  const reader = makeReader({ name: 'deploy-url' })
  const result = await config.commands.recall.handler({}, reader)

  assert.deepEqual(result, {
    type: 'local_message',
    content: '"deploy-url" = https://deploy.example.com'
  })
})

test('a save followed by a recall round-trips through the store', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)

  const saveReader = makeReader({ name: 'greeting', value: 'hello there' })
  await config.commands.save.handler({}, saveReader)

  const recallReader = makeReader({ name: 'greeting' })
  const result = await config.commands.recall.handler({}, recallReader)

  assert.deepEqual(result, {
    type: 'local_message',
    content: '"greeting" = hello there'
  })
})

test('recalling a name that was never saved returns a not-saved reply', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)

  const reader = makeReader({ name: 'never-saved' })
  const result = await config.commands.recall.handler({}, reader)

  assert.deepEqual(result, {
    type: 'local_message',
    content: '"never-saved" = (not saved)'
  })
})

test('recalling a saved name ignores the default and returns the stored value', async () => {
  const script = await build()
  const { config, store } = loadEmittedBot(script.code)

  store.set('notes:saved', { name: 'saved', value: 'real value' })

  const reader = makeReader({ name: 'saved' })
  const result = await config.commands.recall.handler({}, reader)

  assert.deepEqual(result, {
    type: 'local_message',
    content: '"saved" = real value'
  })
})

test('saving under the same name overwrites the previous value', async () => {
  const script = await build()
  const { config, store } = loadEmittedBot(script.code)

  await config.commands.save.handler(
    {},
    makeReader({ name: 'x', value: 'first' })
  )
  await config.commands.save.handler(
    {},
    makeReader({ name: 'x', value: 'second' })
  )

  assert.equal(store.size, 1)
  assert.equal(store.get('notes:x').value, 'second')
})

test('the save command reads only its declared argument keys', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)

  const reads = []
  const reader = {
    get (key) {
      reads.push(key)
      return key === 'name' ? 'a' : 'b'
    }
  }
  await config.commands.save.handler({}, reader)
  assert.deepEqual(reads.sort(), ['name', 'value'])
})

test('the install handler posts a public message', async () => {
  const script = await build()
  const { config, posts } = loadEmittedBot(script.code)
  await config.handlers.install({}, {})
  assert.equal(posts.length, 1)
  assert.match(posts[0].text, /Notes is ready/)
})

test('the emitted code is deterministic', async () => {
  const first = await build()
  const second = await build()
  assert.equal(first.code, second.code)
})

test('the library scans cleanly with notes present', async () => {
  const { recipes, errors } = await scanLibrary(LIB_ROOT)
  const ids = recipes.map((r) => r.id).sort()
  assert.ok(ids.includes('notes'))
  assert.ok(ids.includes('keyword-alert'))
  assert.ok(ids.includes('echo-command'))
  assert.deepEqual(errors, [])
})
