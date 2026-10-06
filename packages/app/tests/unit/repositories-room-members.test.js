import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createRoomMembersRepository } from '../../src/lib/db/repositories/room-members.js'
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
  const roomMembers = createRoomMembersRepository({ db })
  await roomMembers.clearAll()
  return { db, roomMembers }
}

const cases = [
  {
    name: '1. listInRoom returns members ordered by joined_at ASC',
    async fn({ roomMembers }) {
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_2', role: 'member', joinedAt: 2000 })
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'owner', joinedAt: 1000 })

      const members = await roomMembers.listInRoom('r_1')
      assert.equal(members.length, 2)
      assert.equal(members[0].user_id, 'u_1')
      assert.equal(members[1].user_id, 'u_2')
    }
  },
  {
    name: '2. get returns undefined for an unknown pair',
    async fn({ roomMembers }) {
      const res = await roomMembers.get('r_missing', 'u_missing')
      assert.equal(res, undefined)
    }
  },
  {
    name: '3. get returns the record for a known pair',
    async fn({ roomMembers }) {
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'owner', joinedAt: 1000 })
      const member = await roomMembers.get('r_1', 'u_1')
      assert.ok(member)
      assert.equal(member.room_id, 'r_1')
      assert.equal(member.user_id, 'u_1')
      assert.equal(member.role, 'owner')
      assert.equal(member.joined_at, 1000)
    }
  },
  {
    name: '4. addMember inserts membership record',
    async fn({ roomMembers }) {
      const res = await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'member' })
      assert.equal(res.changes, 1)

      const member = await roomMembers.get('r_1', 'u_1')
      assert.equal(member.role, 'member')
      assert.equal(typeof member.joined_at, 'number')
    }
  },
  {
    name: '5. addMember on an existing pair updates role and preserves new joined_at',
    async fn({ roomMembers }) {
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'member', joinedAt: 1000 })
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'moderator', joinedAt: 2000 })

      const member = await roomMembers.get('r_1', 'u_1')
      assert.equal(member.role, 'moderator')
      assert.equal(member.joined_at, 2000)
    }
  },
  {
    name: '6. removeMember deletes one record',
    async fn({ roomMembers }) {
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'owner' })
      const res = await roomMembers.removeMember('r_1', 'u_1')
      assert.equal(res.changes, 1)

      assert.equal(await roomMembers.get('r_1', 'u_1'), undefined)
    }
  },
  {
    name: '7. removeMember on an unknown pair returns { changes: 0 }',
    async fn({ roomMembers }) {
      const res = await roomMembers.removeMember('r_missing', 'u_missing')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '8. removeAllInRoom deletes every record for a room, leaving other rooms untouched',
    async fn({ roomMembers }) {
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'owner' })
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_2', role: 'member' })
      await roomMembers.addMember({ roomId: 'r_2', userId: 'u_1', role: 'member' })

      const res = await roomMembers.removeAllInRoom('r_1')
      assert.equal(res.changes, 2)
      assert.equal(await roomMembers.countInRoom('r_1'), 0)
      assert.equal(await roomMembers.countInRoom('r_2'), 1)
    }
  },
  {
    name: '9. listRoomsForUser returns room ids ordered by joined_at DESC',
    async fn({ roomMembers }) {
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'member', joinedAt: 1000 })
      await roomMembers.addMember({ roomId: 'r_2', userId: 'u_1', role: 'member', joinedAt: 2000 })
      await roomMembers.addMember({ roomId: 'r_3', userId: 'u_1', role: 'member', joinedAt: 1500 })

      const roomIds = await roomMembers.listRoomsForUser('u_1')
      assert.deepEqual(roomIds, ['r_2', 'r_3', 'r_1'])
    }
  },
  {
    name: '10. countInRoom returns correct count for specific room',
    async fn({ roomMembers }) {
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'owner' })
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_2', role: 'member' })
      await roomMembers.addMember({ roomId: 'r_2', userId: 'u_1', role: 'member' })

      assert.equal(await roomMembers.countInRoom('r_1'), 2)
      assert.equal(await roomMembers.countInRoom('r_2'), 1)
    }
  },
  {
    name: '11. clearAll deletes every row',
    async fn({ roomMembers }) {
      await roomMembers.addMember({ roomId: 'r_1', userId: 'u_1', role: 'owner' })
      await roomMembers.addMember({ roomId: 'r_2', userId: 'u_2', role: 'owner' })

      const res = await roomMembers.clearAll()
      assert.equal(res.changes, 2)
      assert.equal(await roomMembers.countInRoom('r_1'), 0)
    }
  },
  {
    name: '12. createRepositories returns roomMembers repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.roomMembers)
      assert.equal(typeof repos.roomMembers.listInRoom, 'function')
      assert.equal(typeof repos.roomMembers.get, 'function')
      assert.equal(typeof repos.roomMembers.addMember, 'function')
      assert.equal(typeof repos.roomMembers.removeMember, 'function')
      assert.equal(typeof repos.roomMembers.removeAllInRoom, 'function')
      assert.equal(typeof repos.roomMembers.listRoomsForUser, 'function')
      assert.equal(typeof repos.roomMembers.countInRoom, 'function')
      assert.equal(typeof repos.roomMembers.clearAll, 'function')
    }
  }
]

test('Room Members Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
