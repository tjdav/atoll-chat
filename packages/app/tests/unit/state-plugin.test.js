import { test } from 'node:test'
import assert from 'node:assert/strict'
import statePluginFactory from '../../src/plugins/state-plugin.js'

test('1. The default export is a function', () => {
  assert.equal(typeof statePluginFactory, 'function')
})

test('2. Calling it with {} returns an object with name === "globalStore"', () => {
  const plugin = statePluginFactory({})
  assert.equal(plugin.name, 'globalStore')
})

test('3. The returned plugin has server.context and client.context, both functions', () => {
  const plugin = statePluginFactory({})
  assert.equal(typeof plugin.server?.context, 'function')
  assert.equal(typeof plugin.client?.context, 'function')
})

test('4. server.context uses two-phase shape returning $state, subscribe, subscribeAny, getSnapshot, reset', () => {
  const plugin = statePluginFactory({})
  const outer = plugin.server.context({})
  assert.equal(typeof outer, 'function')
  const instance = outer({})
  assert.deepEqual(instance.$state, {})
  assert.equal(typeof instance.subscribe, 'function')
  assert.equal(typeof instance.subscribeAny, 'function')
  assert.equal(typeof instance.getSnapshot, 'function')
  assert.equal(typeof instance.reset, 'function')
})

test('5. client.context is async and returns two-phase resolver returning store keys', async () => {
  const plugin = statePluginFactory({ initialState: { token: 'abc' } })
  const outer = await plugin.client.context({ config: plugin.client.config })
  assert.equal(typeof outer, 'function')
  const instance = outer({})
  assert.equal(instance.$state.token, 'abc')
  assert.equal(typeof instance.subscribe, 'function')
  assert.equal(typeof instance.subscribeAny, 'function')
  assert.equal(typeof instance.getSnapshot, 'function')
  assert.equal(typeof instance.reset, 'function')
})

test('6. client.context uses singleton-by-phase1 behavior: shared store across instances', async () => {
  const plugin = statePluginFactory({})
  const mockPluginContext = { config: plugin.client.config }
  const outer = await plugin.client.context(mockPluginContext)
  const instance1 = outer({ id: 1 })
  const instance2 = outer({ id: 2 })

  instance1.$state.sharedKey = 'hello'
  assert.equal(instance2.$state.sharedKey, 'hello')
})

test('7. The server context $state is a plain object', () => {
  const plugin = statePluginFactory({})
  const instance = plugin.server.context({})({})
  instance.$state.foo = 'bar'
  assert.equal(instance.$state.foo, 'bar')
  assert.equal(Object.prototype.toString.call(instance.$state), '[object Object]')
})

test('8. The server context subscribe returns a no-op function and does not throw', () => {
  const plugin = statePluginFactory({})
  const instance = plugin.server.context({})({})
  let calls = 0
  const unsubscribe = instance.subscribe('key', () => calls++)
  assert.equal(typeof unsubscribe, 'function')
  instance.$state.key = 'val'
  assert.equal(calls, 0)
  assert.doesNotThrow(() => unsubscribe())
})

test('9. The client context $state is reactive: a subscriber fires on write', async () => {
  const plugin = statePluginFactory({})
  const outer = await plugin.client.context({ config: plugin.client.config })
  const instance = outer({})
  const calls = []
  instance.subscribe('reactiveKey', (val, oldVal) => {
    calls.push({ val, oldVal })
  })
  instance.$state.reactiveKey = 'active'
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { val: 'active', oldVal: undefined })
})
