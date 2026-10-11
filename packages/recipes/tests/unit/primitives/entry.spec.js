// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { asCommandDecl } from '../../../src/primitives/entry.js'

/**
 * Builds a mock ArgsReader that returns configured values.
 * @param {Record<string, unknown>} values - The backing values.
 * @returns {object} An ArgsReader-shaped object that records reads.
 */
function makeReader (values) {
  const reads = []
  return {
    reads,
    get (key) {
      reads.push(key)
      return values[key]
    }
  }
}

test('asCommandDecl returns the expected shape', () => {
  const decl = asCommandDecl('save', 'Save it.', { url: { type: 'string' } }, async () => {})
  assert.equal(typeof decl, 'object')
  assert.deepEqual(decl.args, { url: { type: 'string' } })
  assert.equal(typeof decl.handler, 'function')
  assert.equal(decl.description, 'Save it.')
})

test('asCommandDecl omits description when undefined', () => {
  const decl = asCommandDecl('save', undefined, {}, async () => {})
  assert.equal(Object.hasOwn(decl, 'description'), false)
})

test('asCommandDecl defaults args to an empty object', () => {
  const decl = asCommandDecl('save', undefined, undefined, async () => {})
  assert.deepEqual(decl.args, {})
})

test('asCommandDecl unwraps the reader into a plain object', async () => {
  let captured = null
  const inner = async (ctx, payload) => {
    captured = payload
  }
  const decl = asCommandDecl(
    'save',
    'Save it.',
    { url: { type: 'string' }, title: { type: 'string' } },
    inner
  )
  const reader = makeReader({ url: 'https://example.com', title: 'Example' })
  await decl.handler({}, reader)
  assert.deepEqual(captured, {
    args: { url: 'https://example.com', title: 'Example' },
    command: 'save'
  })
})

test('asCommandDecl reads only the declared argument keys', async () => {
  const inner = async () => {}
  const decl = asCommandDecl(
    'save',
    undefined,
    { url: { type: 'string' } },
    inner
  )
  const reader = makeReader({ url: 'x', title: 'y' })
  await decl.handler({}, reader)
  assert.deepEqual(reader.reads, ['url'])
})

test('asCommandDecl returns a valid CommandResult', async () => {
  const inner = async () => {}
  const decl = asCommandDecl('save', undefined, {}, inner)
  const result = await decl.handler({}, makeReader({}))
  assert.deepEqual(result, { type: 'none' })
})

test('asCommandDecl awaits the inner handler before returning', async () => {
  const order = []
  const inner = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    order.push('inner')
  }
  const decl = asCommandDecl('save', undefined, {}, inner)
  await decl.handler({}, makeReader({}))
  order.push('after')
  assert.deepEqual(order, ['inner', 'after'])
})

test('asCommandDecl passes the ctx through to the inner handler', async () => {
  let capturedCtx = null
  const inner = async (ctx) => {
    capturedCtx = ctx
  }
  const decl = asCommandDecl('save', undefined, {}, inner)
  const ctx = { marker: 'test' }
  await decl.handler(ctx, makeReader({}))
  assert.equal(capturedCtx, ctx)
})

test('asCommandDecl with no declared args passes an empty object', async () => {
  let captured = null
  const inner = async (ctx, payload) => {
    captured = payload
  }
  const decl = asCommandDecl('save', undefined, {}, inner)
  await decl.handler({}, makeReader({}))
  assert.deepEqual(captured.args, {})
})
