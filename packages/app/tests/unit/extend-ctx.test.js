import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createCtx, defineExtension } from '@atoll/extend'

describe('createCtx unit tests', () => {
  const ext = defineExtension({
    id: 'vendor.ctx-test',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: {
      route: 'ctx-test',
      component: 'ctx-test-view',
      title: 'Ctx Test'
    }
  })

  test("1. createCtx returns an object with id equal to extension's id", () => {
    const ctx = createCtx({ extension: ext })
    assert.equal(ctx.id, 'vendor.ctx-test')
  })

  test('2. surface, scope, selection, position default to null', () => {
    const ctx = createCtx({ extension: ext })
    assert.equal(ctx.surface, null)
    assert.equal(ctx.scope, null)
    assert.equal(ctx.selection, null)
    assert.equal(ctx.position, null)
  })

  test('3. surface reflects invocation.surface when provided', () => {
    const ctx = createCtx({
      extension: ext,
      invocation: {
        surface: 'panel',
        scope: { roomId: 'r1' },
        selection: { msgId: 'm1' },
        position: 'top'
      }
    })
    assert.equal(ctx.surface, 'panel')
    assert.deepEqual(ctx.scope, { roomId: 'r1' })
    assert.deepEqual(ctx.selection, { msgId: 'm1' })
    assert.equal(ctx.position, 'top')
  })

  test('4. state is an empty object when no service is provided', () => {
    const ctx = createCtx({ extension: ext })
    assert.deepEqual(ctx.state, {})
  })

  test('5. state reflects the provided service when present', () => {
    const mockState = { counter: 42 }
    const ctx = createCtx({
      extension: ext,
      services: { state: mockState }
    })
    assert.equal(ctx.state, mockState)
    assert.equal(ctx.state.counter, 42)
  })

  test('6. navigate throws when the service is missing', () => {
    const ctx = createCtx({ extension: ext })
    assert.throws(() => {
      ctx.navigate('/test')
    }, /ctx\.navigate is not available\. The router plugin is not registered\./)
  })

  test('7. navigate calls the service when present', () => {
    let calledWith = null
    const ctx = createCtx({
      extension: ext,
      services: {
        navigate: (target) => {
          calledWith = target
        }
      }
    })
    ctx.navigate('/settings')
    assert.equal(calledWith, '/settings')
  })

  test('8. storage.get throws when the service is missing', () => {
    const ctx = createCtx({ extension: ext })
    assert.throws(() => {
      ctx.storage.get('key')
    }, /ctx\.storage\.get is not available\./)
  })

  test('9. storage.get calls the service when present', () => {
    const store = new Map([['myKey', 'myVal']])
    const ctx = createCtx({
      extension: ext,
      services: {
        storage: {
          get: (key) => store.get(key),
          set: (key, val) => store.set(key, val),
          delete: (key) => store.delete(key),
          clear: () => store.clear()
        }
      }
    })
    assert.equal(ctx.storage.get('myKey'), 'myVal')
  })

  test('10. The returned ctx is a fresh object each call (mutating one does not affect another)', () => {
    const ctx1 = createCtx({ extension: ext })
    const ctx2 = createCtx({ extension: ext })
    assert.notEqual(ctx1, ctx2)
    ctx1.customProp = 123
    assert.equal(ctx2.customProp, undefined)
  })
})
