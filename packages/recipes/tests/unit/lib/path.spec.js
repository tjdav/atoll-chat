// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readPath } from '../../../src/lib/path.js'

test('reads a top-level property', () => {
  assert.equal(readPath({ a: 1 }, 'a'), 1)
})

test('reads a nested property', () => {
  assert.equal(readPath({ a: { b: { c: 'x' } } }, 'a.b.c'), 'x')
})

test('reads an array index', () => {
  assert.equal(readPath({ items: ['x', 'y'] }, 'items.1'), 'y')
})

test('returns the source when path is a single segment', () => {
  const source = { a: { b: 1 } }
  assert.equal(readPath(source, 'a'), source.a)
})

test('returns undefined-valued properties', () => {
  assert.equal(readPath({ a: undefined }, 'a'), undefined)
})

test('returns null-valued properties', () => {
  assert.equal(readPath({ a: null }, 'a'), null)
})

test('throws when a top-level property is missing', () => {
  assert.throws(
    () => readPath({ a: 1 }, 'b'),
    /path "b" is not resolvable/
  )
})

test('throws when a nested property is missing', () => {
  assert.throws(
    () => readPath({ a: { b: 1 } }, 'a.c'),
    /path "a.c" is not resolvable/
  )
})

test('throws when traversing through null', () => {
  assert.throws(
    () => readPath({ a: null }, 'a.b'),
    /path "a.b" is not resolvable/
  )
})

test('throws when traversing through undefined', () => {
  assert.throws(
    () => readPath({ a: undefined }, 'a.b'),
    /path "a.b" is not resolvable/
  )
})

test('throws when traversing through a primitive', () => {
  assert.throws(
    () => readPath({ a: 5 }, 'a.b'),
    /path "a.b" is not resolvable/
  )
})

test('throws when the source is not an object', () => {
  assert.throws(
    () => readPath(null, 'a'),
    /path "a" is not resolvable/
  )
})

test('throws when the source is a string', () => {
  assert.throws(
    () => readPath('hello', 'length'),
    /path "length" is not resolvable/
  )
})
