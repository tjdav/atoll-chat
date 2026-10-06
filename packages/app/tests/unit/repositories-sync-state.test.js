import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { createMemoryBackend } from '../../src/lib/db/backends/memory.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createSyncStateRepository } from '../../src/lib/db/repositories/sync-state.js'
import { createRepositories } from '../../src/lib/db/repositories/index.js'

function loadMigrations() {
  const dir = resolve(import.meta.dirname, '../../src/db/migrations')
  return [
    { name: '0001-meta.sql', sql: readFileSync(resolve(dir, '0001-meta.sql'), 'utf8') },
    { name: '0002-users.sql', sql: readFileSync(resolve(dir, '0002-users.sql'), 'utf8') },
    { name: '0003-rooms.sql', sql: readFileSync(resolve(dir, '0003-rooms.sql'), 'utf8') },
    { name: '0004-messages.sql', sql: readFileSync(resolve(dir, '0004-messages.sql'), 'utf8') },
    { name: '0005-attachments-reactions.sql', sql: readFileSync(resolve(dir, '0005-attachments-reactions.sql'), 'utf8') },
    { name: '0006-user-state.sql', sql: readFileSync(resolve(dir, '0006-user-state.sql'), 'utf8') },
    { name: '0007-outbox.sql', sql: readFileSync(resolve(dir, '0007-outbox.sql'), 'utf8') },
    { name: '0008-room-preferences-nicknames.sql', sql: readFileSync(resolve(dir, '0008-room-preferences-nicknames.sql'), 'utf8') },
    { name: '0009-device-names-starred-items.sql', sql: readFileSync(resolve(dir, '0009-device-names-starred-items.sql'), 'utf8') },
    { name: '0010-sync-state.sql', sql: readFileSync(resolve(dir, '0010-sync-state.sql'), 'utf8') }
  ]
}

