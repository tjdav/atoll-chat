import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { defineExtension, EXTENSION_API_VERSION } from '@atoll/extend'

describe('defineExtension unit tests', () => {
  const validMinimalExt = {
    id: 'vendor.test-plugin',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: {
      route: 'test-plugin',
      component: 'x-test-plugin-view',
      title: 'Test Plugin'
    }
  }

  test('1. defineExtension returns a normalized object', () => {
    const res = defineExtension(validMinimalExt)
    assert.equal(typeof res, 'object')
    assert.equal(res.id, 'vendor.test-plugin')
  })

  test('2. Every default is applied', () => {
    const res = defineExtension(validMinimalExt)
    assert.deepEqual(res.permissions, [])
    assert.equal(res.rail, null)
    assert.equal(res.list, null)
    assert.deepEqual(res.slots, [])
    assert.deepEqual(res.emits, [])
    assert.deepEqual(res.publicEvents, [])
    assert.deepEqual(res.listens, [])
    assert.deepEqual(res.sessions, [])
    assert.deepEqual(res.preferences, [])
    assert.equal(res.locales, null)
    assert.deepEqual(res.assets, [])
    assert.equal(res.onRegister, null)
    assert.equal(res.onActivate, null)
    assert.equal(res.onDeactivate, null)
  })

  test('3. detail.surfaces defaults to ["panel"]', () => {
    const res = defineExtension(validMinimalExt)
    assert.deepEqual(res.detail.surfaces, ['panel'])
  })

  test('4. detail.defaultSurface defaults to "panel"', () => {
    const res = defineExtension(validMinimalExt)
    assert.equal(res.detail.defaultSurface, 'panel')
  })

  test('5. The input object is not mutated', () => {
    const input = {
      id: 'vendor.immutable-test',
      apiVersion: '1.0.0',
      hostApi: '2.0.0',
      detail: {
        route: 'immutable-test',
        component: 'x-immutable-test-view',
        title: 'Immutable Test'
      }
    }
    const inputCopy = JSON.parse(JSON.stringify(input))
    defineExtension(input)
    assert.deepEqual(input, inputCopy)
  })

  test('6. _sdkApiVersion is attached', () => {
    const res = defineExtension(validMinimalExt)
    assert.equal(res._sdkApiVersion, EXTENSION_API_VERSION)
  })

  test('7. A missing id throws', () => {
    assert.throws(() => {
      defineExtension({
        apiVersion: '1.0.0',
        hostApi: '2.0.0',
        detail: { route: 'a', component: 'x-test-view', title: 'c' }
      })
    }, /Extension id must be a non-empty string/)
  })

  test('8. A missing detail throws', () => {
    assert.throws(() => {
      defineExtension({
        id: 'vendor.test',
        apiVersion: '1.0.0',
        hostApi: '2.0.0'
      })
    }, /detail must be a plain object/)
  })

  test('9. An invalid id format throws', () => {
    assert.throws(() => {
      defineExtension({
        id: 'INVALID_ID!',
        apiVersion: '1.0.0',
        hostApi: '2.0.0',
        detail: { route: 'a', component: 'x-test-view', title: 'c' }
      })
    }, /id must match/)
  })

  test('10. An invalid detail.route format throws', () => {
    assert.throws(() => {
      defineExtension({
        id: 'vendor.test',
        apiVersion: '1.0.0',
        hostApi: '2.0.0',
        detail: { route: 'InvalidRoute!', component: 'x-test-view', title: 'c' }
      })
    }, /detail.route must match/)
  })

  test('11. label is required when rail is present', () => {
    assert.throws(() => {
      defineExtension({
        id: 'vendor.test',
        apiVersion: '1.0.0',
        hostApi: '2.0.0',
        rail: { icon: { name: 'test' }, order: 1 },
        detail: { route: 'test', component: 'x-test-view', title: 'Test' }
      })
    }, /label is required when rail is declared/)

    // Succeeds when label is provided
    const validWithRail = defineExtension({
      id: 'vendor.test',
      apiVersion: '1.0.0',
      hostApi: '2.0.0',
      label: 'Test Extension',
      rail: { icon: { name: 'test' }, order: 1 },
      detail: { route: 'test', component: 'x-test-view', title: 'Test' }
    })
    assert.equal(validWithRail.label, 'Test Extension')
  })

  test('12. A non-object argument throws', () => {
    assert.throws(() => {
      defineExtension(null)
    }, /defineExtension requires an object/)
    assert.throws(() => {
      defineExtension('invalid')
    }, /defineExtension requires an object/)
  })
})
