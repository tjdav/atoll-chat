// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateRecipe, formatErrors } from '../../../src/recipe/validate.js'

function validMinimalRecipe () {
  return {
    id: 'test-recipe',
    version: '1.0.0',
    label: 'Test Recipe',
    description: 'A minimal valid recipe for unit testing.',
    kind: 'pure',
    capabilities: ['post_message'],
    slots: [
      {
        name: 'greeting',
        type: 'string',
        question: 'What message should be posted?'
      }
    ],
    handlers: {
      message: {
        id: 'post-1',
        primitive: 'post-response',
        config: {
          text: '{greeting}'
        }
      }
    }
  }
}

describe('validateRecipe', () => {
  it('validates a minimal valid recipe', () => {
    const recipe = validMinimalRecipe()
    const res = validateRecipe(recipe)
    assert.deepEqual(res, { valid: true, recipe })
  })

  it('validates a recipe with optional targets, triggers, and constraints', () => {
    const recipe = {
      ...validMinimalRecipe(),
      targets: ['bot'],
      triggers: [
        {
          id: 'schedule-1',
          primitive: 'schedule-task',
          config: {
            name: 'daily',
            cron: '0 0 * * *'
          }
        }
      ],
      constraints: ['Does not support group chats']
    }
    const res = validateRecipe(recipe)
    assert.equal(res.valid, true)
  })

  it('fails when recipe is not a plain object', () => {
    assert.deepEqual(validateRecipe(null), { valid: false, errors: ['recipe must be a plain object'] })
    assert.deepEqual(validateRecipe('str'), { valid: false, errors: ['recipe must be a plain object'] })
    assert.deepEqual(validateRecipe([]), { valid: false, errors: ['recipe must be a plain object'] })
  })

  it('validates id field', () => {
    const r1 = validMinimalRecipe()
    delete r1.id
    const res1 = validateRecipe(r1)
    assert.equal(res1.valid, false)
    assert.ok(res1.errors.includes('id is required and must match ^[a-z][a-z0-9-]*$'))

    const r2 = { ...validMinimalRecipe(), id: 'Invalid_ID' }
    const res2 = validateRecipe(r2)
    assert.equal(res2.valid, false)
    assert.ok(res2.errors.includes('id is required and must match ^[a-z][a-z0-9-]*$'))
  })

  it('validates version field', () => {
    const r1 = validMinimalRecipe()
    delete r1.version
    const res1 = validateRecipe(r1)
    assert.equal(res1.valid, false)
    assert.ok(res1.errors.includes('version is required and must match semver (N.N.N)'))

    const r2 = { ...validMinimalRecipe(), version: 'v1.0.0' }
    const res2 = validateRecipe(r2)
    assert.equal(res2.valid, false)
    assert.ok(res2.errors.includes('version is required and must match semver (N.N.N)'))
  })

  it('validates label and description fields', () => {
    const r1 = { ...validMinimalRecipe(), label: '' }
    const res1 = validateRecipe(r1)
    assert.equal(res1.valid, false)
    assert.ok(res1.errors.includes('label is required and must be a non-empty string'))

    const r2 = { ...validMinimalRecipe(), description: '' }
    const res2 = validateRecipe(r2)
    assert.equal(res2.valid, false)
    assert.ok(res2.errors.includes('description is required and must be a non-empty string'))
  })

  it('validates kind field', () => {
    const r1 = { ...validMinimalRecipe(), kind: 'invalid-kind' }
    const res1 = validateRecipe(r1)
    assert.equal(res1.valid, false)
    assert.ok(res1.errors.includes('kind is required and must be one of pure, assisted, operated'))
  })

  it('validates targets field when provided', () => {
    const r1 = { ...validMinimalRecipe(), targets: [] }
    const res1 = validateRecipe(r1)
    assert.equal(res1.valid, false)
    assert.ok(res1.errors.includes('targets must be a non-empty array when provided'))

    const r2 = { ...validMinimalRecipe(), targets: ['invalid-target'] }
    const res2 = validateRecipe(r2)
    assert.equal(res2.valid, false)
    assert.ok(res2.errors.includes('targets contains invalid value "invalid-target"; must be one of bot, extension'))
  })

  it('validates capabilities field', () => {
    const r1 = validMinimalRecipe()
    delete r1.capabilities
    const res1 = validateRecipe(r1)
    assert.equal(res1.valid, false)
    assert.ok(res1.errors.includes('capabilities is required and must be an array'))

    const r2 = { ...validMinimalRecipe(), capabilities: ['invalid_capability'] }
    const res2 = validateRecipe(r2)
    assert.equal(res2.valid, false)
    assert.ok(res2.errors.includes('capabilities contains unknown value "invalid_capability"'))
  })

  it('validates slot shape and rules', () => {
    const r1 = { ...validMinimalRecipe(), slots: 'not-an-array' }
    const res1 = validateRecipe(r1)
    assert.equal(res1.valid, false)
    assert.ok(res1.errors.includes('slots is required and must be an array'))

    const r2 = {
      ...validMinimalRecipe(),
      slots: [
        {
          name: 'invalid_name',
          type: 'invalid_type',
          question: ''
        }
      ]
    }
    const res2 = validateRecipe(r2)
    assert.equal(res2.valid, false)
    assert.ok(res2.errors.includes('slots[0].name is required and must match ^[a-zA-Z][a-zA-Z0-9]*$'))
    assert.ok(res2.errors.includes('slots[0].type is required and must be one of string, number, boolean, select'))
    assert.ok(res2.errors.includes('slots[0].question is required and must be a non-empty string'))
  })

  it('validates duplicate slot names', () => {
    const r = {
      ...validMinimalRecipe(),
      slots: [
        { name: 'foo', type: 'string', question: 'Q1?' },
        { name: 'foo', type: 'string', question: 'Q2?' }
      ]
    }
    const res = validateRecipe(r)
    assert.equal(res.valid, false)
    assert.ok(res.errors.includes('slots[1].name "foo" is duplicated'))
  })

  it('validates slot select options', () => {
    const r1 = {
      ...validMinimalRecipe(),
      slots: [
        { name: 'choice', type: 'select', question: 'Select item?' }
      ]
    }
    const res1 = validateRecipe(r1)
    assert.equal(res1.valid, false)
    assert.ok(res1.errors.includes('slots[0].options is required and must be a non-empty array when type is "select"'))

    const r2 = {
      ...validMinimalRecipe(),
      slots: [
        { name: 'str', type: 'string', question: 'Enter text?', options: ['a', 'b'] }
      ]
    }
    const res2 = validateRecipe(r2)
    assert.equal(res2.valid, false)
    assert.ok(res2.errors.includes('slots[0].options is only valid when type is "select"'))
  })

  it('validates primitive instances and unknown primitive', () => {
    const r = {
      ...validMinimalRecipe(),
      handlers: {
        message: {
          id: 'p1',
          primitive: 'non-existent-primitive',
          config: {}
        }
      }
    }
    const res = validateRecipe(r)
    assert.equal(res.valid, false)
    assert.ok(res.errors.includes('handlers.message.primitive "non-existent-primitive" is not registered for targets ["bot"]'))
  })

  it('validates duplicate primitive instance ids', () => {
    const r = {
      ...validMinimalRecipe(),
      handlers: {
        h1: {
          id: 'dup-id',
          primitive: 'send-local',
          config: { text: 'hi' }
        },
        h2: {
          id: 'dup-id',
          primitive: 'send-local',
          config: { text: 'hello' }
        }
      }
    }
    const res = validateRecipe(r)
    assert.equal(res.valid, false)
    assert.ok(res.errors.includes('handlers.h2.id "dup-id" is duplicated within the composition'))
  })

  it('handles non-object handler instances gracefully without throwing', () => {
    const r = {
      ...validMinimalRecipe(),
      handlers: {
        invalidHandler: null
      }
    }
    const res = validateRecipe(r)
    assert.equal(res.valid, false)
    assert.ok(res.errors.includes('handlers.invalidHandler must be an object'))
  })

  it('validates primitive instance config and children shape', () => {
    const r1 = {
      ...validMinimalRecipe(),
      handlers: {
        message: {
          id: 'p1',
          primitive: 'post-response',
          config: null
        }
      }
    }
    const res1 = validateRecipe(r1)
    assert.equal(res1.valid, false)
    assert.ok(res1.errors.includes('handlers.message.config is required and must be an object'))

    const r2 = {
      ...validMinimalRecipe(),
      handlers: {
        message: {
          id: 'p1',
          primitive: 'post-response',
          config: { text: 'hello' },
          children: 'not-an-array'
        }
      }
    }
    const res2 = validateRecipe(r2)
    assert.equal(res2.valid, false)
    assert.ok(res2.errors.includes('handlers.message.children must be an array when provided'))
  })

  it('validates capability union superset requirement', () => {
    const r = {
      ...validMinimalRecipe(),
      capabilities: [],
      handlers: {
        message: {
          id: 'p1',
          primitive: 'post-response',
          config: { text: '{greeting}' }
        }
      }
    }
    const res = validateRecipe(r)
    assert.equal(res.valid, false)
    assert.ok(res.errors.includes('capabilities is missing "post_message" which is required by a composed primitive'))
  })

  it('validates slot reference checks', () => {
    const r = {
      ...validMinimalRecipe(),
      slots: [],
      handlers: {
        message: {
          id: 'p1',
          primitive: 'send-local',
          config: { text: '{undeclaredSlot}' }
        }
      }
    }
    const res = validateRecipe(r)
    assert.equal(res.valid, false)
    assert.ok(res.errors.includes('slot reference "{undeclaredSlot}" does not match any declared slot'))
  })

  it('ignores double-brace tokens when checking slot references', () => {
    const r = {
      ...validMinimalRecipe(),
      slots: [],
      handlers: {
        message: {
          id: 'p1',
          primitive: 'send-local',
          config: { text: '{{doubleBracePath}}' }
        }
      }
    }
    const res = validateRecipe(r)
    assert.equal(res.valid, true)
  })

  it('validates empty slots and handlers arrays/objects', () => {
    const r = {
      ...validMinimalRecipe(),
      slots: [],
      handlers: {}
    }
    const res = validateRecipe(r)
    assert.equal(res.valid, true)
  })

  it('formatErrors formats error lists into numbered strings', () => {
    const formatted = formatErrors(['First error', 'Second error'])
    assert.equal(formatted, '1. First error\n2. Second error')
  })
})
