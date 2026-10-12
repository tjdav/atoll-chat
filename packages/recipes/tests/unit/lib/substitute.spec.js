// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { substitute } from '../../../src/lib/substitute.js'

test('returns non-string primitives unchanged', () => {
  assert.equal(substitute(42, {}), 42)
  assert.equal(substitute(true, {}), true)
  assert.equal(substitute(null, {}), null)
  assert.equal(substitute(undefined, {}), undefined)
})

test('returns a string with no tokens unchanged', () => {
  assert.equal(substitute('hello world', {}), 'hello world')
})

test('resolves a single-token string preserving type', () => {
  assert.equal(substitute('{{match}}', { match: 'abc' }), 'abc')
  assert.equal(substitute('{{count}}', { count: 7 }), 7)
  assert.equal(substitute('{{flag}}', { flag: false }), false)
})

test('resolves a mixed string by coercing to string', () => {
  assert.equal(substitute('id-{{id}}', { id: 42 }), 'id-42')
  assert.equal(substitute('{{a}}/{{b}}', { a: 'x', b: 'y' }), 'x/y')
})

test('resolves nested paths', () => {
  const input = { event: { data: { id: 'm_1' } } }
  assert.equal(substitute('{{event.data.id}}', input), 'm_1')
})

test('walks objects recursively', () => {
  const input = { match: 'x' }
  const config = { key: 'k:{{match}}', meta: { source: '{{match}}' } }
  assert.deepEqual(substitute(config, input), {
    key: 'k:x',
    meta: { source: 'x' }
  })
})

test('walks arrays recursively', () => {
  const input = { match: 'x' }
  const config = ['{{match}}', { k: '{{match}}' }]
  assert.deepEqual(substitute(config, input), ['x', { k: 'x' }])
})

test('throws when a path cannot be resolved', () => {
  assert.throws(
    () => substitute('{{missing}}', { other: 1 }),
    /path "missing" is not resolvable/
  )
})

test('throws when a nested path segment is missing', () => {
  assert.throws(
    () => substitute('{{event.data.id}}', { event: {} }),
    /path "event.data.id" is not resolvable/
  )
})

test('throws when a path traverses a non-object', () => {
  assert.throws(
    () => substitute('{{a.b}}', { a: 5 }),
    /path "a.b" is not resolvable/
  )
})

test('does not mutate the input config', () => {
  const input = { match: 'x' }
  const config = { key: 'k:{{match}}', list: ['{{match}}'] }
  const configCopy = JSON.parse(JSON.stringify(config))
  substitute(config, input)
  assert.deepEqual(config, configCopy)
})

test('resolves {{.}} to the whole input', () => {
  assert.equal(substitute('{{.}}', 'hello'), 'hello')
})

test('{{.}} preserves the input type when single-token', () => {
  assert.equal(substitute('{{.}}', 42), 42)
  assert.equal(substitute('{{.}}', true), true)
  assert.equal(substitute('{{.}}', null), null)
  assert.deepEqual(substitute('{{.}}', { a: 1 }), { a: 1 })
  assert.deepEqual(substitute('{{.}}', [1, 2]), [1, 2])
})

test('{{.}} in a mixed string coerces to string', () => {
  assert.equal(substitute('value: {{.}}', 'hello'), 'value: hello')
  assert.equal(substitute('count: {{.}}', 7), 'count: 7')
  assert.equal(substitute('[{{.}}]', true), '[true]')
})

test('{{.}} combined with other paths works', () => {
  assert.equal(
    substitute('name: {{name}}, raw: {{.}}', { name: 'Alice' }),
    'name: Alice, raw: [object Object]'
  )
})

test('{{.}} on undefined input returns undefined as a single token', () => {
  assert.equal(substitute('{{.}}', undefined), undefined)
})

test('{{.}} on undefined input in a mixed string coerces to "undefined"', () => {
  assert.equal(substitute('value: {{.}}', undefined), 'value: undefined')
})

test('{{.}} walks through nested config values', () => {
  const config = { text: '{{.}}', meta: { inner: '{{.}}' } }
  assert.deepEqual(substitute(config, 'x'), { text: 'x', meta: { inner: 'x' } })
})
