import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryBackend } from '../../src/lib/db/backends/memory.js'
import { splitStatements, runMigrations } from '../../src/lib/db/migrations.js'
import { createDb } from '../../src/lib/db/index.js'

test('1. createMemoryBackend().exec CREATE TABLE succeeds', async () => {
  const backend = createMemoryBackend()
  const res = await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  assert.deepEqual(res, { changes: 0, lastInsertId: null })
})

test('2. all SELECT on fresh table returns empty array', async () => {
  const backend = createMemoryBackend()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  const rows = await backend.all('SELECT * FROM foo', [])
  assert.deepEqual(rows, [])
})

test('3. exec INSERT inserts row; all returns row', async () => {
  const backend = createMemoryBackend()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  const res = await backend.exec('INSERT INTO foo (id, v) VALUES (?, ?)', ['a', '1'])
  assert.equal(res.changes, 1)
  const rows = await backend.all('SELECT * FROM foo', [])
  assert.deepEqual(rows, [{ id: 'a', v: '1' }])
})

test('4. exec INSERT OR REPLACE replaces row', async () => {
  const backend = createMemoryBackend()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  await backend.exec('INSERT INTO foo (id, v) VALUES (?, ?)', ['a', '1'])
  await backend.exec('INSERT OR REPLACE INTO foo (id, v) VALUES (?, ?)', ['a', '2'])
  const rows = await backend.all('SELECT * FROM foo', [])
  assert.deepEqual(rows, [{ id: 'a', v: '2' }])
})

test('5. one SELECT returns first row', async () => {
  const backend = createMemoryBackend()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  await backend.exec('INSERT INTO foo (id, v) VALUES (?, ?)', ['a', '1'])
  const row = await backend.one('SELECT * FROM foo WHERE id = ?', ['a'])
  assert.deepEqual(row, { id: 'a', v: '1' })
})

test('6. one SELECT returns undefined on missing row', async () => {
  const backend = createMemoryBackend()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  const row = await backend.one('SELECT * FROM foo WHERE id = ?', ['zzz'])
  assert.equal(row, undefined)
})

test('7. exec UPDATE updates row; one reflects change', async () => {
  const backend = createMemoryBackend()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  await backend.exec('INSERT INTO foo (id, v) VALUES (?, ?)', ['a', '1'])
  const res = await backend.exec('UPDATE foo SET v = ? WHERE id = ?', ['3', 'a'])
  assert.equal(res.changes, 1)
  const row = await backend.one('SELECT * FROM foo WHERE id = ?', ['a'])
  assert.deepEqual(row, { id: 'a', v: '3' })
})

test('8. exec DELETE deletes row; all returns empty', async () => {
  const backend = createMemoryBackend()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  await backend.exec('INSERT INTO foo (id, v) VALUES (?, ?)', ['a', '1'])
  const res = await backend.exec('DELETE FROM foo WHERE id = ?', ['a'])
  assert.equal(res.changes, 1)
  const rows = await backend.all('SELECT * FROM foo', [])
  assert.deepEqual(rows, [])
})

test('9. Unsupported SQL throws with statement in message', async () => {
  const backend = createMemoryBackend()
  await assert.rejects(async () => {
    await backend.exec('DROP TABLE foo', [])
  }, /Unsupported SQL statement in memory backend: DROP TABLE foo/)
})

test('10. begin() then exec then rollback() reverts change', async () => {
  const backend = createMemoryBackend()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  await backend.begin()
  await backend.exec('INSERT INTO foo (id, v) VALUES (?, ?)', ['a', '1'])
  await backend.rollback()
  const rows = await backend.all('SELECT * FROM foo', [])
  assert.deepEqual(rows, [])
})

test('11. begin() then exec then commit() persists change', async () => {
  const backend = createMemoryBackend()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  await backend.begin()
  await backend.exec('INSERT INTO foo (id, v) VALUES (?, ?)', ['a', '1'])
  await backend.commit()
  const rows = await backend.all('SELECT * FROM foo', [])
  assert.deepEqual(rows, [{ id: 'a', v: '1' }])
})

test('12. Fresh DB with two migrations applies both in order', async () => {
  const backend = createMemoryBackend()
  const result = await runMigrations({
    backend,
    migrations: [
      { name: '0001-a.sql', sql: 'CREATE TABLE t1 (id TEXT PRIMARY KEY);' },
      { name: '0002-b.sql', sql: 'CREATE TABLE t2 (id TEXT PRIMARY KEY);' }
    ]
  })
  assert.deepEqual(result, { applied: ['0001-a.sql', '0002-b.sql'], skipped: [] })
  const rows = await backend.all('SELECT name FROM _migrations ORDER BY name ASC', [])
  assert.deepEqual(rows, [{ name: '0001-a.sql' }, { name: '0002-b.sql' }])
})

test('13. Running same migrations twice applies none on second run', async () => {
  const backend = createMemoryBackend()
  const migrations = [
    { name: '0001-a.sql', sql: 'CREATE TABLE t1 (id TEXT PRIMARY KEY);' }
  ]
  await runMigrations({ backend, migrations })
  const second = await runMigrations({ backend, migrations })
  assert.deepEqual(second, { applied: [], skipped: ['0001-a.sql'] })
})

