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
})
