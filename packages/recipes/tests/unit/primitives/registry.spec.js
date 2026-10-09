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
  configSchema: { type: 'object', properties: {} },
  create: () => ({})
}

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
  assert.equal(getPrimitive('unknown', 'anything'), undefined)
})

test('listPrimitives returns an empty array for the empty extension target', () => {
  assert.deepEqual(listPrimitives('extension'), [])
})

test('listPrimitives returns an empty array for an unknown target', () => {
  assert.deepEqual(listPrimitives('unknown'), [])
})

test('getPrimitive finds a fixture placed in the registry', () => {
  primitives.bot.fixture = fixture
  assert.equal(getPrimitive('bot', 'fixture'), fixture)
  delete primitives.bot.fixture
})

test('listPrimitives returns sorted ids', () => {
  primitives.extension.zebra = { ...fixture, id: 'zebra', targets: ['extension'] }
  primitives.extension.alpha = { ...fixture, id: 'alpha', targets: ['extension'] }
  primitives.extension.middle = { ...fixture, id: 'middle', targets: ['extension'] }
  assert.deepEqual(listPrimitives('extension'), ['alpha', 'middle', 'zebra'])
  delete primitives.extension.zebra
  delete primitives.extension.alpha
  delete primitives.extension.middle
})
