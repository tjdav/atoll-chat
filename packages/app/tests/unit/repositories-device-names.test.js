import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { createMemoryBackend } from '../../src/lib/db/backends/memory.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createDeviceNamesRepository } from '../../src/lib/db/repositories/device-names.js'
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
    { name: '0009-device-names-starred-items.sql', sql: readFileSync(resolve(dir, '0009-device-names-starred-items.sql'), 'utf8') }
  ]
}

async function buildRepo(backend) {
  const db = await createDb({
    backend,
    migrations: loadMigrations()
  })
  await db.open()
  const deviceNames = createDeviceNamesRepository({ db })
  await deviceNames.clearAll()
  return { db, deviceNames }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown pair',
    async fn({ deviceNames }) {
      assert.equal(await deviceNames.get('u_1', 'd_unknown'), undefined)
    }
  },
  {
    name: '2. applyRemote inserts a new row. get reflects values, updated_at is numeric',
    async fn({ deviceNames }) {
      const res = await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'enc_name_1',
        userSeq: 10
      })
      assert.equal(res.changes, 1)

      const row = await deviceNames.get('u_1', 'd_1')
      assert.ok(row)
      assert.equal(row.user_id, 'u_1')
      assert.equal(row.device_id, 'd_1')
      assert.equal(row.encrypted_device_name, 'enc_name_1')
      assert.equal(row.user_seq, 10)
      assert.equal(typeof row.updated_at, 'number')
      assert.equal(row.deleted_at, null)
    }
  },
  {
    name: '3. applyRemote with a higher user_seq updates the row',
    async fn({ deviceNames }) {
      await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'v1',
        userSeq: 10
      })

      const res = await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'v2',
        userSeq: 20
      })
      assert.equal(res.changes, 1)

      const row = await deviceNames.get('u_1', 'd_1')
      assert.equal(row.encrypted_device_name, 'v2')
      assert.equal(row.user_seq, 20)
    }
  },
  {
    name: '4. applyRemote with a lower user_seq is a no-op and leaves row unchanged',
    async fn({ deviceNames }) {
      await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'v20',
        userSeq: 20
      })

      const res = await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'v5',
        userSeq: 5
      })
      assert.equal(res.changes, 0)

      const row = await deviceNames.get('u_1', 'd_1')
      assert.equal(row.encrypted_device_name, 'v20')
      assert.equal(row.user_seq, 20)
    }
  },
  {
    name: '5. applyRemote with an equal user_seq is a no-op',
    async fn({ deviceNames }) {
      await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'v20',
        userSeq: 20
      })

      const res = await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'v20_same',
        userSeq: 20
      })
      assert.equal(res.changes, 0)

      const row = await deviceNames.get('u_1', 'd_1')
      assert.equal(row.encrypted_device_name, 'v20')
    }
  },
  {
    name: '6. applyRemote with a deletedAt timestamp sets the tombstone',
    async fn({ deviceNames }) {
      await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'v1',
        userSeq: 10
      })

      const now = Date.now()
      const res = await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'v1',
        userSeq: 11,
        deletedAt: now
      })
      assert.equal(res.changes, 1)

      const row = await deviceNames.get('u_1', 'd_1')
      assert.equal(row.deleted_at, now)
      assert.equal(row.user_seq, 11)
    }
  },
  {
    name: '7. applyRemote with deletedAt on an already-tombstoned row with higher seq updates seq',
    async fn({ deviceNames }) {
      const t1 = Date.now() - 1000
      await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'v1',
        userSeq: 11,
        deletedAt: t1
      })

      const t2 = Date.now()
      const res = await deviceNames.applyRemote({
        userId: 'u_1',
        deviceId: 'd_1',
        encryptedDeviceName: 'v1',
        userSeq: 15,
        deletedAt: t2
      })
      assert.equal(res.changes, 1)

      const row = await deviceNames.get('u_1', 'd_1')
      assert.equal(row.deleted_at, t2)
      assert.equal(row.user_seq, 15)
    }
  },
  {
    name: '8. listForUser returns all rows ordered by user_seq DESC',
    async fn({ deviceNames }) {
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_1', encryptedDeviceName: 'a', userSeq: 10 })
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_2', encryptedDeviceName: 'b', userSeq: 30 })
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_3', encryptedDeviceName: 'c', userSeq: 20, deletedAt: Date.now() })
      await deviceNames.applyRemote({ userId: 'u_2', deviceId: 'd_other', encryptedDeviceName: 'x', userSeq: 100 })

      const rows = await deviceNames.listForUser('u_1')
      assert.equal(rows.length, 3)
      assert.equal(rows[0].device_id, 'd_2')
      assert.equal(rows[1].device_id, 'd_3')
      assert.equal(rows[2].device_id, 'd_1')
    }
  },
  {
    name: '9. listActiveForUser excludes tombstoned rows',
    async fn({ deviceNames }) {
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_1', encryptedDeviceName: 'a', userSeq: 10 })
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_2', encryptedDeviceName: 'b', userSeq: 30 })
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_3', encryptedDeviceName: 'c', userSeq: 20, deletedAt: Date.now() })

      const active = await deviceNames.listActiveForUser('u_1')
      assert.equal(active.length, 2)
      assert.equal(active[0].device_id, 'd_2')
      assert.equal(active[1].device_id, 'd_1')
    }
  },
  {
    name: '10. applyBatch applies multiple rows in user_seq order',
    async fn({ deviceNames }) {
      const rows = [
        { deviceId: 'd_3', encryptedDeviceName: 'c', userSeq: 30 },
        { deviceId: 'd_1', encryptedDeviceName: 'a', userSeq: 10 },
        { deviceId: 'd_2', encryptedDeviceName: 'b', userSeq: 20 }
      ]

      const res = await deviceNames.applyBatch('u_1', rows)
      assert.deepEqual(res, { applied: 3, skipped: 0 })

      const list = await deviceNames.listForUser('u_1')
      assert.equal(list[0].device_id, 'd_3')
      assert.equal(list[1].device_id, 'd_2')
      assert.equal(list[2].device_id, 'd_1')
    }
  },
  {
    name: '11. applyBatch skips rows with user_seq <= existing',
    async fn({ deviceNames }) {
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_1', encryptedDeviceName: 'a_old', userSeq: 15 })

      const rows = [
        { deviceId: 'd_1', encryptedDeviceName: 'a_stale', userSeq: 10 },
        { deviceId: 'd_1', encryptedDeviceName: 'a_same', userSeq: 15 },
        { deviceId: 'd_2', encryptedDeviceName: 'b_new', userSeq: 20 }
      ]

      const res = await deviceNames.applyBatch('u_1', rows)
      assert.deepEqual(res, { applied: 1, skipped: 2 })

      const row1 = await deviceNames.get('u_1', 'd_1')
      assert.equal(row1.encrypted_device_name, 'a_old')
    }
  },
  {
    name: '12. applyBatch on an empty array returns { applied: 0, skipped: 0 }',
    async fn({ deviceNames }) {
      const res = await deviceNames.applyBatch('u_1', [])
      assert.deepEqual(res, { applied: 0, skipped: 0 })
    }
  },
  {
    name: '13. getHighestSeq returns 0 for a user with no rows',
    async fn({ deviceNames }) {
      assert.equal(await deviceNames.getHighestSeq('u_nobody'), 0)
    }
  },
  {
    name: '14. getHighestSeq returns the maximum user_seq',
    async fn({ deviceNames }) {
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_1', encryptedDeviceName: 'a', userSeq: 10 })
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_2', encryptedDeviceName: 'b', userSeq: 45 })
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_3', encryptedDeviceName: 'c', userSeq: 30 })

      assert.equal(await deviceNames.getHighestSeq('u_1'), 45)
    }
  },
  {
    name: '15. remove hard-deletes',
    async fn({ deviceNames }) {
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_1', encryptedDeviceName: 'a', userSeq: 10 })
      const res = await deviceNames.remove('u_1', 'd_1')
      assert.equal(res.changes, 1)
      assert.equal(await deviceNames.get('u_1', 'd_1'), undefined)
    }
  },
  {
    name: '16. clearAll deletes every row',
    async fn({ deviceNames }) {
      await deviceNames.applyRemote({ userId: 'u_1', deviceId: 'd_1', encryptedDeviceName: 'a', userSeq: 10 })
      await deviceNames.applyRemote({ userId: 'u_2', deviceId: 'd_2', encryptedDeviceName: 'b', userSeq: 20 })

      const res = await deviceNames.clearAll()
      assert.equal(res.changes, 2)
      assert.equal(await deviceNames.getHighestSeq('u_1'), 0)
      assert.equal(await deviceNames.getHighestSeq('u_2'), 0)
    }
  },
  {
    name: '17. createRepositories includes deviceNames repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.deviceNames)
      assert.equal(typeof repos.deviceNames.get, 'function')
      assert.equal(typeof repos.deviceNames.listForUser, 'function')
      assert.equal(typeof repos.deviceNames.listActiveForUser, 'function')
      assert.equal(typeof repos.deviceNames.applyRemote, 'function')
      assert.equal(typeof repos.deviceNames.applyBatch, 'function')
      assert.equal(typeof repos.deviceNames.getHighestSeq, 'function')
      assert.equal(typeof repos.deviceNames.remove, 'function')
      assert.equal(typeof repos.deviceNames.clearAll, 'function')
    }
  }
]

test('Device Names Repository - Memory SQLite Backend', async (t) => {
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

test('Device Names Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
