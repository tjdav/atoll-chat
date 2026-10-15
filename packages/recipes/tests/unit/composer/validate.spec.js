// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validateComposition } from '../../../src/composer/validate.js'

/**
 * A minimal valid composed composition.
 * @returns {object} The composition.
 */
function composedComposition () {
  return {
    source: 'composed',
    target: 'bot',
    slots: {},
    capabilities: ['post_message'],
    handlers: {
      install: {
        id: 'install-hook',
        primitive: 'post-response',
        config: { text: 'Ready.' }
      }
    }
  }
}

/**
 * A minimal valid recipe composition.
 * @returns {object} The composition.
 */
function recipeComposition () {
  return {
    source: 'recipe',
    recipeId: 'echo-command',
    recipeVersion: '1.0.0',
    target: 'bot',
    slots: {},
    capabilities: ['post_message'],
    handlers: {
      install: {
        id: 'install-hook',
        primitive: 'post-response',
        config: { text: 'Ready.' }
      }
    }
  }
}

test('a valid composed composition passes', () => {
  const result = validateComposition(composedComposition())
  assert.equal(result.valid, true)
  assert.deepEqual(result.composition, composedComposition())
})

test('a valid recipe composition passes', () => {
  const result = validateComposition(recipeComposition())
  assert.equal(result.valid, true)
})

test('a non-object input fails', () => {
  assert.equal(validateComposition(null).valid, false)
  assert.equal(validateComposition('x').valid, false)
  assert.equal(validateComposition([]).valid, false)
})

test('a missing source fails', () => {
  const composition = composedComposition()
  delete composition.source
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /source must be/.test(e)))
})

test('an invalid source fails', () => {
  const composition = composedComposition()
  composition.source = 'magic'
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /source must be/.test(e)))
})

test('a recipe source without recipeId fails', () => {
  const composition = recipeComposition()
  delete composition.recipeId
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /recipeId is required/.test(e)))
})

test('a recipe source without recipeVersion fails', () => {
  const composition = recipeComposition()
  delete composition.recipeVersion
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /recipeVersion is required/.test(e)))
})

test('an invalid target fails', () => {
  const composition = composedComposition()
  composition.target = 'widget'
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /target must be/.test(e)))
})

test('a missing slots fails', () => {
  const composition = composedComposition()
  delete composition.slots
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /slots is required/.test(e)))
})

test('slots as an array fails', () => {
  const composition = composedComposition()
  composition.slots = []
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /slots is required/.test(e)))
})

test('a missing handlers fails', () => {
  const composition = composedComposition()
  delete composition.handlers
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /handlers is required/.test(e)))
})

test('a missing capabilities fails', () => {
  const composition = composedComposition()
  delete composition.capabilities
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /capabilities is required/.test(e)))
})

test('an unknown handler name fails', () => {
  const composition = composedComposition()
  composition.handlers.mystery = {
    id: 'mystery',
    primitive: 'post-response',
    config: { text: 'Ready.' }
  }
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /not a recognized handler name/.test(e)))
})

test('a duplicate instance id fails', () => {
  const composition = composedComposition()
  composition.handlers.message = {
    id: 'install-hook',
    primitive: 'post-response',
    config: { text: 'Ready.' }
  }
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /is duplicated/.test(e)))
})

test('an unknown primitive fails', () => {
  const composition = composedComposition()
  composition.handlers.install.primitive = 'not-real'
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /is not registered/.test(e)))
})

test('a non-object config fails', () => {
  const composition = composedComposition()
  composition.handlers.install.config = 'text'
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /config is required and must be an object/.test(e)))
})

test('a missing required config field fails', () => {
  const composition = composedComposition()
  composition.handlers.install.config = {}
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /config\.text is required/.test(e)))
})

test('an extra config field fails when additionalProperties is false', () => {
  const composition = composedComposition()
  composition.handlers.install.config.unexpected = 'value'
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /config\.unexpected is not allowed/.test(e)))
})

