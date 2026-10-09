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

test('3. client.context returns keys directly without wrapper', async () => {
  const plugin = storagePlugin({ migrations: sampleMigrations })
  const clientContextResolver = await plugin.client.context({ config: { migrations: sampleMigrations } })
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
  assert.equal(typeof ctx.repos, 'function')
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
  assert.equal(typeof ctx.repos, 'function')
  assert.equal(ctx.storage, undefined)
})

test('5. client.context uses singleton guard across calls', async () => {
  const plugin = storagePlugin({ migrations: sampleMigrations })
  const pluginCtx = { config: { migrations: sampleMigrations } }
  const resolver = await plugin.client.context(pluginCtx)
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
  assert.equal(await ctx.meta.get('anything'), undefined)
})

test('9. client.context exposes repos as a function', async () => {
  const plugin = storagePlugin({ migrations: sampleMigrations })
  const clientContextResolver = await plugin.client.context({ config: { migrations: sampleMigrations } })
  const ctx = clientContextResolver({})
  assert.equal(typeof ctx.repos, 'function')
})

test('10. repos() returns an object with all eighteen repositories', async () => {
  const plugin = storagePlugin({ migrations: sampleMigrations })
  const clientContextResolver = await plugin.client.context({ config: { migrations: sampleMigrations } })
  const ctx = clientContextResolver({})
  const repos = ctx.repos()

  const expectedRepos = [
    'users',
    'rooms',
    'roomMembers',
    'roomOrder',
    'messages',
    'attachments',
    'reactions',
    'readState',
    'drafts',
    'blockedUsers',
    'outbox',
    'roomPreferences',
    'nicknames',
    'deviceNames',
    'starredItems',
    'syncState',
    'processedEvents',
    'mlsRooms'
  ]

  for (const repoName of expectedRepos) {
    assert.equal(typeof repos[repoName], 'object', `Missing repository: ${repoName}`)
  }
  assert.equal(Object.keys(repos).length, 18)
})

test('11. repos() returns the same object on consecutive calls (memoization)', async () => {
  const plugin = storagePlugin({ migrations: sampleMigrations })
  const clientContextResolver = await plugin.client.context({ config: { migrations: sampleMigrations } })
  const ctx = clientContextResolver({})
  assert.strictEqual(ctx.repos(), ctx.repos())
})

test('12. two calls to client.context with same pluginContext return same repos instance', async () => {
  const plugin = storagePlugin({ migrations: sampleMigrations })
  const pluginCtx = { config: { migrations: sampleMigrations } }
  const resolver1 = await plugin.client.context(pluginCtx)
  const resolver2 = await plugin.client.context(pluginCtx)

  const ctx1 = resolver1({})
  const ctx2 = resolver2({})

  assert.strictEqual(ctx1.repos(), ctx2.repos())
})

test('13. repository methods match expected convention shape', async () => {
  const plugin = storagePlugin({ migrations: sampleMigrations })
  const clientContextResolver = await plugin.client.context({ config: { migrations: sampleMigrations } })
  const ctx = clientContextResolver({})
  const repos = ctx.repos()

  assert.equal(typeof repos.users.get, 'function')
  assert.equal(typeof repos.users.upsert, 'function')
  assert.equal(typeof repos.rooms.get, 'function')
  assert.equal(typeof repos.messages.get, 'function')
})

test('14. server context exposes repos as a function that throws during SSR', () => {
  const plugin = storagePlugin()
  const ctx = plugin.server.context({})({})
  assert.equal(typeof ctx.repos, 'function')
  assert.throws(() => ctx.repos(), /storage.repos is not available during SSR/)
})
