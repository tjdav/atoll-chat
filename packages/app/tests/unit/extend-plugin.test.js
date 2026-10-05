import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import extensionPlugin from '@atoll/extend/plugin'
import { defineExtension } from '@atoll/extend'

describe('extensionPlugin Coralite plugin unit tests', () => {
  const ext1 = defineExtension({
    id: 'vendor.ext-one',
    apiVersion: '1.0.0',
    hostApi: '2.0.0',
    detail: { route: 'ext-one', component: 'ext-one-view', title: 'Ext One' }
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

  test('6. Calling client.context({}) returns a function', () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    const mockPluginContext = {}
    const phase2Resolver = plugin.client.context(mockPluginContext)
    assert.equal(typeof phase2Resolver, 'function')
  })

  test('7. Calling the returned function with a mock instance context returns an object with an extensions key', () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    const mockPluginContext = {}
    const phase2Resolver = plugin.client.context(mockPluginContext)
    const ctxObj = phase2Resolver({})
    assert.equal(typeof ctxObj, 'object')
    assert.equal(typeof ctxObj.extensions, 'object')
  })

  test('8. extensions.list() returns the registered extensions', () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    const mockPluginContext = {}
    const ctxObj = plugin.client.context(mockPluginContext)({})
    const list = ctxObj.extensions.list()
    assert.equal(list.length, 1)
    assert.equal(list[0], ext1)
  })

  test('9. extensions.get(id) returns the extension', () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    const mockPluginContext = {}
    const ctxObj = plugin.client.context(mockPluginContext)({})
    assert.equal(ctxObj.extensions.get('vendor.ext-one'), ext1)
    assert.equal(ctxObj.extensions.get('vendor.missing'), undefined)
  })

  test('10. The singleton guard works: two calls to client.context(samePluginContext) share the registry', () => {
    const plugin = extensionPlugin({ extensions: [ext1] })
    const mockPluginContext = {}
    const ctxObj1 = plugin.client.context(mockPluginContext)({})
    const ctxObj2 = plugin.client.context(mockPluginContext)({})
    assert.equal(ctxObj1.extensions.registry, ctxObj2.extensions.registry)
  })
})
