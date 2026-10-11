// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compile } from '../../../src/compiler/index.js'
import { loadRecipeById } from '../../../src/recipe/library.js'
import { substitute } from '../../../src/lib/substitute.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB_ROOT = join(HERE, '..', '..', '..', 'recipes')

/**
 * Compiles the echo-command recipe with standard options.
 * @returns {Promise<object>} The BotScript.
 */
async function build () {
  return compile(
    LIB_ROOT,
    {
      recipeId: 'echo-command',
      recipeVersion: '1.0.0',
      slots: {}
    },
    {
      botId: 'com.example.echo-command',
      label: 'Echo'
    }
  )
}

/**
 * Runs the emitted script against stubbed primitives and returns the
 * resulting bot config plus a recording of `ctx.post` calls.
 *
 * The stub for `postResponse` performs the same substitution the real
 * primitive performs, so template resolution is exercised end to end.
 * @param {string} code - The emitted bot.js source.
 * @returns {{ config: object, postCalls: object[] }} The bot config
 *   and a record of posts the handler made.
 */
function loadEmittedBot (code) {
  const postCalls = []

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
        await handler(ctx, { args: argsObject, command: name })
        return { type: 'none' }
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
        postCalls.push(resolved)
        for (const child of children ?? []) {
          await child(ctx, input)
        }
      }
    }
  }
  const exposeCommand = {
    create (config, children) {
      return async (ctx, input) => {
        for (const child of children ?? []) {
          await child(ctx, input)
        }
      }
    }
  }

  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const build = new Function('defineBot', 'asCommandDecl', 'postResponse', 'exposeCommand', `
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function('defineBot', 'asCommandDecl', 'postResponse', 'exposeCommand', cleaned)
    return fn(defineBot, asCommandDecl, postResponse, exposeCommand)
  `)

  const config = build(defineBot, asCommandDecl, postResponse, exposeCommand)
  return { config, postCalls }
}

test('the recipe is present in the library', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'echo-command')
  assert.equal(recipe.id, 'echo-command')
  assert.equal(recipe.version, '1.0.0')
  assert.equal(recipe.kind, 'pure')
  assert.ok(Array.isArray(recipe.commands ? Object.keys(recipe.commands) : null))
})

test('the recipe declares exactly one command', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'echo-command')
  const names = Object.keys(recipe.commands)
  assert.deepEqual(names, ['echo'])
})

test('the command config matches the map key', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'echo-command')
  assert.equal(recipe.commands.echo.config.name, 'echo')
})

test('the command declares a required text argument', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'echo-command')
  const args = recipe.commands.echo.config.args
  assert.ok(args.text)
  assert.equal(args.text.type, 'string')
  assert.equal(args.text.required, true)
})

test('the recipe declares the capabilities its primitives require', async () => {
  const recipe = await loadRecipeById(LIB_ROOT, 'echo-command')
  assert.ok(recipe.capabilities.includes('read_commands'))
  assert.ok(recipe.capabilities.includes('post_message'))
})

test('the recipe compiles without error', async () => {
  const script = await build()
  assert.equal(typeof script.code, 'string')
  assert.equal(script.composition.recipeId, 'echo-command')
  assert.equal(script.composition.target, 'bot')
  assert.ok(script.composition.commands)
  assert.ok(script.composition.commands.echo)
})

test('the composition carries the command alongside the install handler', async () => {
  const script = await build()
  assert.ok(script.composition.handlers.install)
  assert.ok(script.composition.commands.echo)
  assert.equal(script.composition.commands.echo.primitive, 'expose-command')
})

test('the emitted code contains a commands block and the asCommandDecl import', async () => {
  const script = await build()
  assert.match(script.code, /const commands = \{/)
  assert.match(script.code, /asCommandDecl\(/)
  assert.match(script.code, /"echo"/)
  assert.match(script.code, /"Repeat a message in the room\."/)
  assert.match(script.code, /Recipe: echo-command@1\.0\.0/)
  assert.match(script.code, /id: "com\.example\.echo-command"/)
})

test('the emitted code does not throw on the emitter guard', async () => {
  const script = await build()
  assert.doesNotMatch(script.code, /command emission is not implemented/)
})

test('the emitted bot exposes an echo command with a handler', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)
  assert.ok(config.commands.echo)
  assert.equal(typeof config.commands.echo.handler, 'function')
  assert.equal(config.commands.echo.description, 'Repeat a message in the room.')
})

test('the command handler passes the declared argument through to the child', async () => {
  const script = await build()
  const { config, postCalls } = loadEmittedBot(script.code)
  const reader = {
    get (key) {
      return key === 'text' ? 'hello world' : undefined
    }
  }
  const ctx = {}
  await config.commands.echo.handler(ctx, reader)
  assert.equal(postCalls.length, 1)
  assert.equal(postCalls[0].text, 'hello world')
})

test('the command handler returns a valid CommandResult', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)
  const reader = { get: () => 'x' }
  const result = await config.commands.echo.handler({}, reader)
  assert.deepEqual(result, { type: 'none' })
})

test('the command handler reads only the declared argument keys', async () => {
  const script = await build()
  const { config } = loadEmittedBot(script.code)
  const reads = []
  const reader = {
    get (key) {
      reads.push(key)
      return 'x'
    }
  }
  await config.commands.echo.handler({}, reader)
  assert.deepEqual(reads, ['text'])
})

test('the emitted script compiles deterministically', async () => {
  const first = await build()
  const second = await build()
  assert.equal(first.code, second.code)
})

test('the recipes library scans cleanly with echo-command present', async () => {
  const { scanLibrary } = await import('../../../src/recipe/library.js')
  const { recipes, errors } = await scanLibrary(LIB_ROOT)
  const ids = recipes.map((r) => r.id).sort()
  assert.ok(ids.includes('echo-command'))
  assert.ok(ids.includes('keyword-alert'))
  assert.deepEqual(errors, [])
})
