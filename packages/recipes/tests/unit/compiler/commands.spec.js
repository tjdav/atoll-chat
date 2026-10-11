// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compose } from '../../../src/compiler/compose.js'
import { emit } from '../../../src/compiler/emit.js'
import { validateRecipe } from '../../../src/recipe/validate.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', '..', 'fixtures', 'composer-library')

/**
 * A minimal valid recipe with a command.
 * @returns {object} The recipe.
 */
function recipeWithCommand () {
  return {
    id: 'inline',
    version: '1.0.0',
    label: 'Inline',
    description: 'Inline recipe for tests.',
    kind: 'pure',
    capabilities: ['read_commands', 'post_message'],
    slots: [],
    handlers: {
      install: {
        id: 'install-hook',
        primitive: 'post-response',
        config: { text: 'Ready.' }
      }
    },
    commands: {
      save: {
        id: 'save-command',
        primitive: 'expose-command',
        config: { name: 'save', description: 'Save it.' },
        children: [
          {
            id: 'save-respond',
            primitive: 'post-response',
            config: { text: 'Saved.' }
          }
        ]
      }
    }
  }
}

test('the validator accepts a recipe with a valid command', () => {
  const result = validateRecipe(recipeWithCommand())
  assert.equal(result.valid, true)
})

test('the validator rejects a command name that fails the pattern', () => {
  const recipe = recipeWithCommand()
  recipe.commands = { 'Bad_Name': { id: 'x', primitive: 'expose-command', config: { name: 'Bad_Name' } } }
  const result = validateRecipe(recipe)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /command name must match/.test(e)))
})

test('the validator rejects a command whose config.name differs from the key', () => {
  const recipe = recipeWithCommand()
  recipe.commands.save.config = { name: 'other' }
  const result = validateRecipe(recipe)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /config\.name must equal "save"/.test(e)))
})

test('the validator rejects commands that is not an object', () => {
  const recipe = recipeWithCommand()
  recipe.commands = []
  const result = validateRecipe(recipe)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /commands must be an object/.test(e)))
})

test('the validator rejects commands whose entry is not a PrimitiveInstance', () => {
  const recipe = recipeWithCommand()
  recipe.commands.save = 'not-an-instance'
  const result = validateRecipe(recipe)
  assert.equal(result.valid, false)
})

test('the validator requires the command capability from the primitive', () => {
  const recipe = recipeWithCommand()
  recipe.capabilities = ['post_message']
  const result = validateRecipe(recipe)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /capabilities is missing "read_commands"/.test(e)))
})

test('a recipe without commands validates without a commands field', () => {
  const recipe = recipeWithCommand()
  delete recipe.commands
  const result = validateRecipe(recipe)
  assert.equal(result.valid, true)
})

test('the composer resolves the commands map from a recipe', async () => {
  const composition = await compose(LIB, {
    recipeId: 'with-commands',
    recipeVersion: '1.0.0',
    slots: { greeting: 'howdy' }
  })
  assert.ok(composition.commands)
  assert.ok(composition.commands.greet)
  assert.equal(composition.commands.greet.primitive, 'expose-command')
})

test('the composer substitutes slots inside command config', async () => {
  const composition = await compose(LIB, {
    recipeId: 'with-commands',
    recipeVersion: '1.0.0',
    slots: { greeting: 'howdy' }
  })
  const child = composition.commands.greet.children[0]
  assert.equal(child.config.text, 'Hello, howdy.')
})

test('the composer substitutes slots inside handler config independently', async () => {
  const composition = await compose(LIB, {
    recipeId: 'with-commands',
    recipeVersion: '1.0.0',
    slots: { greeting: 'howdy' }
  })
  assert.equal(composition.handlers.install.config.text, 'howdy, ready.')
})

test('the composer omits commands when the recipe declares none', async () => {
  const composition = await compose(LIB, {
    recipeId: 'delta',
    recipeVersion: '1.0.0',
    slots: { prefix: 'p' }
  })
  assert.equal(Object.hasOwn(composition, 'commands'), false)
})

test('the emitter produces a commands block when the composition has commands', async () => {
  const composition = await compose(LIB, {
    recipeId: 'with-commands',
    recipeVersion: '1.0.0',
    slots: { greeting: 'hi' }
  })
  const code = emit(composition, { botId: 'com.example.with-commands', label: 'With Commands' })
  assert.match(code, /const commands = \{/)
  assert.match(code, /asCommandDecl\(/)
  assert.match(code, /"greet"/)
  assert.match(code, /read_commands|post_message/)
})

test('the emitted command block carries the description and args', async () => {
  const composition = await compose(LIB, {
    recipeId: 'with-commands',
    recipeVersion: '1.0.0',
    slots: { greeting: 'hi' }
  })
  const code = emit(composition, { botId: 'com.example.with-commands', label: 'With Commands' })
  assert.match(code, /"Greet someone\."/)
  assert.match(code, /"name"/)
  assert.match(code, /"required": true/)
})

test('the emitted script with commands parses as valid JavaScript', async () => {
  const composition = await compose(LIB, {
    recipeId: 'with-commands',
    recipeVersion: '1.0.0',
    slots: { greeting: 'hi' }
  })
  const code = emit(composition, { botId: 'com.example.with-commands', label: 'With Commands' })

  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const build = new Function(`
    const defineBot = (config) => config
    const asCommandDecl = (name, description, argsDecl, handler) => ({
      name,
      description,
      args: argsDecl,
      handler: async (ctx, argsReader) => {
        const argsObject = {}
        for (const key of Object.keys(argsDecl ?? {})) {
          argsObject[key] = argsReader.get(key)
        }
        await handler(ctx, { args: argsObject, command: name })
        return { type: 'none' }
      }
    })
    const exposeCommand = { create: () => (() => {}) }
    const postResponse = { create: () => (() => {}) }
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function('defineBot', 'asCommandDecl', 'exposeCommand', 'postResponse', cleaned)
    return fn(defineBot, asCommandDecl, exposeCommand, postResponse)
  `)
  const result = build()
  assert.ok(result)
  assert.ok(result.commands)
  assert.ok(result.commands.greet)
  assert.equal(typeof result.commands.greet.handler, 'function')
  assert.ok(result.handlers)
})

test('the emitter does not throw when the composition has no commands', async () => {
  const composition = await compose(LIB, {
    recipeId: 'delta',
    recipeVersion: '1.0.0',
    slots: { prefix: 'p' }
  })
  const code = emit(composition, { botId: 'com.example.delta', label: 'Delta' })
  assert.equal(typeof code, 'string')
})
