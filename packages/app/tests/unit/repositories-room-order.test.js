import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
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
  const roomOrder = createRoomOrderRepository({ db })
  await roomOrder.clearAll()
  return { db, roomOrder }
}

const cases = [
  {
    name: '1. list returns an empty array on a fresh table',
    async fn({ roomOrder }) {
      const res = await roomOrder.list()
      assert.deepEqual(res, [])
    }
  },
  {
    name: '2. setOrder(["r_1", "r_2", "r_3"]) sets positions 0, 1, 2',
    async fn({ roomOrder }) {
      const res = await roomOrder.setOrder(['r_1', 'r_2', 'r_3'])
      assert.equal(res.changes, 3)

      const list = await roomOrder.list()
      assert.deepEqual(list, ['r_1', 'r_2', 'r_3'])
      assert.equal(await roomOrder.getPosition('r_1'), 0)
      assert.equal(await roomOrder.getPosition('r_2'), 1)
      assert.equal(await roomOrder.getPosition('r_3'), 2)
    }
  },
  {
    name: '3. setOrder replaces the previous order',
    async fn({ roomOrder }) {
      await roomOrder.setOrder(['r_1', 'r_2'])
      await roomOrder.setOrder(['r_2', 'r_1'])

      const list = await roomOrder.list()
      assert.deepEqual(list, ['r_2', 'r_1'])
    }
  },
  {
    name: '4. setOrder([]) clears the table',
    async fn({ roomOrder }) {
      await roomOrder.setOrder(['r_1', 'r_2'])
      await roomOrder.setOrder([])

      const list = await roomOrder.list()
      assert.deepEqual(list, [])
    }
  },
  {
    name: '5. setOrder inside a transaction rolls back if an insert fails',
    async fn({ db, roomOrder }) {
      await roomOrder.setOrder(['r_initial_1', 'r_initial_2'])

      const origExecute = db.execute.bind(db)
      let execCount = 0

      db.execute = async (sql, params) => {
        if (sql.includes('INSERT INTO room_order')) {
          execCount += 1
          if (execCount === 3) {
            throw new Error('Simulated insert failure')
          }
        }
        return origExecute(sql, params)
      }

      await assert.rejects(
        async () => {
          await roomOrder.setOrder(['r_1', 'r_2', 'r_3', 'r_4'])
        },
        { message: 'Simulated insert failure' }
      )

      db.execute = origExecute

      const restoredList = await roomOrder.list()
      assert.deepEqual(restoredList, ['r_initial_1', 'r_initial_2'])
    }
  },
  {
    name: '6. moveBefore("r_3", "r_1") on ["r_1", "r_2", "r_3"] yields ["r_3", "r_1", "r_2"]',
    async fn({ roomOrder }) {
      await roomOrder.setOrder(['r_1', 'r_2', 'r_3'])
      const res = await roomOrder.moveBefore('r_3', 'r_1')
      assert.equal(res.changes, 3)

      const list = await roomOrder.list()
      assert.deepEqual(list, ['r_3', 'r_1', 'r_2'])
    }
  },
  {
    name: '7. moveBefore with an unknown room returns { changes: 0 } and leaves order unchanged',
    async fn({ roomOrder }) {
      await roomOrder.setOrder(['r_1', 'r_2'])
      const res = await roomOrder.moveBefore('r_missing', 'r_1')
      assert.equal(res.changes, 0)

      const list = await roomOrder.list()
      assert.deepEqual(list, ['r_1', 'r_2'])
    }
  },
  {
    name: '8. moveBefore with same room id for both arguments leaves order unchanged',
    async fn({ roomOrder }) {
      await roomOrder.setOrder(['r_1', 'r_2', 'r_3'])
      await roomOrder.moveBefore('r_2', 'r_2')

      const list = await roomOrder.list()
      assert.deepEqual(list, ['r_1', 'r_2', 'r_3'])
    }
  },
  {
    name: '9. getPosition("r_2") after setOrder(["r_1", "r_2"]) returns 1',
    async fn({ roomOrder }) {
      await roomOrder.setOrder(['r_1', 'r_2'])
      const pos = await roomOrder.getPosition('r_2')
      assert.equal(pos, 1)
    }
  },
  {
    name: '10. getPosition for an unknown room returns undefined',
    async fn({ roomOrder }) {
      const pos = await roomOrder.getPosition('r_missing')
      assert.equal(pos, undefined)
    }
  },
  {
    name: '11. clearAll deletes every row',
    async fn({ roomOrder }) {
      await roomOrder.setOrder(['r_1', 'r_2'])
      const res = await roomOrder.clearAll()
      assert.equal(res.changes, 2)

      const list = await roomOrder.list()
      assert.deepEqual(list, [])
    }
  },
  {
    name: '12. createRepositories returns roomOrder repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.roomOrder)
      assert.equal(typeof repos.roomOrder.list, 'function')
      assert.equal(typeof repos.roomOrder.setOrder, 'function')
      assert.equal(typeof repos.roomOrder.moveBefore, 'function')
      assert.equal(typeof repos.roomOrder.getPosition, 'function')
      assert.equal(typeof repos.roomOrder.clearAll, 'function')
    }
  }
]

test('Room Order Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