test('14. Migration failing mid-execution rolls back and leaves _migrations clean', async () => {
  const backend = createMemoryBackend()
  const migrations = [
    { name: '0001-bad.sql', sql: 'CREATE TABLE t1 (id TEXT PRIMARY KEY); BAD STATEMENT;' }
  ]
  await assert.rejects(async () => {
    await runMigrations({ backend, migrations })
  }, /Migration 0001-bad.sql failed/)

  const rows = await backend.all('SELECT name FROM _migrations ORDER BY name ASC', [])
  assert.deepEqual(rows, [])
})

test('15. splitStatements correctly splits on semicolons outside quotes', () => {
  const stmts = splitStatements('CREATE TABLE a (id TEXT); CREATE TABLE b (id TEXT);')
  assert.deepEqual(stmts, ['CREATE TABLE a (id TEXT)', 'CREATE TABLE b (id TEXT)'])
})

test('16. splitStatements does not split on semicolons inside single quotes', () => {
  const stmts = splitStatements("INSERT INTO t VALUES ('a;b'); INSERT INTO t VALUES ('c')")
  assert.deepEqual(stmts, ["INSERT INTO t VALUES ('a;b')", "INSERT INTO t VALUES ('c')"])
})

test('17. splitStatements ignores semicolons inside line comments', () => {
  const stmts = splitStatements('SELECT 1; -- comment; with semicolon\nSELECT 2;')
  assert.deepEqual(stmts, ['SELECT 1', 'SELECT 2'])
})

test('18. splitStatements returns empty array for whitespace-only input', () => {
  assert.deepEqual(splitStatements('   \n\t  '), [])
})

test('19. createDb returns object with correct surface', () => {
  const backend = createMemoryBackend()
  const db = createDb({ backend, migrations: [] })
  assert.equal(typeof db.open, 'function')
  assert.equal(typeof db.close, 'function')
  assert.equal(typeof db.query, 'function')
  assert.equal(typeof db.queryOne, 'function')
  assert.equal(typeof db.execute, 'function')
  assert.equal(typeof db.transaction, 'function')
  assert.equal(typeof db.meta.get, 'function')
  assert.equal(typeof db.meta.set, 'function')
  assert.equal(typeof db.meta.delete, 'function')
})

test('20. await db.open() returns applied migrations', async () => {
  const backend = createMemoryBackend()
  const db = createDb({
    backend,
    migrations: [{ name: '0001-test.sql', sql: 'CREATE TABLE t (id TEXT);' }]
  })
  const res = await db.open()
  assert.deepEqual(res, { applied: ['0001-test.sql'], skipped: [] })
})

test('21. Second await db.open() returns skipped migrations', async () => {
  const backend = createMemoryBackend()
  const db = createDb({
    backend,
    migrations: [{ name: '0001-test.sql', sql: 'CREATE TABLE t (id TEXT);' }]
  })
  await db.open()
  const second = await db.open()
  assert.deepEqual(second, { applied: [], skipped: ['0001-test.sql'] })
})

test('22. Concurrent open() calls share one migration run', async () => {
  const backend = createMemoryBackend()
  const db = createDb({
    backend,
    migrations: [{ name: '0001-test.sql', sql: 'CREATE TABLE t (id TEXT);' }]
  })
  const [r1, r2] = await Promise.all([db.open(), db.open()])
  assert.deepEqual(r1, { applied: ['0001-test.sql'], skipped: [] })
  assert.deepEqual(r2, { applied: ['0001-test.sql'], skipped: [] })
})

test('23. db.meta.set followed by db.meta.get returns parsed object', async () => {
  const backend = createMemoryBackend()
  const db = createDb({
    backend,
    migrations: [
      {
        name: '0001-meta.sql',
        sql: 'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);'
      }
    ]
  })
  await db.open()
  await db.meta.set('k', { a: 1 })
  const val = await db.meta.get('k')
  assert.deepEqual(val, { a: 1 })
})

test('24. db.meta.get missing key returns undefined', async () => {
  const backend = createMemoryBackend()
  const db = createDb({
    backend,
    migrations: [
      {
        name: '0001-meta.sql',
        sql: 'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);'
      }
    ]
  })
  await db.open()
  const val = await db.meta.get('missing')
  assert.equal(val, undefined)
})

test('25. db.meta.delete deletes key', async () => {
  const backend = createMemoryBackend()
  const db = createDb({
    backend,
    migrations: [
      {
        name: '0001-meta.sql',
        sql: 'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);'
      }
    ]
  })
  await db.open()
  await db.meta.set('k', { a: 1 })
  const res = await db.meta.delete('k')
  assert.equal(res.changes, 1)
  const val = await db.meta.get('k')
  assert.equal(val, undefined)
})

test('26. db.transaction commits on success', async () => {
  const backend = createMemoryBackend()
  const db = createDb({ backend, migrations: [] })
  await db.execute('CREATE TABLE t (id TEXT PRIMARY KEY)')
  await db.transaction(async () => {
    await db.execute('INSERT INTO t (id) VALUES (?)', ['tx1'])
  })
  const rows = await db.query('SELECT * FROM t')
  assert.deepEqual(rows, [{ id: 'tx1' }])
})

test('27. db.transaction rolls back and re-throws on error', async () => {
  const backend = createMemoryBackend()
  const db = createDb({ backend, migrations: [] })
  await db.execute('CREATE TABLE t (id TEXT PRIMARY KEY)')
  await assert.rejects(async () => {
    await db.transaction(async () => {
      await db.execute('INSERT INTO t (id) VALUES (?)', ['tx1'])
      throw new Error('boom')
    })
  }, /boom/)
  const rows = await db.query('SELECT * FROM t')
  assert.deepEqual(rows, [])
})
