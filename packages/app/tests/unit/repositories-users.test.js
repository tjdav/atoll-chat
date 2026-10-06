import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { createMemoryBackend } from '../../src/lib/db/backends/memory.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createUsersRepository } from '../../src/lib/db/repositories/users.js'
import { createRepositories } from '../../src/lib/db/repositories/index.js'

function loadMigrations() {
  const dir = resolve(import.meta.dirname, '../../src/db/migrations')
  return [
    { name: '0001-meta.sql', sql: readFileSync(resolve(dir, '0001-meta.sql'), 'utf8') },
    { name: '0002-users.sql', sql: readFileSync(resolve(dir, '0002-users.sql'), 'utf8') }
  ]
}

async function buildRepo(backend) {
  const db = await createDb({
    backend,
    migrations: loadMigrations()
  })
  await db.open()
  const users = createUsersRepository({ db })
  await users.clearAll()
  return { db, users }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown user',
    async fn(users) {
      const res = await users.get('u_missing')
      assert.equal(res, undefined)
    }
  },
  {
    name: '2. upsert inserts a new user',
    async fn(users) {
      const res = await users.upsert({ userId: 'u_a', displayName: 'Alice' })
      assert.equal(res.changes, 1)

      const row = await users.get('u_a')
      assert.equal(row.user_id, 'u_a')
      assert.equal(row.display_name, 'Alice')
      assert.equal(row.identity_pubkey, null)
      assert.equal(row.profile_version, 1)
      assert.equal(typeof row.cached_at, 'number')
    }
  },
  {
    name: '3. upsert on an existing user updates the display name without clearing the identity key',
    async fn(users) {
      await users.upsert({ userId: 'u_a', displayName: 'Alice', identityPubkey: 'key1' })
      await users.upsert({ userId: 'u_a', displayName: 'Alice Smith' })

      const row = await users.get('u_a')
      assert.equal(row.display_name, 'Alice Smith')
      assert.equal(row.identity_pubkey, 'key1')
    }
  },
  {
    name: '4. upsert on an existing user updates the identity key without clearing the display name',
    async fn(users) {
      await users.upsert({ userId: 'u_a', displayName: 'Alice' })
      await users.upsert({ userId: 'u_a', identityPubkey: 'key2' })

      const row = await users.get('u_a')
      assert.equal(row.display_name, 'Alice')
      assert.equal(row.identity_pubkey, 'key2')
    }
  },
  {
    name: '5. upsert bumps profile_version',
    async fn(users) {
      await users.upsert({ userId: 'u_a', displayName: 'Alice', profileVersion: 2 })
      let row = await users.get('u_a')
      assert.equal(row.profile_version, 2)

      await users.upsert({ userId: 'u_a', displayName: 'Alice', profileVersion: 3 })
      row = await users.get('u_a')
      assert.equal(row.profile_version, 3)
    }
  },
  {
    name: '6. upsert refreshes cached_at',
    async fn(users) {
      await users.upsert({ userId: 'u_a', displayName: 'Alice' })
      const row1 = await users.get('u_a')
      const t1 = row1.cached_at

      await new Promise((r) => setTimeout(r, 5))

      await users.upsert({ userId: 'u_a', displayName: 'Alice' })
      const row2 = await users.get('u_a')
      const t2 = row2.cached_at

      assert.ok(t2 > t1, `expected ${t2} > ${t1}`)
    }
  },
  {
    name: '7. remove deletes and get returns undefined',
    async fn(users) {
      await users.upsert({ userId: 'u_a', displayName: 'Alice' })
      const delRes = await users.remove('u_a')
      assert.equal(delRes.changes, 1)

      const row = await users.get('u_a')
      assert.equal(row, undefined)
    }
  },
  {
    name: '8. remove on an unknown user returns { changes: 0 }',
    async fn(users) {
      const res = await users.remove('u_missing')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '9. list returns users ordered by cached_at DESC',
    async fn(users) {
      await users.upsert({ userId: 'u_1', displayName: 'User 1' })
      await new Promise((r) => setTimeout(r, 5))
      await users.upsert({ userId: 'u_2', displayName: 'User 2' })
      await new Promise((r) => setTimeout(r, 5))
      await users.upsert({ userId: 'u_3', displayName: 'User 3' })

      const rows = await users.list()
      assert.equal(rows.length, 3)
      assert.equal(rows[0].user_id, 'u_3')
      assert.equal(rows[1].user_id, 'u_2')
      assert.equal(rows[2].user_id, 'u_1')
    }
  },
  {
    name: '10. list respects limit',
    async fn(users) {
      for (let i = 1; i <= 5; i++) {
        await users.upsert({ userId: `u_${i}`, displayName: `User ${i}` })
      }
      const rows = await users.list({ limit: 2 })
      assert.equal(rows.length, 2)
    }
  },
  {
    name: '11. list supports cursor pagination',
    async fn(users) {
      for (let i = 1; i <= 5; i++) {
        await users.upsert({ userId: `u_${i}`, displayName: `User ${i}` })
        await new Promise((r) => setTimeout(r, 5))
      }

      const page1 = await users.list({ limit: 2 })
      assert.equal(page1.length, 2)
      assert.equal(page1[0].user_id, 'u_5')
      assert.equal(page1[1].user_id, 'u_4')

      const cursor = page1[1].cached_at
      const page2 = await users.list({ limit: 2, cursor })
      assert.equal(page2.length, 2)
      assert.equal(page2[0].user_id, 'u_3')
      assert.equal(page2[1].user_id, 'u_2')
    }
  },
  {
    name: '12. count returns total',
    async fn(users) {
      assert.equal(await users.count(), 0)
      await users.upsert({ userId: 'u_1' })
      await users.upsert({ userId: 'u_2' })
      await users.upsert({ userId: 'u_3' })
      assert.equal(await users.count(), 3)
    }
  },
  {
    name: '13. clearAll deletes every row',
    async fn(users) {
      await users.upsert({ userId: 'u_1' })
      await users.upsert({ userId: 'u_2' })
      await users.upsert({ userId: 'u_3' })

      const res = await users.clearAll()
      assert.equal(res.changes, 3)
      assert.equal(await users.count(), 0)
    }
  },
  {
    name: '14. createRepositories returns the users repository',
    async fn(users, db) {
      const repos = createRepositories({ db })
      assert.ok(repos.users)
      assert.equal(typeof repos.users.get, 'function')
      assert.equal(typeof repos.users.upsert, 'function')
      assert.equal(typeof repos.users.remove, 'function')
      assert.equal(typeof repos.users.list, 'function')
      assert.equal(typeof repos.users.count, 'function')
      assert.equal(typeof repos.users.clearAll, 'function')
    }
  },
  {
    name: '15. upsert when displayName is explicitly null does not overwrite',
    async fn(users) {
      await users.upsert({ userId: 'u_a', displayName: 'Alice' })
      await users.upsert({ userId: 'u_a', displayName: null })

      const row = await users.get('u_a')
      assert.equal(row.display_name, 'Alice')
    }
  }
]

test('Users Repository - Memory Backend', async (t) => {
  for (const c of cases) {
    await t.test(c.name, async () => {
      const { db, users } = await buildRepo(createMemoryBackend())
      await c.fn(users, db)
    })
  }
})

test('Users Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const { db, users } = await buildRepo(wasmBackend)
      await c.fn(users, db)
    })
  }
})
