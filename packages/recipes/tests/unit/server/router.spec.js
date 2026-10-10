// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRouter } from '../../../src/server/router.js'

test('a fresh router has size 0', () => {
  const router = createRouter()
  assert.equal(router.size(), 0)
})

test('add registers a route and increments size', () => {
  const router = createRouter()
  router.add('GET', '/x', () => {})
  assert.equal(router.size(), 1)
})

test('add throws when method is not a non-empty string', () => {
  const router = createRouter()
  assert.throws(() => router.add('', '/x', () => {}), /method must be a non-empty string/)
  assert.throws(() => router.add(42, '/x', () => {}), /method must be a non-empty string/)
})

test('add throws when pattern does not start with a slash', () => {
  const router = createRouter()
  assert.throws(() => router.add('GET', 'x', () => {}), /pattern must start with "\/"/)
})

test('add throws when handler is not a function', () => {
  const router = createRouter()
  assert.throws(() => router.add('GET', '/x', null), /handler must be a function/)
})

test('match returns the handler for an exact path match', () => {
  const router = createRouter()
  const handler = () => {}
  router.add('GET', '/x', handler)
  const result = router.match('GET', '/x')
  assert.equal(result.handler, handler)
  assert.deepEqual(result.params, {})
})

test('match returns null when the method does not match', () => {
  const router = createRouter()
  router.add('GET', '/x', () => {})
  assert.equal(router.match('POST', '/x'), null)
})

test('match returns null when the path does not match', () => {
  const router = createRouter()
  router.add('GET', '/x', () => {})
  assert.equal(router.match('GET', '/y'), null)
})

test('match captures a single path parameter', () => {
  const router = createRouter()
  const handler = () => {}
  router.add('GET', '/v1/recipes/:id', handler)
  const result = router.match('GET', '/v1/recipes/abc')
  assert.equal(result.handler, handler)
  assert.deepEqual(result.params, { id: 'abc' })
})

test('match captures multiple parameters', () => {
  const router = createRouter()
  router.add('GET', '/v1/rooms/:roomId/bots/:botId', () => {})
  const result = router.match('GET', '/v1/rooms/r1/bots/b1')
  assert.deepEqual(result.params, { roomId: 'r1', botId: 'b1' })
})

test('match URL-decodes parameter values', () => {
  const router = createRouter()
  router.add('GET', '/x/:name', () => {})
  const result = router.match('GET', '/x/hello%20world')
  assert.equal(result.params.name, 'hello world')
})

test('match returns null when segment count differs', () => {
  const router = createRouter()
  router.add('GET', '/v1/recipes/:id', () => {})
  assert.equal(router.match('GET', '/v1/recipes'), null)
  assert.equal(router.match('GET', '/v1/recipes/a/b'), null)
})

test('match prefers the first registered route on tie', () => {
  const router = createRouter()
  const first = () => {}
  const second = () => {}
  router.add('GET', '/x/:id', first)
  router.add('GET', '/x/static', second)
  const result = router.match('GET', '/x/static')
  assert.equal(result.handler, first)
})

test('methodsFor returns every method registered for a path', () => {
  const router = createRouter()
  router.add('GET', '/x', () => {})
  router.add('POST', '/x', () => {})
  router.add('PUT', '/y', () => {})
  const methods = router.methodsFor('/x')
  assert.deepEqual(methods.sort(), ['GET', 'POST'])
})

test('methodsFor returns an empty array for an unknown path', () => {
  const router = createRouter()
  router.add('GET', '/x', () => {})
  assert.deepEqual(router.methodsFor('/y'), [])
})

test('methodsFor deduplicates methods', () => {
  const router = createRouter()
  router.add('GET', '/x', () => {})
  router.add('GET', '/x', () => {})
  assert.deepEqual(router.methodsFor('/x'), ['GET'])
})
