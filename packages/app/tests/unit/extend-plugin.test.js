import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import extensionPlugin from '@atoll/extend/plugin'
import { defineExtension } from '@atoll/extend'

describe('extensionPlugin Coralite plugin unit tests', () => {
  const ext1 = defineExtension({
    id: 'vendor.ext-one',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: { route: 'ext-one', component: 'x-ext-one-view', title: 'Ext One' }
  })

  test('1. The default export is a function', () => {
    assert.equal(typeof extensionPlugin, 'function')
  })

  test('2. Calling it with {} returns an object with name === "extensions"', () => {
    const plugin = extensionPlugin({})
    assert.equal(typeof plugin, 'object')
    assert.equal(plugin.name, 'extensions')
  })

  test('3. Calling it with { extensions: [] } returns the same shape', () => {
    const plugin = extensionPlugin({ extensions: [] })
    assert.equal(plugin.name, 'extensions')
  })

  test('4. Calling it with a single extension returns the same shape', () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    assert.equal(plugin.name, 'extensions')
  })

  test('5. The returned plugin has server.context and client.context, both functions', () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    assert.equal(typeof plugin.server.context, 'function')
    assert.equal(typeof plugin.client.context, 'function')
  })

  test('6. Calling client.context({}) returns a function', async () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    const mockPluginContext = {}
    const phase2Resolver = await plugin.client.context(mockPluginContext)
    assert.equal(typeof phase2Resolver, 'function')
  })

  test('7. Calling the returned function with a mock instance context returns an object with context keys', async () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    const mockPluginContext = {}
    const phase2Resolver = await plugin.client.context(mockPluginContext)
    const ctxObj = phase2Resolver({})
    assert.equal(typeof ctxObj, 'object')
    assert.equal(typeof ctxObj.registry, 'object')
  })

  test('8. list() returns the registered extensions', async () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    const mockPluginContext = {}
    const phase2 = await plugin.client.context(mockPluginContext)
    const ctxObj = phase2({})
    const list = ctxObj.list()
    assert.ok(Array.isArray(list))
  })

  test('9. get(id) returns the extension if present', async () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    const mockPluginContext = {}
    const phase2 = await plugin.client.context(mockPluginContext)
    const ctxObj = phase2({})
    assert.equal(ctxObj.get('vendor.missing'), undefined)
  })

  test('10. The registry is accessible on the context object', async () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    const mockPluginContext = {}
    const phase2_1 = await plugin.client.context(mockPluginContext)
    const ctxObj1 = phase2_1({})
    const phase2_2 = await plugin.client.context(mockPluginContext)
    const ctxObj2 = phase2_2({})
    assert.equal(typeof ctxObj1.registry, 'object')
    assert.equal(typeof ctxObj2.registry, 'object')
  })
})
