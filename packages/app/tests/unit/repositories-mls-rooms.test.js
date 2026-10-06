import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { createMemoryBackend } from '../../src/lib/db/backends/memory.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createMlsRoomsRepository } from '../../src/lib/db/repositories/mls-rooms.js'
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
  const mlsRooms = createMlsRoomsRepository({ db })
  await mlsRooms.clearAll()
  return { db, mlsRooms }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown room',
    async fn({ mlsRooms }) {
      assert.equal(await mlsRooms.get('r_unknown'), undefined)
    }
  },
  {
    name: '2. upsert inserts a new row with membership_status: pending when not provided',
    async fn({ mlsRooms }) {
      const res = await mlsRooms.upsert({ roomId: 'r_1' })
      assert.equal(res.changes, 1)

      const row = await mlsRooms.get('r_1')
      assert.ok(row)
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.local_client_id, null)
      assert.equal(row.current_epoch, 0)
      assert.equal(row.membership_status, 'pending')
      assert.equal(row.confirmed_transcript_hash, null)
      assert.equal(row.last_error, null)
      assert.equal(row.joined_at, null)
      assert.equal(typeof row.updated_at, 'number')
    }
  },
  {
    name: '3. upsert on an existing row updates current_epoch and updated_at without clearing other fields',
    async fn({ mlsRooms }) {
      const hash = new Uint8Array([1, 2, 3])
      await mlsRooms.upsert({
        roomId: 'r_1',
        localClientId: 'client_1',
        currentEpoch: 1,
        membershipStatus: 'joined',
        confirmedTranscriptHash: hash,
        joinedAt: 10000
      })

      await mlsRooms.upsert({
        roomId: 'r_1',
        currentEpoch: 2
      })

      const row = await mlsRooms.get('r_1')
      assert.equal(row.current_epoch, 2)
      assert.equal(row.local_client_id, 'client_1')
      assert.equal(row.membership_status, 'joined')
      assert.deepEqual(new Uint8Array(row.confirmed_transcript_hash), hash)
      assert.equal(row.joined_at, 10000)
    }
  },
  {
    name: '4. upsert with membershipStatus: joined on a fresh row persists joined',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({
        roomId: 'r_1',
        membershipStatus: 'joined',
        joinedAt: 12345
      })

      const row = await mlsRooms.get('r_1')
      assert.equal(row.membership_status, 'joined')
      assert.equal(row.joined_at, 12345)
    }
  },
  {
    name: '5. markJoined on a fresh room inserts with joined and a numeric joined_at',
    async fn({ mlsRooms }) {
      const hash = new Uint8Array([9, 8, 7])
      const res = await mlsRooms.markJoined('r_fresh', {
        localClientId: 'client_fresh',
        currentEpoch: 5,
        confirmedTranscriptHash: hash
      })
      assert.equal(res.changes, 1)

      const row = await mlsRooms.get('r_fresh')
      assert.equal(row.membership_status, 'joined')
      assert.equal(row.local_client_id, 'client_fresh')
      assert.equal(row.current_epoch, 5)
      assert.deepEqual(new Uint8Array(row.confirmed_transcript_hash), hash)
      assert.equal(typeof row.joined_at, 'number')
      assert.equal(row.last_error, null)
    }
  },
  {
    name: '6. markJoined on a pending row transitions to joined and sets joined_at',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({ roomId: 'r_1', localClientId: 'c_1' })

      const res = await mlsRooms.markJoined('r_1', { currentEpoch: 1 })
      assert.equal(res.changes, 1)

      const row = await mlsRooms.get('r_1')
      assert.equal(row.membership_status, 'joined')
      assert.equal(row.local_client_id, 'c_1')
      assert.equal(row.current_epoch, 1)
      assert.equal(typeof row.joined_at, 'number')
    }
  },
  {
    name: '7. markJoined clears last_error',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({ roomId: 'r_1' })
      await mlsRooms.markError('r_1', 'keystore error')

      let row = await mlsRooms.get('r_1')
      assert.equal(row.membership_status, 'error')
      assert.equal(row.last_error, 'keystore error')

      await mlsRooms.markJoined('r_1')
      row = await mlsRooms.get('r_1')
      assert.equal(row.membership_status, 'joined')
      assert.equal(row.last_error, null)
    }
  },
  {
    name: '8. markLeft sets left',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({ roomId: 'r_1', membershipStatus: 'joined' })
      const res = await mlsRooms.markLeft('r_1')
      assert.equal(res.changes, 1)

      const row = await mlsRooms.get('r_1')
      assert.equal(row.membership_status, 'left')
    }
  },
  {
    name: '9. markError(roomId, message) sets error and stores message',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({ roomId: 'r_1' })
      const res = await mlsRooms.markError('r_1', 'keystore corrupt')
      assert.equal(res.changes, 1)

      const row = await mlsRooms.get('r_1')
      assert.equal(row.membership_status, 'error')
      assert.equal(row.last_error, 'keystore corrupt')
    }
  },
  {
    name: '10. advanceEpoch updates current_epoch and optionally confirmed_transcript_hash',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({ roomId: 'r_1', currentEpoch: 1 })
      const newHash = new Uint8Array([4, 5, 6])
      const res = await mlsRooms.advanceEpoch('r_1', { epoch: 2, confirmedTranscriptHash: newHash })
      assert.equal(res.changes, 1)

      const row = await mlsRooms.get('r_1')
      assert.equal(row.current_epoch, 2)
      assert.deepEqual(new Uint8Array(row.confirmed_transcript_hash), newHash)
    }
  },
  {
    name: '11. listByStatus(joined) returns only joined rows',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({ roomId: 'r_1', membershipStatus: 'joined' })
      await mlsRooms.upsert({ roomId: 'r_2', membershipStatus: 'pending' })
      await mlsRooms.upsert({ roomId: 'r_3', membershipStatus: 'joined' })

      const joined = await mlsRooms.listByStatus('joined')
      assert.equal(joined.length, 2)
      const ids = joined.map(r => r.room_id).sort()
      assert.deepEqual(ids, ['r_1', 'r_3'])
    }
  },
  {
    name: '12. listByStatus(error) returns only errored rows',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({ roomId: 'r_1' })
      await mlsRooms.markError('r_1', 'err')
      await mlsRooms.upsert({ roomId: 'r_2', membershipStatus: 'joined' })

      const errored = await mlsRooms.listByStatus('error')
      assert.equal(errored.length, 1)
      assert.equal(errored[0].room_id, 'r_1')
    }
  },
  {
    name: '13. listJoined is equivalent to listByStatus(joined)',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({ roomId: 'r_1', membershipStatus: 'joined' })
      await mlsRooms.upsert({ roomId: 'r_2', membershipStatus: 'pending' })

      const joined = await mlsRooms.listJoined()
      assert.equal(joined.length, 1)
      assert.equal(joined[0].room_id, 'r_1')
    }
  },
  {
    name: '14. remove deletes one room row',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({ roomId: 'r_1' })
      const res = await mlsRooms.remove('r_1')
      assert.equal(res.changes, 1)
      assert.equal(await mlsRooms.get('r_1'), undefined)
    }
  },
  {
    name: '15. clearAll deletes every row',
    async fn({ mlsRooms }) {
      await mlsRooms.upsert({ roomId: 'r_1' })
      await mlsRooms.upsert({ roomId: 'r_2' })

      const res = await mlsRooms.clearAll()
      assert.equal(res.changes, 2)
      assert.equal((await mlsRooms.listJoined()).length, 0)
    }
  },
  {
    name: '16. createRepositories includes mlsRooms repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.mlsRooms)
      assert.equal(typeof repos.mlsRooms.get, 'function')
      assert.equal(typeof repos.mlsRooms.upsert, 'function')
      assert.equal(typeof repos.mlsRooms.markJoined, 'function')
      assert.equal(typeof repos.mlsRooms.markLeft, 'function')
      assert.equal(typeof repos.mlsRooms.markError, 'function')
      assert.equal(typeof repos.mlsRooms.advanceEpoch, 'function')
      assert.equal(typeof repos.mlsRooms.listByStatus, 'function')
      assert.equal(typeof repos.mlsRooms.listJoined, 'function')
      assert.equal(typeof repos.mlsRooms.remove, 'function')
      assert.equal(typeof repos.mlsRooms.clearAll, 'function')
    }
  }
]

test('MLS Rooms Repository - Memory SQLite Backend', async (t) => {
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

test('MLS Rooms Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
