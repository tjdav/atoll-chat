import { test } from 'node:test'
import assert from 'node:assert/strict'
import storagePlugin from '../../src/plugins/storage-plugin.js'

const sampleMigrations = [
  {
    name: '0001-meta.sql',
    sql: 'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);'
  }
]

test('1. storagePlugin returns object with name storage', () => {
  const plugin = storagePlugin()
  assert.equal(plugin.name, 'storage')
})

test('2. storagePlugin has server.context and client.context functions', () => {
  const plugin = storagePlugin()
  assert.equal(typeof plugin.server.context, 'function')
  assert.equal(typeof plugin.client.context, 'function')
})

test('3. client.context returns keys directly without wrapper', () => {
  const plugin = storagePlugin({ migrations: sampleMigrations })
  const clientContextResolver = plugin.client.context({})
  const ctx = clientContextResolver({})

  assert.equal(typeof ctx.open, 'function')
  assert.equal(typeof ctx.close, 'function')
  assert.equal(typeof ctx.query, 'function')
  assert.equal(typeof ctx.queryOne, 'function')
  assert.equal(typeof ctx.execute, 'function')
  assert.equal(typeof ctx.transaction, 'function')
  assert.equal(typeof ctx.meta, 'object')
  assert.equal(typeof ctx.meta.get, 'function')
  assert.equal(typeof ctx.meta.set, 'function')
  assert.equal(typeof ctx.meta.delete, 'function')
  assert.equal(ctx.storage, undefined)
})

test('4. server.context returns direct key shape', () => {
  const plugin = storagePlugin()
  const serverContextResolver = plugin.server.context({})
  const ctx = serverContextResolver({})

  assert.equal(typeof ctx.open, 'function')
  assert.equal(typeof ctx.close, 'function')
  assert.equal(typeof ctx.query, 'function')
  assert.equal(typeof ctx.queryOne, 'function')
  assert.equal(typeof ctx.execute, 'function')
  assert.equal(typeof ctx.transaction, 'function')
  assert.equal(typeof ctx.meta, 'object')
  assert.equal(ctx.storage, undefined)
})

test('5. client.context uses singleton guard across calls', async () => {
  const plugin = storagePlugin({ migrations: sampleMigrations })
  const pluginCtx = {}
  const resolver = plugin.client.context(pluginCtx)
  const ctx1 = resolver({})
  const ctx2 = resolver({})

  await ctx1.open()

  // Perform a write via ctx1 meta and read via ctx2 meta to verify shared instance
  await ctx1.meta.set('foo', 'bar')
  const val = await ctx2.meta.get('foo')
  assert.equal(val, 'bar')
})

test('6. server context open throws error', async () => {
  const plugin = storagePlugin()
  const ctx = plugin.server.context({})({})
  assert.throws(() => {
    ctx.open()
  }, /storage.open is not available during SSR/)
})

test('7. server context close is a no-op', () => {
  const plugin = storagePlugin()
  const ctx = plugin.server.context({})({})
  assert.doesNotThrow(() => {
    ctx.close()
  })
})

test('8. server context meta.get returns undefined', async () => {
  const plugin = storagePlugin()
  const ctx = plugin.server.context({})({})
  const val = await ctx.meta.get('anything')
  assert.equal(val, undefined)
})
