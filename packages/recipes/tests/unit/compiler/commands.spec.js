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

test('the emitter throws when the composition carries commands', async () => {
  const composition = await compose(LIB, {
    recipeId: 'with-commands',
    recipeVersion: '1.0.0',
    slots: { greeting: 'hi' }
  })
  assert.throws(
    () => emit(composition, { botId: 'com.example.with-commands', label: 'With Commands' }),
    /command emission is not implemented in this version/
  )
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
