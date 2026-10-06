import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import syncPlugin from '../../src/plugins/sync-plugin.js'

describe('syncPlugin', () => {
  it('1. default export returns plugin definition with name: sync', () => {
    const plugin = syncPlugin()
    assert.equal(typeof plugin, 'object')
    assert.equal(plugin.name, 'sync')
  })

  it('2. plugin has server.context and client.context functions', () => {
    const plugin = syncPlugin()
    assert.equal(typeof plugin.server?.context, 'function')
    assert.equal(typeof plugin.client?.context, 'function')
  })

  it('3. server.context returns an async resolver whose runUserScopedSync method throws', async () => {
    const plugin = syncPlugin()
    const serverResolver = await plugin.server.context({})
    const ctx = await serverResolver({})
    assert.equal(typeof ctx.runUserScopedSync, 'function')
    assert.throws(
      () => ctx.runUserScopedSync(),
      /sync.runUserScopedSync is not available during SSR/
    )
  })

  it('4. client.context returns an async resolver providing runUserScopedSync', async () => {
    const plugin = syncPlugin()
    const clientResolver = await plugin.client.context({})
    const ctx = await clientResolver({})
    assert.equal(typeof ctx.runUserScopedSync, 'function')
  })

  it('5. client.runUserScopedSync calls storage.repos() and executes sync flow', async () => {
    const plugin = syncPlugin()
    const clientResolver = await plugin.client.context({})
    const ctx = await clientResolver({})

    let reposCalled = false
    let apiCalled = false

    const mockStorage = {
      repos: () => {
        reposCalled = true
        return { readState: {}, deviceNames: {}, starredItems: {} }
      },
      meta: {
        get: async () => 0,
        set: async () => {}
      }
    }

    const mockApi = {
      get: async () => {
        apiCalled = true
        return { max_seq: 10 }
      }
    }

    const res = await ctx.runUserScopedSync({
      userId: 'u_test',
      api: mockApi,
      storage: mockStorage
    })

    assert.equal(reposCalled, true)
    assert.equal(apiCalled, true)
    assert.equal(res.cursor, 10)
  })

  it('6. concurrency guard shares in-flight promise across concurrent invocations', async () => {
    const plugin = syncPlugin()
    const clientResolver = await plugin.client.context({})
    const ctx = await clientResolver({})

    let apiCount = 0

    const mockStorage = {
      repos: () => ({ readState: {}, deviceNames: {}, starredItems: {} }),
      meta: {
        get: async () => 0,
        set: async () => {}
      }
    }

    const mockApi = {
      get: async () => {
        apiCount += 1
        await new Promise((r) => setTimeout(r, 20))
        return { max_seq: 15 }
      }
    }

    const [res1, res2] = await Promise.all([
      ctx.runUserScopedSync({ userId: 'u_concurrent', api: mockApi, storage: mockStorage }),
      ctx.runUserScopedSync({ userId: 'u_concurrent', api: mockApi, storage: mockStorage })
    ])

    assert.equal(apiCount, 1)
    assert.equal(res1.cursor, 15)
    assert.equal(res2.cursor, 15)
    assert.equal(res1, res2)
  })

  it('7. server context runUserScopedSync throws when called with arguments', async () => {
    const plugin = syncPlugin()
    const serverResolver = await plugin.server.context({})
    const ctx = await serverResolver({})
    assert.throws(
      () => ctx.runUserScopedSync({ userId: 'u_1' }),
      /sync.runUserScopedSync is not available during SSR/
    )
  })

  it('8. no plugin context wrapper: runUserScopedSync is exposed directly without inner sync key', async () => {
    const plugin = syncPlugin()
    const clientResolver = await plugin.client.context({})
    const ctx = await clientResolver({})

    assert.equal('runUserScopedSync' in ctx, true)
    assert.equal('sync' in ctx, false)
  })
})