async function buildRepo(backend) {
  const db = await createDb({
    backend,
    migrations: loadMigrations()
  })
  await db.open()
  const syncState = createSyncStateRepository({ db })
  await syncState.clearAll()
  return { db, syncState }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown room',
    async fn({ syncState }) {
      assert.equal(await syncState.get('r_unknown'), undefined)
    }
  },
  {
    name: '2. set inserts a new row. get reflects values, updated_at is numeric',
    async fn({ syncState }) {
      const res = await syncState.set('r_1', { epoch: 1, seq: 10 })
      assert.equal(res.changes, 1)

      const row = await syncState.get('r_1')
      assert.ok(row)
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.epoch, 1)
      assert.equal(row.seq, 10)
      assert.equal(typeof row.updated_at, 'number')
    }
  },
  {
    name: '3. set on an existing row replaces the cursor',
    async fn({ syncState }) {
      await syncState.set('r_1', { epoch: 1, seq: 10 })
      const res = await syncState.set('r_1', { epoch: 2, seq: 5 })
      assert.equal(res.changes, 1)

      const row = await syncState.get('r_1')
      assert.equal(row.epoch, 2)
      assert.equal(row.seq, 5)
    }
  },
  {
    name: '4. getCursor returns { epoch, seq } for a known room',
    async fn({ syncState }) {
      await syncState.set('r_1', { epoch: 3, seq: 42 })
      const cursor = await syncState.getCursor('r_1')
      assert.deepEqual(cursor, { epoch: 3, seq: 42 })
    }
  },
  {
    name: '5. getCursor returns undefined for an unknown room',
    async fn({ syncState }) {
      assert.equal(await syncState.getCursor('r_none'), undefined)
    }
  },
  {
    name: '6. advance on a fresh room inserts. Returns { changes: 1 }',
    async fn({ syncState }) {
      const res = await syncState.advance('r_fresh', { epoch: 1, seq: 1 })
      assert.equal(res.changes, 1)

      const cursor = await syncState.getCursor('r_fresh')
      assert.deepEqual(cursor, { epoch: 1, seq: 1 })
    }
  },
  {
    name: '7. advance with a strictly greater (epoch, seq) updates',
    async fn({ syncState }) {
      await syncState.advance('r_1', { epoch: 1, seq: 5 })
      const res = await syncState.advance('r_1', { epoch: 1, seq: 6 })
      assert.equal(res.changes, 1)

      const cursor = await syncState.getCursor('r_1')
      assert.deepEqual(cursor, { epoch: 1, seq: 6 })
    }
  },
  {
    name: '8. advance with equal (epoch, seq) returns { changes: 0 }',
    async fn({ syncState }) {
      await syncState.advance('r_1', { epoch: 1, seq: 5 })
      const res = await syncState.advance('r_1', { epoch: 1, seq: 5 })
      assert.equal(res.changes, 0)

      const cursor = await syncState.getCursor('r_1')
      assert.deepEqual(cursor, { epoch: 1, seq: 5 })
    }
  },
  {
    name: '9. advance with a lower epoch returns { changes: 0 }',
    async fn({ syncState }) {
      await syncState.advance('r_1', { epoch: 2, seq: 5 })
      const res = await syncState.advance('r_1', { epoch: 1, seq: 100 })
      assert.equal(res.changes, 0)

      const cursor = await syncState.getCursor('r_1')
      assert.deepEqual(cursor, { epoch: 2, seq: 5 })
    }
  },
  {
    name: '10. advance with equal epoch and lower seq returns { changes: 0 }',
    async fn({ syncState }) {
      await syncState.advance('r_1', { epoch: 2, seq: 50 })
      const res = await syncState.advance('r_1', { epoch: 2, seq: 49 })
      assert.equal(res.changes, 0)

      const cursor = await syncState.getCursor('r_1')
      assert.deepEqual(cursor, { epoch: 2, seq: 50 })
    }
  },
  {
    name: '11. advance with a higher epoch and lower seq updates (higher epoch wins)',
    async fn({ syncState }) {
      await syncState.advance('r_1', { epoch: 2, seq: 50 })
      const res = await syncState.advance('r_1', { epoch: 3, seq: 1 })
      assert.equal(res.changes, 1)

      const cursor = await syncState.getCursor('r_1')
      assert.deepEqual(cursor, { epoch: 3, seq: 1 })
    }
  },
  {
    name: '12. list returns rows ordered by updated_at DESC',
    async fn({ syncState }) {
      await syncState.set('r_1', { epoch: 1, seq: 1 })
      await new Promise(r => setTimeout(r, 10))
      await syncState.set('r_2', { epoch: 1, seq: 1 })

      const rows = await syncState.list()
      assert.equal(rows.length, 2)
      assert.equal(rows[0].room_id, 'r_2')
      assert.equal(rows[1].room_id, 'r_1')
    }
  },
  {
    name: '13. remove deletes one room cursor',
    async fn({ syncState }) {
      await syncState.set('r_1', { epoch: 1, seq: 1 })
      const res = await syncState.remove('r_1')
      assert.equal(res.changes, 1)
      assert.equal(await syncState.get('r_1'), undefined)
    }
  },
  {
    name: '14. remove on an unknown room returns { changes: 0 }',
    async fn({ syncState }) {
      const res = await syncState.remove('r_unknown')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '15. clearAll deletes every row',
    async fn({ syncState }) {
      await syncState.set('r_1', { epoch: 1, seq: 1 })
      await syncState.set('r_2', { epoch: 2, seq: 2 })

      const res = await syncState.clearAll()
      assert.equal(res.changes, 2)
      assert.equal((await syncState.list()).length, 0)
    }
  },
  {
    name: '16. createRepositories includes syncState repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.syncState)
      assert.equal(typeof repos.syncState.get, 'function')
      assert.equal(typeof repos.syncState.getCursor, 'function')
      assert.equal(typeof repos.syncState.set, 'function')
      assert.equal(typeof repos.syncState.advance, 'function')
      assert.equal(typeof repos.syncState.list, 'function')
      assert.equal(typeof repos.syncState.remove, 'function')
      assert.equal(typeof repos.syncState.clearAll, 'function')
    }
  }
]

test('Sync State Repository - Memory SQLite Backend', async (t) => {
  const memoryBackend = createMemoryBackend()
  for (const c of cases) {
    await t.test(c.name, async (st) => {
      try {
        const ctx = await buildRepo(memoryBackend)
        await c.fn(ctx)
      } catch (err) {
        if (
          err?.message?.includes('Unsupported SQL') ||
          err?.message?.includes('Migration')
        ) {
          st.skip(`Memory backend SQL engine limitation: ${err.message}`)
          return
        }
        throw err
      }
    })
  }
})

test('Sync State Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
