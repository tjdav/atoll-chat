import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWasmBackend } from '../../src/lib/db/backends/wasm.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createDb } from '../../src/lib/db/index.js'

test('1. createWasmBackend returns backend object with full contract', () => {
  const backend = createWasmBackend({ dbName: 'test_wasm' })
  assert.equal(typeof backend.open, 'function')
  assert.equal(typeof backend.close, 'function')
  assert.equal(typeof backend.exec, 'function')
  assert.equal(typeof backend.all, 'function')
  assert.equal(typeof backend.one, 'function')
  assert.equal(typeof backend.run, 'function')
  assert.equal(typeof backend.begin, 'function')
  assert.equal(typeof backend.commit, 'function')
  assert.equal(typeof backend.rollback, 'function')
  assert.equal(typeof backend.isPersistent, 'function')
})

test('2. open() in Node environment falls back to in-memory SQLite and isPersistent is false', async () => {
  const backend = createWasmBackend({ dbName: 'test_wasm' })
  await backend.open()
  assert.equal(backend.isPersistent(), false)
  await backend.close()
})

test('3. WASM exec CREATE TABLE and INSERT returns changes and lastInsertId', async () => {
  const backend = createWasmBackend({ dbName: 'test_wasm' })
  await backend.open()
  await backend.exec('CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)', [])
  const res = await backend.exec('INSERT INTO foo (v) VALUES (?)', ['hello'])
  assert.equal(res.changes, 1)
  assert.equal(typeof res.lastInsertId, 'number')
  assert.equal(res.lastInsertId, 1)
  await backend.close()
})

test('4. WASM all and one return rows and undefined on missing', async () => {
  const backend = createWasmBackend({ dbName: 'test_wasm' })
  await backend.open()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])
  await backend.exec('INSERT INTO foo (id, v) VALUES (?, ?)', ['a', '100'])
  const rows = await backend.all('SELECT * FROM foo', [])
  assert.deepEqual(rows, [{ id: 'a', v: '100' }])

  const row = await backend.one('SELECT * FROM foo WHERE id = ?', ['a'])
  assert.deepEqual(row, { id: 'a', v: '100' })

  const missing = await backend.one('SELECT * FROM foo WHERE id = ?', ['missing'])
  assert.equal(missing, undefined)
  await backend.close()
})

test('5. WASM transaction begin, commit, and rollback', async () => {
  const backend = createWasmBackend({ dbName: 'test_wasm' })
  await backend.open()
  await backend.exec('CREATE TABLE foo (id TEXT PRIMARY KEY, v TEXT)', [])

  // Commit test
  await backend.begin()
  await backend.exec('INSERT INTO foo (id, v) VALUES (?, ?)', ['a', '1'])
  await backend.commit()
  assert.equal((await backend.all('SELECT * FROM foo')).length, 1)

  // Rollback test
  await backend.begin()
  await backend.exec('INSERT INTO foo (id, v) VALUES (?, ?)', ['b', '2'])
  await backend.rollback()
  assert.equal((await backend.all('SELECT * FROM foo')).length, 1)

  await backend.close()
})

test('6. createDb with wasm backend and migrations applies migrations and meta helpers work', async () => {
  const backend = createWasmBackend({ dbName: 'test_wasm_db' })
  const db = createDb({
    backend,
    migrations: [
      {
        name: '0001-meta.sql',
        sql: 'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);'
      }
    ]
  })

  const res = await db.open()
  assert.deepEqual(res, { applied: ['0001-meta.sql'], skipped: [] })

  await db.meta.set('theme', { mode: 'dark' })
  const theme = await db.meta.get('theme')
  assert.deepEqual(theme, { mode: 'dark' })

  const delRes = await db.meta.delete('theme')
  assert.equal(delRes.changes, 1)
  assert.equal(await db.meta.get('theme'), undefined)

  await db.close()
})

test('7. resolveBackend({ prefer: "wasm" }) returns WASM backend', async () => {
  const backend = await resolveBackend({ prefer: 'wasm' })
  assert.equal(typeof backend.isPersistent, 'function')
})