test('a config field with the wrong type fails', () => {
  const composition = composedComposition()
  composition.handlers.install.config.text = 42
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /config\.text must be a string/.test(e)))
})

test('an enum violation fails', () => {
  const composition = composedComposition()
  composition.handlers.message = {
    id: 'message-hook',
    primitive: 'keyed-store',
    config: { key: 'k', mode: 'destroy' }
  }
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /must be one of/.test(e)))
})

test('a capability union mismatch fails', () => {
  const composition = composedComposition()
  composition.capabilities = []
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /capabilities is missing "post_message"/.test(e)))
})

test('a slot reference to an undeclared slot fails', () => {
  const composition = composedComposition()
  composition.handlers.install.config = { text: '{keyword}' }
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /slot reference "\{keyword\}"/.test(e)))
})

test('a slot reference that matches a declared slot passes', () => {
  const composition = composedComposition()
  composition.slots = { keyword: 'deploy' }
  composition.handlers.install.config = { text: 'Watching for {keyword}' }
  const result = validateComposition(composition)
  assert.equal(result.valid, true)
})

test('double-brace tokens do not count as slot references', () => {
  const composition = composedComposition()
  composition.handlers.message = {
    id: 'message-hook',
    primitive: 'watch-pattern',
    config: { pattern: 'deploy' },
    children: [
      {
        id: 'post-hook',
        primitive: 'post-response',
        config: { text: 'Match: {{match}}' }
      }
    ]
  }
  composition.capabilities.push('read_content')
  const result = validateComposition(composition)
  assert.equal(result.valid, true)
})

test('nested children are validated', () => {
  const composition = composedComposition()
  composition.handlers.message = {
    id: 'message-hook',
    primitive: 'watch-pattern',
    config: { pattern: 'deploy' },
    children: [
      {
        id: 'inner',
        primitive: 'not-real',
        config: {}
      }
    ]
  }
  composition.capabilities.push('read_content')
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /is not registered/.test(e)))
})

test('a valid command passes', () => {
  const composition = composedComposition()
  composition.capabilities.push('read_commands')
  composition.commands = {
    save: {
      id: 'save-cmd',
      primitive: 'expose-command',
      config: { name: 'save' },
      children: [
        {
          id: 'save-respond',
          primitive: 'post-response',
          config: { text: 'Saved.' }
        }
      ]
    }
  }
  const result = validateComposition(composition)
  assert.equal(result.valid, true)
})

test('a command key that fails the pattern fails', () => {
  const composition = composedComposition()
  composition.commands = {
    Save_It: {
      id: 'save-cmd',
      primitive: 'expose-command',
      config: { name: 'Save_It' }
    }
  }
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /command name must match/.test(e)))
})

test('a command whose config.name differs from the key fails', () => {
  const composition = composedComposition()
  composition.commands = {
    save: {
      id: 'save-cmd',
      primitive: 'expose-command',
      config: { name: 'other' }
    }
  }
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /config\.name must equal "save"/.test(e)))
})

test('a valid trigger passes', () => {
  const composition = composedComposition()
  composition.triggers = [
    {
      id: 'daily',
      primitive: 'schedule-task',
      config: { name: 'daily', cron: '0 9 * * *' },
      children: [
        {
          id: 'post-daily',
          primitive: 'post-response',
          config: { text: 'Daily.' }
        }
      ]
    }
  ]
  const result = validateComposition(composition)
  assert.equal(result.valid, true)
})

test('a trigger with an empty cron fails', () => {
  const composition = composedComposition()
  composition.triggers = [
    {
      id: 'daily',
      primitive: 'schedule-task',
      config: { name: 'daily', cron: '' },
      children: [
        {
          id: 'post-daily',
          primitive: 'post-response',
          config: { text: 'Daily.' }
        }
      ]
    }
  ]
  const result = validateComposition(composition)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => /config\.cron/.test(e)))
})

test('validateComposition does not mutate the input', () => {
  const composition = composedComposition()
  const before = JSON.stringify(composition)
  validateComposition(composition)
  assert.equal(JSON.stringify(composition), before)
})
