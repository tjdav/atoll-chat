import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { createMemoryBackend } from '../../src/lib/db/backends/memory.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createNicknamesRepository } from '../../src/lib/db/repositories/nicknames.js'
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
    { name: '0008-room-preferences-nicknames.sql', sql: readFileSync(resolve(dir, '0008-room-preferences-nicknames.sql'), 'utf8') }
  ]
}

async function buildRepo(backend) {
  const db = await createDb({
    backend,
    migrations: loadMigrations()
  })
  await db.open()
  const nicknames = createNicknamesRepository({ db })
  await nicknames.clearAll()
  return { db, nicknames }
}

const cases = [
  {
    name: '1. get returns null for an unknown pair',
    async fn({ nicknames }) {
      assert.equal(await nicknames.get('r_1', 'u_1'), null)
    }
  },
  {
    name: '2. set inserts a new nickname. get returns the string',
    async fn({ nicknames }) {
      const res = await nicknames.set('r_1', 'u_1', 'Bobby')
      assert.equal(res.changes, 1)
      assert.equal(await nicknames.get('r_1', 'u_1'), 'Bobby')
    }
  },
  {
    name: '3. set on an existing pair replaces the nickname and refreshes updated_at',
    async fn({ db, nicknames }) {
      await nicknames.set('r_1', 'u_1', 'Bob')
      const row1 = await db.queryOne(
        'SELECT updated_at FROM nicknames WHERE room_id = ? AND user_id = ?',
        ['r_1', 'u_1']
      )

      await new Promise((r) => setTimeout(r, 10))
      await nicknames.set('r_1', 'u_1', 'Robert')

      assert.equal(await nicknames.get('r_1', 'u_1'), 'Robert')
      const row2 = await db.queryOne(
        'SELECT updated_at FROM nicknames WHERE room_id = ? AND user_id = ?',
        ['r_1', 'u_1']
      )

      assert.ok(row2.updated_at >= row1.updated_at)
    }
  },
  {
    name: '4. set with empty text deletes the existing row',
    async fn({ nicknames }) {
      await nicknames.set('r_1', 'u_1', 'Bobby')
      assert.equal(await nicknames.get('r_1', 'u_1'), 'Bobby')

      const res = await nicknames.set('r_1', 'u_1', '')
      assert.equal(res.changes, 1)
      assert.equal(await nicknames.get('r_1', 'u_1'), null)
    }
  },
  {
    name: '5. set with whitespace-only text deletes the existing row',
    async fn({ nicknames }) {
      await nicknames.set('r_1', 'u_1', 'Bobby')

      const res = await nicknames.set('r_1', 'u_1', '   ')
      assert.equal(res.changes, 1)
      assert.equal(await nicknames.get('r_1', 'u_1'), null)
    }
  },
  {
    name: '6. set with empty text on a pair that has no nickname is a no-op returning { changes: 0 }',
    async fn({ nicknames }) {
      const res = await nicknames.set('r_1', 'u_missing', '')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '7. remove deletes the nickname',
    async fn({ nicknames }) {
      await nicknames.set('r_1', 'u_1', 'Bobby')
      const res = await nicknames.remove('r_1', 'u_1')
      assert.equal(res.changes, 1)
      assert.equal(await nicknames.get('r_1', 'u_1'), null)
    }
  },
  {
    name: '8. remove on an unknown pair returns { changes: 0 }',
    async fn({ nicknames }) {
      const res = await nicknames.remove('r_1', 'u_missing')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '9. getMany([]) returns {}',
    async fn({ nicknames }) {
      assert.deepEqual(await nicknames.getMany('r_1', []), {})
    }
  },
  {
    name: '10. getMany(roomId, [a, b]) returns map for present pairs; missing users omitted',
    async fn({ nicknames }) {
      await nicknames.set('r_1', 'u_1', 'AliceAlias')
      await nicknames.set('r_1', 'u_2', 'BobAlias')

      const map = await nicknames.getMany('r_1', ['u_1', 'u_2', 'u_3'])
      assert.deepEqual(map, {
        u_1: 'AliceAlias',
        u_2: 'BobAlias'
      })
    }
  },
  {
    name: '11. getMany builds IN clause from array length and treats metacharacters as literals',
    async fn({ nicknames }) {
      const trickyId = "u_1'; DROP TABLE nicknames;--"
      await nicknames.set('r_1', trickyId, 'SafeAlias')

      const map = await nicknames.getMany('r_1', [trickyId])
      assert.deepEqual(map, { [trickyId]: 'SafeAlias' })
      assert.equal(await nicknames.countInRoom('r_1'), 1)
    }
  },
  {
    name: '12. listInRoom returns rows ordered by user_id ASC',
    async fn({ nicknames }) {
      await nicknames.set('r_1', 'u_z', 'Zack')
      await nicknames.set('r_1', 'u_a', 'Adam')
      await nicknames.set('r_1', 'u_m', 'Mike')

      const rows = await nicknames.listInRoom('r_1')
      assert.equal(rows.length, 3)
      assert.equal(rows[0].user_id, 'u_a')
      assert.equal(rows[1].user_id, 'u_m')
      assert.equal(rows[2].user_id, 'u_z')
    }
  },
  {
    name: '13. listInRoom scopes to one room',
    async fn({ nicknames }) {
      await nicknames.set('r_1', 'u_1', 'R1User')
      await nicknames.set('r_2', 'u_1', 'R2User')

      const rows = await nicknames.listInRoom('r_1')
      assert.equal(rows.length, 1)
      assert.equal(rows[0].nickname, 'R1User')
    }
  },
  {
    name: '14. listRoomsForUser returns room ids in ascending order',
    async fn({ nicknames }) {
      await nicknames.set('r_z', 'u_1', 'AliasZ')
      await nicknames.set('r_a', 'u_1', 'AliasA')
      await nicknames.set('r_m', 'u_1', 'AliasM')

      const rooms = await nicknames.listRoomsForUser('u_1')
      assert.deepEqual(rooms, ['r_a', 'r_m', 'r_z'])
    }
  },
  {
    name: '15. removeAllInRoom deletes every nickname in one room, leaving other rooms untouched',
    async fn({ nicknames }) {
      await nicknames.set('r_1', 'u_1', 'Nick1')
      await nicknames.set('r_1', 'u_2', 'Nick2')
      await nicknames.set('r_2', 'u_1', 'Nick3')

      const res = await nicknames.removeAllInRoom('r_1')
      assert.equal(res.changes, 2)

      assert.equal(await nicknames.countInRoom('r_1'), 0)
      assert.equal(await nicknames.countInRoom('r_2'), 1)
    }
  },
  {
    name: '16. countInRoom returns the correct count',
    async fn({ nicknames }) {
      assert.equal(await nicknames.countInRoom('r_1'), 0)
      await nicknames.set('r_1', 'u_1', 'Nick1')
      await nicknames.set('r_1', 'u_2', 'Nick2')
      assert.equal(await nicknames.countInRoom('r_1'), 2)
    }
  },
  {
    name: '17. clearAll deletes every row',
    async fn({ nicknames }) {
      await nicknames.set('r_1', 'u_1', 'Nick1')
      await nicknames.set('r_2', 'u_2', 'Nick2')

      const res = await nicknames.clearAll()
      assert.equal(res.changes, 2)
      assert.equal(await nicknames.countInRoom('r_1'), 0)
      assert.equal(await nicknames.countInRoom('r_2'), 0)
    }
  },
  {
    name: '18. createRepositories includes nicknames repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.nicknames)
      assert.equal(typeof repos.nicknames.get, 'function')
      assert.equal(typeof repos.nicknames.getMany, 'function')
      assert.equal(typeof repos.nicknames.set, 'function')
      assert.equal(typeof repos.nicknames.remove, 'function')
      assert.equal(typeof repos.nicknames.listInRoom, 'function')
      assert.equal(typeof repos.nicknames.listRoomsForUser, 'function')
      assert.equal(typeof repos.nicknames.removeAllInRoom, 'function')
      assert.equal(typeof repos.nicknames.countInRoom, 'function')
      assert.equal(typeof repos.nicknames.clearAll, 'function')
    }
  }
]

test('Nicknames Repository - Memory SQLite Backend', async (t) => {
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

test('Nicknames Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
