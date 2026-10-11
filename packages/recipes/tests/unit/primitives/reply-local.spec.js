// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { replyLocal } from '../../../src/primitives/reply-local.js'
import { asCommandDecl } from '../../../src/primitives/entry.js'

/**
 * A minimal handler context. The primitive does not read it.
 * @returns {object} An empty ctx.
 */
function ctx () {
  return {}
}

test('reply-local has the expected shape', () => {
  assert.equal(replyLocal.id, 'reply-local')
  assert.deepEqual(replyLocal.targets, ['bot'])
  assert.deepEqual(replyLocal.capabilities, [])
  assert.equal(typeof replyLocal.label, 'string')
  assert.equal(typeof replyLocal.description, 'string')
  assert.equal(typeof replyLocal.configSchema, 'object')
  assert.equal(typeof replyLocal.create, 'function')
})

test('config schema requires text', () => {
  assert.deepEqual(replyLocal.configSchema.required, ['text'])
  assert.equal(replyLocal.configSchema.properties.text.type, 'string')
})

test('create returns a function', () => {
  const handler = replyLocal.create({ text: 'hello' })
  assert.equal(typeof handler, 'function')
})

test('create throws when text is missing', () => {
  assert.throws(() => replyLocal.create({}), /config\.text is required/)
})

test('create throws when text is empty', () => {
  assert.throws(() => replyLocal.create({ text: '' }), /config\.text is required/)
})

test('create throws when text is not a string', () => {
  assert.throws(() => replyLocal.create({ text: 5 }), /config\.text is required/)
})

test('handler returns a local_message CommandResult', async () => {
  const handler = replyLocal.create({ text: 'hello there' })
  const result = await handler(ctx(), {})
  assert.deepEqual(result, { type: 'local_message', content: 'hello there' })
})

test('handler substitutes a single-token template and coerces to string', async () => {
  const handler = replyLocal.create({ text: '{{args.question}}' })
  const result = await handler(ctx(), { args: { question: 'what is 2+2?' } })
  assert.deepEqual(result, { type: 'local_message', content: 'what is 2+2?' })
})

test('handler coerces a numeric single-token value to string', async () => {
  const handler = replyLocal.create({ text: '{{args.count}}' })
  const result = await handler(ctx(), { args: { count: 42 } })
  assert.equal(result.content, '42')
  assert.equal(typeof result.content, 'string')
})

test('handler substitutes a mixed template', async () => {
  const handler = replyLocal.create({ text: 'You asked: {{args.question}}' })
  const result = await handler(ctx(), { args: { question: 'why?' } })
  assert.equal(result.content, 'You asked: why?')
})

test('handler substitutes a nested path', async () => {
  const handler = replyLocal.create({ text: '{{event.data.text}}' })
  const result = await handler(ctx(), { event: { data: { text: 'nested' } } })
  assert.equal(result.content, 'nested')
})

test('handler throws when the resolved text is empty', async () => {
  const handler = replyLocal.create({ text: '{{args.text}}' })
  await assert.rejects(
    () => handler(ctx(), { args: { text: '' } }),
    /resolved text is empty/
  )
})

test('handler throws when a template path is not resolvable', async () => {
  const handler = replyLocal.create({ text: '{{missing}}' })
  await assert.rejects(
    () => handler(ctx(), {}),
    /path "missing" is not resolvable/
  )
})

test('the primitive is registered under primitives.bot', async () => {
  const { primitives, getPrimitive } = await import('../../../src/primitives/index.js')
  assert.equal(getPrimitive('bot', 'reply-local'), replyLocal)
  assert.ok(Object.hasOwn(primitives.bot, 'reply-local'))
})

test('the primitive is re-exported from entry.js', async () => {
  const entry = await import('../../../src/primitives/entry.js')
  assert.equal(entry.replyLocal, replyLocal)
})

test('the return value flows through asCommandDecl unchanged', async () => {
  const inner = replyLocal.create({ text: 'private reply' })
  const decl = asCommandDecl('ask', 'Ask a question.', {}, inner)
  const reader = { get: () => undefined }
  const result = await decl.handler(ctx(), reader)
  assert.deepEqual(result, { type: 'local_message', content: 'private reply' })
})

test('the return value flows through expose-command to asCommandDecl', async () => {
  const { exposeCommand } = await import('../../../src/primitives/expose-command.js')
  const inner = replyLocal.create({ text: 'from {{args.q}}' })
  const command = exposeCommand.create({ name: 'ask' }, [inner])
  const decl = asCommandDecl('ask', undefined, { q: { type: 'string' } }, command)
  const reader = { get: (key) => (key === 'q' ? 'the question' : undefined) }
  const result = await decl.handler(ctx(), reader)
  assert.deepEqual(result, { type: 'local_message', content: 'from the question' })
})
