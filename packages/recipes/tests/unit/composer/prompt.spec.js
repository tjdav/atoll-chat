// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { buildComposerMessages } from '../../../src/composer/prompt.js'
import * as primitivesRegistry from '../../../src/primitives/index.js'
import { scanLibrary } from '../../../src/recipe/library.js'

const RECIPES_DIR = fileURLToPath(new URL('../../../recipes', import.meta.url))

test('buildComposerMessages returns an array of length 2 when previousErrors is absent', async () => {
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const messages = buildComposerMessages(
    { intent: 'make a bot that says hello' },
    primitivesRegistry,
    libraryScan.recipes
  )

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[1].role, 'user')
})

test('buildComposerMessages returns an array of length 2 when previousErrors is empty', async () => {
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const messages = buildComposerMessages(
    { intent: 'make a bot that says hello', previousErrors: [] },
    primitivesRegistry,
    libraryScan.recipes
  )

  assert.equal(messages.length, 2)
})

test('buildComposerMessages returns an array of length 3 when previousErrors is non-empty', async () => {
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const errors = [
    { code: 'INSTANCE_INVALID_CONFIG', path: 'handlers.message.config', message: 'text is required' },
    { code: 'UNRESOLVED_SLOT_REF', path: 'handlers.message.config.text', message: 'slot "{foo}" not defined' }
  ]
  const messages = buildComposerMessages(
    { intent: 'make a bot that says hello', previousErrors: errors },
    primitivesRegistry,
    libraryScan.recipes
  )

  assert.equal(messages.length, 3)
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[1].role, 'user')
  assert.equal(messages[2].role, 'user')

  assert.match(messages[2].content, /The previous attempt failed validation\./)
  assert.match(messages[2].content, /-\s*\[INSTANCE_INVALID_CONFIG\]\s*handlers\.message\.config:\s*text is required/)
  assert.match(messages[2].content, /-\s*\[UNRESOLVED_SLOT_REF\]\s*handlers\.message\.config\.text:\s*slot "{foo}" not defined/)
  assert.match(messages[2].content, /Please produce a corrected Composition fixing all validation errors listed above\./)
})

test('system message contains every primitive id from listPrimitives("bot") sorted', async () => {
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const messages = buildComposerMessages(
    { intent: 'test bot' },
    primitivesRegistry,
    libraryScan.recipes
  )

  const systemContent = messages[0].content
  const expectedIds = primitivesRegistry.listPrimitives('bot')

  for (const id of expectedIds) {
    assert.ok(
      systemContent.includes(`Primitive: ${id}`),
      `system message missing primitive ${id}`
    )
  }

  const primitiveIndices = expectedIds.map((id) => systemContent.indexOf(`Primitive: ${id}`))
  for (let i = 0; i < primitiveIndices.length - 1; i++) {
    assert.ok(
      primitiveIndices[i] < primitiveIndices[i + 1],
      `primitive ${expectedIds[i]} should appear before ${expectedIds[i + 1]}`
    )
  }
})

test('system message contains primitive config schema verbatim', async () => {
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const messages = buildComposerMessages(
    { intent: 'test bot' },
    primitivesRegistry,
    libraryScan.recipes
  )

  const postResponsePrim = primitivesRegistry.getPrimitive('bot', 'post-response')
  assert.ok(postResponsePrim)
  const expectedSchema = JSON.stringify(postResponsePrim.configSchema)

  assert.ok(
    messages[0].content.includes(expectedSchema),
    'system message should contain config schema verbatim'
  )
})

test('system message contains label and description of every recipe in library', async () => {
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const messages = buildComposerMessages(
    { intent: 'test bot' },
    primitivesRegistry,
    libraryScan.recipes
  )

  const systemContent = messages[0].content

  for (const recipe of libraryScan.recipes) {
    assert.ok(
      systemContent.includes(`Recipe: ${recipe.id}`),
      `system message missing recipe ${recipe.id}`
    )
    assert.ok(
      systemContent.includes(`Label: ${recipe.label}`),
      `system message missing recipe label for ${recipe.id}`
    )
    assert.ok(
      systemContent.includes(`Description: ${recipe.description}`),
      `system message missing recipe description for ${recipe.id}`
    )
  }
})

