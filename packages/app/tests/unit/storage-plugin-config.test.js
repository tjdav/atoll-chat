import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import storagePlugin from '../../src/plugins/storage-plugin.js'

describe('Storage Plugin Client Config Specification', () => {
  const sampleMigrations = [
    { name: '0001-meta.sql', sql: 'CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY);' },
    { name: '0002-users.sql', sql: 'CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY);' }
  ]

  test('Case 1: Factory returns a definePlugin result with name "storage"', () => {
    const plugin = storagePlugin({ dbName: 'testdb', migrations: sampleMigrations })
    assert.equal(plugin.name, 'storage')
  })

  test('Case 2 & 3: Result contains a client object with a config field', () => {
    const plugin = storagePlugin({ dbName: 'testdb', migrations: sampleMigrations })
    assert.ok(plugin.client, 'plugin.client must exist')
    assert.ok(plugin.client.config, 'plugin.client.config must exist')
  })

  test('Case 4: client.config.migrations equals the passed migrations array', () => {
    const plugin = storagePlugin({ dbName: 'testdb', migrations: sampleMigrations })
    assert.deepEqual(plugin.client.config.migrations, sampleMigrations)
  })

  test('Case 5: client.config.dbName equals the passed dbName or defaults to "messenger"', () => {
    const customPlugin = storagePlugin({ dbName: 'custom_db', migrations: sampleMigrations })
    assert.equal(customPlugin.client.config.dbName, 'custom_db')

    const defaultPlugin = storagePlugin({ migrations: sampleMigrations })
    assert.equal(defaultPlugin.client.config.dbName, 'messenger')
  })

  test('Case 6: client.context is a function', () => {
    const plugin = storagePlugin({ dbName: 'testdb', migrations: sampleMigrations })
    assert.equal(typeof plugin.client.context, 'function')
  })

  test('Case 7: client.context resolves from pluginContext.config, not from factory closure', async () => {
    // Factory called with closureMigrations
    const closureMigrations = [{ name: 'closure.sql', sql: 'CREATE TABLE IF NOT EXISTS closure (id TEXT);' }]
    const plugin = storagePlugin({ dbName: 'closure_db', migrations: closureMigrations })

    // Inject mockPluginContext with different migrations
    const mockConfigMigrations = [{ name: 'config.sql', sql: 'CREATE TABLE IF NOT EXISTS config (id TEXT);' }]
    const mockPluginContext = {
      config: {
        dbName: 'config_db',
        migrations: mockConfigMigrations
      }
    }

    // Calling context resolver uses mockPluginContext.config
    const instanceResolver = await plugin.client.context(mockPluginContext)
    const ctx = instanceResolver({})

    await ctx.open()
    const rows = await ctx.query('SELECT name FROM _migrations ORDER BY name ASC', [])

    // Verify that the migration applied was from mockPluginContext.config (config.sql) and NOT closure (closure.sql)
    assert.deepEqual(rows, [{ name: 'config.sql' }])
  })

  test('Case 8: Config contains only serializable values', () => {
    const plugin = storagePlugin({ dbName: 'testdb', migrations: sampleMigrations })
    const serialized = JSON.parse(JSON.stringify(plugin.client.config))
    assert.deepEqual(serialized, plugin.client.config)
  })

  test('Case 9: client.context resolver is declared async', () => {
    const plugin = storagePlugin({ dbName: 'testdb', migrations: sampleMigrations })
    const isAsync = plugin.client.context.constructor.name === 'AsyncFunction'
    assert.ok(isAsync, 'client.context must be an async function')
  })
})
