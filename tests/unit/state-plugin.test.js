import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import statePlugin from '../../src/plugins/state-plugin.js'

describe('statePlugin Unit Tests', () => {
  test('Phase 1 async context resolves and initializes decryptionCache as MediaLRUCache', async () => {
    const plugin = statePlugin({ initialState: { testKey: 'initialValue' } })
    const pluginContext = {
      config: plugin.client.config
    }

    const phase2Resolver = await plugin.client.context(pluginContext)
    assert.equal(typeof phase2Resolver, 'function')

    // Verify window bindings set during Phase 1
    assert.ok(globalThis.window.$state)
    assert.equal(globalThis.window.$state.testKey, 'initialValue')
    assert.ok(globalThis.window.$state.decryptionCache)
    assert.equal(typeof globalThis.window.$state.decryptionCache.get, 'function')
    assert.equal(typeof globalThis.window.$state.decryptionCache.set, 'function')
  })

  test('Phase 2 instance resolution provides $state proxy with subscription reactivity', async () => {
    const plugin = statePlugin({ initialState: { counter: 0 } })
    const pluginContext = { config: plugin.client.config }
    const phase2Resolver = await plugin.client.context(pluginContext)

    const instanceContext = {}
    const instance = phase2Resolver(instanceContext)

    assert.ok(instance.$state)
    assert.equal(instance.$state.counter, 0)

    let notifiedVal = null
    const unsubscribe = instance.$state.subscribe('counter', (val) => {
      notifiedVal = val
    })

    instance.$state.counter = 42
    assert.equal(instance.$state.counter, 42)
    assert.equal(notifiedVal, 42)

    unsubscribe()
    instance.$state.counter = 100
    // No further notification after unsubscribe
    assert.equal(notifiedVal, 42)
  })
})
