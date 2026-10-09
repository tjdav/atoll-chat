// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  primitives,
  getPrimitive,
  listPrimitives
} from '../../../src/primitives/index.js'

/**
 * A fixture primitive. Not registered anywhere. Used to verify that
 * the lookup helpers return the right things when a registry is
 * populated.
 * @type {Primitive}
 */
const fixture = {
  id: 'fixture',
  targets: ['bot'],
  capabilities: [],
  label: 'Fixture',
  description: 'A fixture primitive for tests.',
  configSchema: {
    type: 'object',
    properties: {}
  },
  create: () => ({})
}

/** @type {any} */
const unknownTarget = 'unknown'

test('registry has both target keys', () => {
  assert.ok(Object.hasOwn(primitives, 'bot'))
  assert.ok(Object.hasOwn(primitives, 'extension'))
})

test('registry target values are objects', () => {
  assert.equal(typeof primitives.bot, 'object')
  assert.equal(typeof primitives.extension, 'object')
})

test('getPrimitive returns undefined for an unknown id', () => {
  assert.equal(getPrimitive('bot', 'does-not-exist'), undefined)
})

test('getPrimitive returns undefined for an unknown target', () => {
  assert.equal(getPrimitive(unknownTarget, 'anything'), undefined)
})

test('listPrimitives returns an empty array for an empty target', () => {
  assert.deepEqual(listPrimitives('bot'), [])
  assert.deepEqual(listPrimitives('extension'), [])
})

test('listPrimitives returns an empty array for an unknown target', () => {
  assert.deepEqual(listPrimitives(unknownTarget), [])
})

test('getPrimitive finds a fixture placed in the registry', () => {
  primitives.bot.fixture = fixture
  assert.equal(getPrimitive('bot', 'fixture'), fixture)
  delete primitives.bot.fixture
})

test('listPrimitives returns sorted ids', () => {
  primitives.bot.zebra = {
    ...fixture,
    id: 'zebra'
  }
  primitives.bot.alpha = {
    ...fixture,
    id: 'alpha'
  }
  primitives.bot.middle = {
    ...fixture,
    id: 'middle'
  }
  assert.deepEqual(listPrimitives('bot'), ['alpha', 'middle', 'zebra'])
  delete primitives.bot.zebra
  delete primitives.bot.alpha
  delete primitives.bot.middle
})
