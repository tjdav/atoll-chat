import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { createMemoryBackend } from '../../src/lib/db/backends/memory.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createProcessedEventsRepository, makeKey } from '../../src/lib/db/repositories/processed-events.js'
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
  const processedEvents = createProcessedEventsRepository({ db })
  await processedEvents.clearAll()
  return { db, processedEvents }
}

const cases = [
  {
    name: '1. has returns false for an unknown key',
    async fn({ processedEvents }) {
      assert.equal(await processedEvents.has('unknown:key:1'), false)
    }
  },
  {
    name: '2. mark inserts a key. has returns true',
    async fn({ processedEvents }) {
      const res = await processedEvents.mark('read:sync:42')
      assert.equal(res.changes, 1)

      assert.equal(await processedEvents.has('read:sync:42'), true)
    }
  },
  {
    name: '3. mark on an existing key returns { changes: 0 } (INSERT OR IGNORE)',
    async fn({ processedEvents }) {
      await processedEvents.mark('read:sync:42')
      const res = await processedEvents.mark('read:sync:42')
      assert.equal(res.changes, 0)
      assert.equal(await processedEvents.has('read:sync:42'), true)
    }
  },
  {
    name: '4. makeKey builds the composite key correctly',
    async fn() {
      assert.equal(makeKey('read', 'sync', 42), 'read:sync:42')
      assert.equal(makeKey('device', 'name_updated', '100'), 'device:name_updated:100')
    }
  },
  {
    name: '5. hasKey uses makeKey',
    async fn({ processedEvents }) {
      await processedEvents.mark('read:sync:42')
      assert.equal(await processedEvents.hasKey('read', 'sync', 42), true)
      assert.equal(await processedEvents.hasKey('read', 'sync', 43), false)
    }
  },
  {
    name: '6. markKey inserts',
    async fn({ processedEvents }) {
      const res = await processedEvents.markKey('starred_item', 'added', 1288)
      assert.equal(res.changes, 1)
      assert.equal(await processedEvents.has('starred_item:added:1288'), true)
    }
  },
  {
    name: '7. markBatch([]) returns { changes: 0 }',
    async fn({ processedEvents }) {
      const res = await processedEvents.markBatch([])
      assert.deepEqual(res, { changes: 0 })
    }
  },
  {
    name: '8. markBatch([a, b, a]) inserts two rows and returns { changes: 2 }',
    async fn({ processedEvents }) {
      const res = await processedEvents.markBatch(['key_a', 'key_b', 'key_a'])
      assert.deepEqual(res, { changes: 2 })
      assert.equal(await processedEvents.count(), 2)
      assert.equal(await processedEvents.has('key_a'), true)
      assert.equal(await processedEvents.has('key_b'), true)
    }
  },
  {
    name: '9. prune(beforeMs) deletes rows with processed_at < beforeMs',
    async fn({ processedEvents, db }) {
      const now = Date.now()
      await db.execute('INSERT INTO processed_events (event_key, processed_at) VALUES (?, ?)', ['old_1', now - 10000])
      await db.execute('INSERT INTO processed_events (event_key, processed_at) VALUES (?, ?)', ['old_2', now - 5000])
      await db.execute('INSERT INTO processed_events (event_key, processed_at) VALUES (?, ?)', ['new_1', now])

      const res = await processedEvents.prune(now - 2000)
      assert.equal(res.changes, 2)
      assert.equal(await processedEvents.has('old_1'), false)
      assert.equal(await processedEvents.has('old_2'), false)
      assert.equal(await processedEvents.has('new_1'), true)
    }
  },
  {
    name: '10. prune on a fresh table returns { changes: 0 }',
    async fn({ processedEvents }) {
      const res = await processedEvents.prune(Date.now())
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '11. count returns the number of rows',
    async fn({ processedEvents }) {
      assert.equal(await processedEvents.count(), 0)
      await processedEvents.mark('k1')
      await processedEvents.mark('k2')
      assert.equal(await processedEvents.count(), 2)
    }
  },
  {
    name: '12. clearAll deletes every row',
    async fn({ processedEvents }) {
      await processedEvents.mark('k1')
      await processedEvents.mark('k2')
      const res = await processedEvents.clearAll()
      assert.equal(res.changes, 2)
      assert.equal(await processedEvents.count(), 0)
    }
  },
  {
    name: '13. createRepositories includes processedEvents repository and exports makeKey',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.processedEvents)
      assert.equal(typeof repos.processedEvents.has, 'function')
      assert.equal(typeof repos.processedEvents.hasKey, 'function')
      assert.equal(typeof repos.processedEvents.mark, 'function')
      assert.equal(typeof repos.processedEvents.markKey, 'function')
      assert.equal(typeof repos.processedEvents.markBatch, 'function')
      assert.equal(typeof repos.processedEvents.prune, 'function')
      assert.equal(typeof repos.processedEvents.count, 'function')
      assert.equal(typeof repos.processedEvents.clearAll, 'function')
    }
  }
]

test('Processed Events Repository - Memory SQLite Backend', async (t) => {
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

test('Processed Events Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
