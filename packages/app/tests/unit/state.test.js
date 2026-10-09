import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SHELL_STATE, createStateStore } from '../../src/lib/state/index.js'

test('1. DEFAULT_SHELL_STATE includes storageReady: false and storagePersistent: true', () => {
  assert.equal(DEFAULT_SHELL_STATE.storageReady, false)
  assert.equal(DEFAULT_SHELL_STATE.storagePersistent, true)
})

test('2. createStateStore() with no initialState returns store with default storage readiness keys', () => {
  const store = createStateStore()
  assert.equal(store.$state.storageReady, false)
  assert.equal(store.$state.storagePersistent, true)
  assert.equal(store.$state.isAuthenticated, false)
})

test('3. initialState merges over defaults', () => {
  const store = createStateStore({ initialState: { isAuthenticated: true, customKey: 'hello' } })
  assert.equal(store.$state.isAuthenticated, true)
  assert.equal(store.$state.customKey, 'hello')
  assert.equal(store.$state.storageReady, false)
})

test('4. Writing a key updates $state.foo', () => {
  const store = createStateStore()
  store.$state.foo = 'bar'
  assert.equal(store.$state.foo, 'bar')
})

test('5. Writing a key fires the subscriber with (newValue, oldValue)', () => {
  const store = createStateStore()
  const calls = []
  store.subscribe('foo', (val, oldVal) => {
    calls.push({ val, oldVal })
  })
  store.$state.foo = 'initial'
  store.$state.foo = 'updated'
  assert.deepEqual(calls, [
    { val: 'initial', oldVal: undefined },
    { val: 'updated', oldVal: 'initial' }
  ])
})

test('6. Writing the same value still fires subscribers', () => {
  const store = createStateStore({ initialState: { foo: 'same' } })
  const calls = []
  store.subscribe('foo', (val, oldVal) => calls.push({ val, oldVal }))
  store.$state.foo = 'same'
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { val: 'same', oldVal: 'same' })
})

test('7. subscribe returns an unsubscribe function; after unsubscribing, the callback does not fire', () => {
  const store = createStateStore()
  const calls = []
  const unsubscribe = store.subscribe('foo', (val) => calls.push(val))
  store.$state.foo = 1
  assert.equal(calls.length, 1)
  unsubscribe()
  store.$state.foo = 2
  assert.equal(calls.length, 1)
})

test('8. A subscriber to key A does not fire when key B is written', () => {
  const store = createStateStore()
  const callsA = []
  const callsB = []
  store.subscribe('keyA', (val) => callsA.push(val))
  store.subscribe('keyB', (val) => callsB.push(val))
  store.$state.keyB = 'valB'
  assert.equal(callsA.length, 0)
  assert.equal(callsB.length, 1)
})

test('9. subscribeAny fires for every write', () => {
  const store = createStateStore()
  const calls = []
  store.subscribeAny((key, newValue, oldValue) => {
    calls.push({ key, newValue, oldValue })
  })
  store.$state.foo = 'bar'
  store.$state.baz = 'qux'
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], { key: null, newValue: 'bar', oldValue: undefined })
  assert.deepEqual(calls[1], { key: null, newValue: 'qux', oldValue: undefined })
})

test('10. A throwing subscriber does not prevent other subscribers from firing', () => {
  const store = createStateStore()
  const calls = []
  const origQueueMicrotask = globalThis.queueMicrotask
  const queuedErrors = []
  globalThis.queueMicrotask = (fn) => {
    try {
      fn()
    } catch (err) {
      queuedErrors.push(err)
    }
  }
  try {
    store.subscribe('errKey', () => {
      throw new Error('Subscriber error')
    })
    store.subscribe('errKey', (val) => {
      calls.push(val)
    })
    store.$state.errKey = 'test'
    assert.equal(calls.length, 1)
    assert.equal(calls[0], 'test')
    assert.equal(queuedErrors.length, 1)
    assert.equal(queuedErrors[0].message, 'Subscriber error')
  } finally {
    globalThis.queueMicrotask = origQueueMicrotask
  }
})

test('11. subscribe with an already-aborted signal does not register the callback', () => {
  const store = createStateStore()
  const calls = []
  const controller = new AbortController()
  controller.abort()
  store.subscribe('foo', (val) => calls.push(val), { signal: controller.signal })
  store.$state.foo = 'bar'
  assert.equal(calls.length, 0)
})

test('12. subscribe with a signal unsubscribes when the signal aborts', () => {
  const store = createStateStore()
  const calls = []
  const controller = new AbortController()
  store.subscribe('foo', (val) => calls.push(val), { signal: controller.signal })
  store.$state.foo = 'first'
  assert.equal(calls.length, 1)
  controller.abort()
  store.$state.foo = 'second'
  assert.equal(calls.length, 1)
})

test('13. getSnapshot() returns a shallow copy', () => {
  const store = createStateStore({ initialState: { a: 1 } })
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.a, 1)
  assert.throws(() => {
    snapshot.a = 2
  }, TypeError)
  store.$state.a = 99
  assert.equal(snapshot.a, 1)
})

test('14. reset() restores the defaults', () => {
  const store = createStateStore()
  store.$state.custom = 'tmp'
  store.$state.isAuthenticated = true
  assert.equal(store.$state.custom, 'tmp')
  store.reset()
  assert.equal(store.$state.custom, undefined)
  assert.equal(store.$state.isAuthenticated, false)
  assert.equal(store.$state.storageReady, false)

  store.reset({ isAuthenticated: true, overridden: 123 })
  assert.equal(store.$state.isAuthenticated, true)
  assert.equal(store.$state.overridden, 123)
})

test('15. delete $state.foo fires the subscriber for foo with undefined', () => {
  const store = createStateStore({ initialState: { foo: 'initial' } })
  const calls = []
  store.subscribe('foo', (val, oldVal) => calls.push({ val, oldVal }))
  delete store.$state.foo
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { val: undefined, oldVal: 'initial' })
  assert.equal(store.$state.foo, undefined)
})

test('16. Nested writes do not fire top-level subscribers', () => {
  const store = createStateStore()
  const calls = []
  store.subscribe('ui', (val) => calls.push(val))
  store.$state.ui.activeRail = 'settings'
  assert.equal(calls.length, 0)
  assert.equal(store.$state.ui.activeRail, 'settings')
})
