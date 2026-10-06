import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createDraftsRepository } from '../../src/lib/db/repositories/drafts.js'
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
  const drafts = createDraftsRepository({ db })
  await drafts.clearAll()
  return { db, drafts }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown room',
    async fn({ drafts }) {
      const res = await drafts.get('r_missing')
      assert.equal(res, undefined)
    }
  },
  {
    name: '2. set(roomId, "hello") inserts a new draft',
    async fn({ drafts }) {
      const res = await drafts.set('r_1', 'hello world')
      assert.equal(res.changes, 1)

      const row = await drafts.get('r_1')
      assert.ok(row)
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.text, 'hello world')
      assert.equal(typeof row.updated_at, 'number')
    }
  },
  {
    name: '3. set on an existing room replaces text and refreshes updated_at',
    async fn({ drafts }) {
      await drafts.set('r_1', 'first draft')
      const first = await drafts.get('r_1')

      await new Promise((r) => setTimeout(r, 10))
      await drafts.set('r_1', 'updated draft')
      const second = await drafts.get('r_1')

      assert.equal(second.text, 'updated draft')
      assert.ok(second.updated_at >= first.updated_at)
    }
  },
  {
    name: '4. set(roomId, "") deletes the existing row',
    async fn({ drafts }) {
      await drafts.set('r_1', 'some draft')
      const res = await drafts.set('r_1', '')
      assert.equal(res.changes, 1)

      const row = await drafts.get('r_1')
      assert.equal(row, undefined)
    }
  },
  {
    name: '5. set(roomId, "   ") (whitespace only) deletes the row',
    async fn({ drafts }) {
      await drafts.set('r_1', 'some draft')
      const res = await drafts.set('r_1', '   \n\t  ')
      assert.equal(res.changes, 1)

      const row = await drafts.get('r_1')
      assert.equal(row, undefined)
    }
  },
  {
    name: '6. set on a room with no existing draft and empty text is a no-op returning { changes: 0 }',
    async fn({ drafts }) {
      const res = await drafts.set('r_missing', '')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '7. getText returns text string or null',
    async fn({ drafts }) {
      assert.equal(await drafts.getText('r_1'), null)

      await drafts.set('r_1', 'sample text')
      assert.equal(await drafts.getText('r_1'), 'sample text')
    }
  },
  {
    name: '8. remove deletes the row',
    async fn({ drafts }) {
      await drafts.set('r_1', 'draft text')
      const res = await drafts.remove('r_1')
      assert.equal(res.changes, 1)

      assert.equal(await drafts.get('r_1'), undefined)
    }
  },
  {
    name: '9. list returns rows ordered by updated_at DESC',
    async fn({ drafts }) {
      await drafts.set('r_1', 'draft 1')
      await new Promise((r) => setTimeout(r, 10))
      await drafts.set('r_2', 'draft 2')

      const list = await drafts.list()
      assert.equal(list.length, 2)
      assert.equal(list[0].room_id, 'r_2')
      assert.equal(list[1].room_id, 'r_1')
    }
  },
  {
    name: '10. count returns the number of drafts',
    async fn({ drafts }) {
      assert.equal(await drafts.count(), 0)

      await drafts.set('r_1', 'draft 1')
      await drafts.set('r_2', 'draft 2')

      assert.equal(await drafts.count(), 2)
    }
  },
  {
    name: '11. clearAll deletes every row',
    async fn({ drafts }) {
      await drafts.set('r_1', 'draft 1')
      await drafts.set('r_2', 'draft 2')

      const res = await drafts.clearAll()
      assert.equal(res.changes, 2)
      assert.equal(await drafts.count(), 0)
    }
  },
  {
    name: '12. createRepositories includes drafts repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.drafts)
      assert.equal(typeof repos.drafts.get, 'function')
      assert.equal(typeof repos.drafts.getText, 'function')
      assert.equal(typeof repos.drafts.set, 'function')
      assert.equal(typeof repos.drafts.remove, 'function')
      assert.equal(typeof repos.drafts.list, 'function')
      assert.equal(typeof repos.drafts.count, 'function')
      assert.equal(typeof repos.drafts.clearAll, 'function')
    }
  }
]

test('Drafts Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
