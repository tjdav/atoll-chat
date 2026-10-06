import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createBlockedUsersRepository } from '../../src/lib/db/repositories/blocked-users.js'
import { createRepositories } from '../../src/lib/db/repositories/index.js'

function loadMigrations() {
  const dir = resolve(import.meta.dirname, '../../src/db/migrations')
  return [
    { name: '0001-meta.sql', sql: readFileSync(resolve(dir, '0001-meta.sql'), 'utf8') },
    { name: '0002-users.sql', sql: readFileSync(resolve(dir, '0002-users.sql'), 'utf8') },
    { name: '0003-rooms.sql', sql: readFileSync(resolve(dir, '0003-rooms.sql'), 'utf8') },
    { name: '0004-messages.sql', sql: readFileSync(resolve(dir, '0004-messages.sql'), 'utf8') },
    { name: '0005-attachments-reactions.sql', sql: readFileSync(resolve(dir, '0005-attachments-reactions.sql'), 'utf8') },
    { name: '0006-user-state.sql', sql: readFileSync(resolve(dir, '0006-user-state.sql'), 'utf8') }
  ]
}

async function buildRepo(backend) {
  const db = await createDb({
    backend,
    migrations: loadMigrations()
  })
  await db.open()
  const blockedUsers = createBlockedUsersRepository({ db })
  await blockedUsers.clearAll()
  return { db, blockedUsers }
}

const cases = [
  {
    name: '1. isBlocked returns false for an unknown user',
    async fn({ blockedUsers }) {
      assert.equal(await blockedUsers.isBlocked('u_missing'), false)
    }
  },
  {
    name: '2. add inserts a block and isBlocked returns true',
    async fn({ blockedUsers }) {
      const res = await blockedUsers.add('u_1')
      assert.equal(res.changes, 1)

      assert.equal(await blockedUsers.isBlocked('u_1'), true)
    }
  },
  {
    name: '3. add on an already-blocked user refreshes blocked_at',
    async fn({ blockedUsers }) {
      await blockedUsers.add('u_1')
      const first = (await blockedUsers.list())[0]

      await new Promise((r) => setTimeout(r, 10))
      await blockedUsers.add('u_1')
      const second = (await blockedUsers.list())[0]

      assert.equal(second.user_id, 'u_1')
      assert.ok(second.blocked_at >= first.blocked_at)
    }
  },
  {
    name: '4. remove unblocks user',
    async fn({ blockedUsers }) {
      await blockedUsers.add('u_1')
      const res = await blockedUsers.remove('u_1')
      assert.equal(res.changes, 1)

      assert.equal(await blockedUsers.isBlocked('u_1'), false)
    }
  },
  {
    name: '5. remove on an unknown user returns { changes: 0 }',
    async fn({ blockedUsers }) {
      const res = await blockedUsers.remove('u_missing')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '6. list returns rows ordered by blocked_at DESC',
    async fn({ blockedUsers }) {
      await blockedUsers.add('u_1')
      await new Promise((r) => setTimeout(r, 10))
      await blockedUsers.add('u_2')

      const list = await blockedUsers.list()
      assert.equal(list.length, 2)
      assert.equal(list[0].user_id, 'u_2')
      assert.equal(list[1].user_id, 'u_1')
    }
  },
  {
    name: '7. count returns the number of blocks',
    async fn({ blockedUsers }) {
      assert.equal(await blockedUsers.count(), 0)

      await blockedUsers.add('u_1')
      await blockedUsers.add('u_2')

      assert.equal(await blockedUsers.count(), 2)
    }
  },
  {
    name: '8. clearAll deletes every row',
    async fn({ blockedUsers }) {
      await blockedUsers.add('u_1')
      await blockedUsers.add('u_2')

      const res = await blockedUsers.clearAll()
      assert.equal(res.changes, 2)
      assert.equal(await blockedUsers.count(), 0)
    }
  },
  {
    name: '9. createRepositories includes blockedUsers repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.blockedUsers)
      assert.equal(typeof repos.blockedUsers.isBlocked, 'function')
      assert.equal(typeof repos.blockedUsers.list, 'function')
      assert.equal(typeof repos.blockedUsers.add, 'function')
      assert.equal(typeof repos.blockedUsers.remove, 'function')
      assert.equal(typeof repos.blockedUsers.count, 'function')
      assert.equal(typeof repos.blockedUsers.clearAll, 'function')
    }
  }
]

test('Blocked Users Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