test('system message contains validation contract codes', async () => {
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const messages = buildComposerMessages(
    { intent: 'test bot' },
    primitivesRegistry,
    libraryScan.recipes
  )

  const systemContent = messages[0].content
  const codes = [
    'INVALID_SOURCE',
    'INVALID_TARGET',
    'INVALID_SLOTS',
    'INVALID_HANDLERS',
    'INVALID_COMMANDS',
    'INVALID_TRIGGERS',
    'INVALID_CAPABILITIES',
    'INSTANCE_MISSING_ID',
    'INSTANCE_DUPLICATE_ID',
    'INSTANCE_MISSING_PRIMITIVE',
    'INSTANCE_INVALID_CONFIG',
    'UNRESOLVED_SLOT_REF'
  ]

  for (const code of codes) {
    assert.ok(
      systemContent.includes(code),
      `system message missing validation code ${code}`
    )
  }
})

test('system message instructs LLM not to emit recipeId', async () => {
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const messages = buildComposerMessages(
    { intent: 'test bot' },
    primitivesRegistry,
    libraryScan.recipes
  )

  const systemContent = messages[0].content
  assert.match(
    systemContent,
    /Do not emit recipeId or recipeVersion/
  )
})

test('user message contains intent verbatim', async () => {
  const intentText = 'Build a daily reminder bot at 9 AM'
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const messages = buildComposerMessages(
    { intent: intentText },
    primitivesRegistry,
    libraryScan.recipes
  )

  assert.equal(messages[1].role, 'user')
  assert.equal(messages[1].content, `The user wants: ${intentText}`)
})

test('buildComposerMessages is deterministic', async () => {
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const input = {
    intent: 'create a note taking bot',
    previousErrors: [{ code: 'INVALID_SOURCE', path: 'source', message: 'must be composed' }]
  }

  const run1 = buildComposerMessages(input, primitivesRegistry, libraryScan.recipes)
  const run2 = buildComposerMessages(input, primitivesRegistry, libraryScan.recipes)

  assert.deepEqual(run1, run2)
})

test('buildComposerMessages does not mutate input', async () => {
  const libraryScan = await scanLibrary(RECIPES_DIR)
  const input = {
    intent: 'create a note taking bot',
    previousErrors: [{ code: 'INVALID_SOURCE', path: 'source', message: 'must be composed' }]
  }

  const copy = JSON.parse(JSON.stringify(input))
  buildComposerMessages(input, primitivesRegistry, libraryScan.recipes)

  assert.deepEqual(input, copy)
})

test('buildComposerMessages works with stub registry and stub library', () => {
  const stubRegistry = {
    listPrimitives: (target) => target === 'bot' ? ['echo'] : [],
    getPrimitive: (target, id) => {
      if (target === 'bot' && id === 'echo') {
        return {
          id: 'echo',
          label: 'Echo',
          description: 'Echoes input back.',
          capabilities: ['post_message'],
          configSchema: { type: 'object', properties: { text: { type: 'string' } } },
          create: () => () => {}
        }
      }
      return undefined
    }
  }

  const stubLibrary = [
    { id: 'echo-bot', label: 'Echo Bot', description: 'Simple echo bot.' }
  ]

  const messages = buildComposerMessages(
    { intent: 'stub intent' },
    stubRegistry,
    stubLibrary
  )

  assert.equal(messages.length, 2)
  assert.ok(messages[0].content.includes('Primitive: echo'))
  assert.ok(messages[0].content.includes('Recipe: echo-bot'))
  assert.equal(messages[1].content, 'The user wants: stub intent')
})
