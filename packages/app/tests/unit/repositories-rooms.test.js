import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createRoomsRepository } from '../../src/lib/db/repositories/rooms.js'
import { createRoomMembersRepository } from '../../src/lib/db/repositories/room-members.js'
import { createRoomOrderRepository } from '../../src/lib/db/repositories/room-order.js'
import { createRepositories } from '../../src/lib/db/repositories/index.js'

function loadMigrations() {
  const dir = resolve(import.meta.dirname, '../../src/db/migrations')
  return [
    { name: '0001-meta.sql', sql: readFileSync(resolve(dir, '0001-meta.sql'), 'utf8') },
    { name: '0002-users.sql', sql: readFileSync(resolve(dir, '0002-users.sql'), 'utf8') },
    { name: '0003-rooms.sql', sql: readFileSync(resolve(dir, '0003-rooms.sql'), 'utf8') }
  ]
}

async function buildRepo(backend) {
  const db = await createDb({
    backend,
    migrations: loadMigrations()
  })
  await db.open()
  const rooms = createRoomsRepository({ db })
  const roomMembers = createRoomMembersRepository({ db })
  const roomOrder = createRoomOrderRepository({ db })
  await rooms.clearAll()
  return { db, rooms, roomMembers, roomOrder }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown room',
    async fn({ rooms }) {
      const res = await rooms.get('r_missing')
      assert.equal(res, undefined)
    }
  },
  {
    name: '2. upsert inserts a new room',
    async fn({ rooms }) {
      const res = await rooms.upsert({ roomId: 'r_1', name: 'General' })
      assert.equal(res.changes, 1)

      const row = await rooms.get('r_1')
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.name, 'General')
      assert.equal(row.avatar_file_id, null)
      assert.equal(row.description, null)
      assert.equal(row.disappearing_timer, null)
      assert.equal(row.metadata_version, 1)
      assert.equal(typeof row.updated_at, 'number')
    }
  },
  {
    name: '3. upsert with a partial field does not clear other fields',
    async fn({ rooms }) {
      await rooms.upsert({ roomId: 'r_1', name: 'Team', description: 'A room' })
      await rooms.upsert({ roomId: 'r_1', name: 'Team Alpha' })

      const row = await rooms.get('r_1')
      assert.equal(row.name, 'Team Alpha')
      assert.equal(row.description, 'A room')
    }
  },
  {
    name: '4. upsert with metadataVersion replaces the version even if the value is the same',
    async fn({ rooms }) {
      await rooms.upsert({ roomId: 'r_1', name: 'Team', metadataVersion: 2 })
      let row = await rooms.get('r_1')
      assert.equal(row.metadata_version, 2)

      await rooms.upsert({ roomId: 'r_1', name: 'Team Alpha', metadataVersion: 3 })
      row = await rooms.get('r_1')
      assert.equal(row.metadata_version, 3)
    }
  },
  {
    name: '5. upsert refreshes updated_at',
    async fn({ rooms }) {
      await rooms.upsert({ roomId: 'r_1', name: 'Team' })
      const row1 = await rooms.get('r_1')
      const t1 = row1.updated_at

      await new Promise((r) => setTimeout(r, 5))

      await rooms.upsert({ roomId: 'r_1', name: 'Team Alpha' })
      const row2 = await rooms.get('r_1')
      const t2 = row2.updated_at

      assert.ok(t2 > t1, `expected ${t2} > ${t1}`)
    }
  },
  {
    name: '6. remove deletes room and clears room_members and room_order in a transaction',
    async fn({ rooms, roomMembers, roomOrder }) {
      await rooms.upsert({ roomId: 'r_1', name: 'Team' })
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'owner' })
      await roomOrder.setOrder(['r_1'])

      const delRes = await rooms.remove('r_1')
      assert.equal(delRes.changes, 1)

      assert.equal(await rooms.get('r_1'), undefined)
      assert.equal(await roomMembers.countInRoom('r_1'), 0)
      assert.deepEqual(await roomOrder.list(), [])
    }
  },
  {
    name: '7. remove on an unknown room returns { changes: 0 } and does not throw',
    async fn({ rooms }) {
      const res = await rooms.remove('r_missing')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '8. list orders by updated_at DESC',
    async fn({ rooms }) {
      await rooms.upsert({ roomId: 'r_1', name: 'Room 1' })
      await new Promise((r) => setTimeout(r, 5))
      await rooms.upsert({ roomId: 'r_2', name: 'Room 2' })
      await new Promise((r) => setTimeout(r, 5))
      await rooms.upsert({ roomId: 'r_3', name: 'Room 3' })

      const rows = await rooms.list()
      assert.equal(rows.length, 3)
      assert.equal(rows[0].room_id, 'r_3')
      assert.equal(rows[1].room_id, 'r_2')
      assert.equal(rows[2].room_id, 'r_1')
    }
  },
  {
    name: '9. list respects limit',
    async fn({ rooms }) {
      for (let i = 1; i <= 5; i++) {
        await rooms.upsert({ roomId: `r_${i}`, name: `Room ${i}` })
      }
      const rows = await rooms.list({ limit: 2 })
      assert.equal(rows.length, 2)
    }
  },
  {
    name: '10. list supports cursor pagination',
    async fn({ rooms }) {
      for (let i = 1; i <= 5; i++) {
        await rooms.upsert({ roomId: `r_${i}`, name: `Room ${i}` })
        await new Promise((r) => setTimeout(r, 5))
      }

      const page1 = await rooms.list({ limit: 2 })
      assert.equal(page1.length, 2)
      assert.equal(page1[0].room_id, 'r_5')
      assert.equal(page1[1].room_id, 'r_4')

      const cursor = page1[1].updated_at
      const page2 = await rooms.list({ limit: 2, cursor })
      assert.equal(page2.length, 2)
      assert.equal(page2[0].room_id, 'r_3')
      assert.equal(page2[1].room_id, 'r_2')
    }
  },
  {
    name: '11. count returns total',
    async fn({ rooms }) {
      assert.equal(await rooms.count(), 0)
      await rooms.upsert({ roomId: 'r_1' })
      await rooms.upsert({ roomId: 'r_2' })
      await rooms.upsert({ roomId: 'r_3' })
      assert.equal(await rooms.count(), 3)
    }
  },
  {
    name: '12. clearAll deletes rooms, members, and order rows in one call',
    async fn({ rooms, roomMembers, roomOrder }) {
      await rooms.upsert({ roomId: 'r_1' })
      await rooms.upsert({ roomId: 'r_2' })
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'owner' })
      await roomOrder.setOrder(['r_1', 'r_2'])

      const res = await rooms.clearAll()
      assert.equal(res.changes, 2)
      assert.equal(await rooms.count(), 0)
      assert.equal(await roomMembers.countInRoom('r_1'), 0)
      assert.deepEqual(await roomOrder.list(), [])
    }
  },
  {
    name: '13. upsert with disappearingTimer null does not overwrite previously set timer',
    async fn({ rooms }) {
      await rooms.upsert({ roomId: 'r_1', disappearingTimer: 86400 })
      await rooms.upsert({ roomId: 'r_1', name: 'Updated Room', disappearingTimer: null })

      const row = await rooms.get('r_1')
      assert.equal(row.disappearing_timer, 86400)
    }
  },
  {
    name: '14. createRepositories returns rooms repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.rooms)
      assert.equal(typeof repos.rooms.get, 'function')
      assert.equal(typeof repos.rooms.upsert, 'function')
      assert.equal(typeof repos.rooms.remove, 'function')
      assert.equal(typeof repos.rooms.list, 'function')
      assert.equal(typeof repos.rooms.count, 'function')
      assert.equal(typeof repos.rooms.clearAll, 'function')
    }
  }
]

test('Rooms Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
