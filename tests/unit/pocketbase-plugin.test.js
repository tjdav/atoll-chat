import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import pocketbasePlugin from '../../src/plugins/pocketbase/index.js'

describe('PocketBase Plugin Modular Architecture Tests', () => {
  it('should initialize plugin definition correctly', () => {
    const plugin = pocketbasePlugin({ baseUrl: 'http://localhost:8090', appUrl: 'https://app.atoll.chat' })
    assert.equal(plugin.name, 'pocketbase')
    assert.equal(typeof plugin.server.context, 'function')
    assert.equal(typeof plugin.client.context, 'function')
  })

  it('should resolve server context and return api helpers', async () => {
    const plugin = pocketbasePlugin({ baseUrl: 'http://localhost:8090' })
    const getContext = await plugin.server.context()
    const ctx = getContext()

    assert.ok(ctx.pb)
    assert.ok(ctx.auth)
    assert.ok(ctx.records)
    assert.ok(ctx.realtime)
    assert.ok(ctx.files)
    assert.equal(typeof ctx.auth.login, 'function')
    assert.equal(typeof ctx.records.getList, 'function')
    assert.equal(typeof ctx.realtime.subscribe, 'function')
    assert.equal(typeof ctx.files.getUrl, 'function')
  })

  it('should resolve client context with proxy fallback delegation', async () => {
    const plugin = pocketbasePlugin({ baseUrl: 'http://localhost:8090' })
    const pluginContext = {
      config: {
        url: 'http://localhost:8090',
        appUrl: ''
      }
    }
    const getContext = await plugin.client.context(pluginContext)
    const ctx = getContext()

    assert.ok(ctx.pb)
    assert.ok(ctx.auth)
    assert.ok(ctx.records)
    assert.ok(ctx.realtime)
    assert.ok(ctx.files)

    // Test proxy delegation to pb instance methods/properties
    assert.equal(typeof ctx.collection, 'function')
    assert.equal(typeof ctx.send, 'function')
  })
})
