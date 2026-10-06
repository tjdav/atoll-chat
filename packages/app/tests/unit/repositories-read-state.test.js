import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createReadStateRepository } from '../../src/lib/db/repositories/read-state.js'
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
  const readState = createReadStateRepository({ db })
  await readState.clearAll()
  return { db, readState }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown pair',
    async fn({ readState }) {
      const res = await readState.get('u_missing', 'r_missing')
      assert.equal(res, undefined)

      const resForRoom = await readState.getForRoom('r_missing', 'u_missing')
      assert.equal(resForRoom, undefined)
    }
  },
  {
    name: '2. upsert inserts a new row and get reflects values',
    async fn({ readState }) {
      const res = await readState.upsert({
        userId: 'u_1',
        roomId: 'r_1',
        lastReadMessageId: 'm_100',
        lastReadAt: 1234567800
      })
      assert.equal(res.changes, 1)

      const row = await readState.get('u_1', 'r_1')
      assert.ok(row)
      assert.equal(row.user_id, 'u_1')
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.last_read_message_id, 'm_100')
      assert.equal(row.last_read_at, 1234567800)
      assert.equal(row.marked_unread, 0)
      assert.equal(typeof row.updated_at, 'number')

      const rowForRoom = await readState.getForRoom('r_1', 'u_1')
      assert.deepEqual(rowForRoom, row)
    }
  },
  {
    name: '3. upsert on existing row updates read position without touching marked_unread',
    async fn({ readState }) {
      await readState.upsert({ userId: 'u_1', roomId: 'r_1', lastReadMessageId: 'm_1', lastReadAt: 1000 })
      await readState.setMarkedUnread('u_1', 'r_1', true)

      const before = await readState.get('u_1', 'r_1')
      assert.equal(before.marked_unread, 1)

      await readState.upsert({ userId: 'u_1', roomId: 'r_1', lastReadMessageId: 'm_2', lastReadAt: 2000 })

      const after = await readState.get('u_1', 'r_1')
      assert.equal(after.last_read_message_id, 'm_2')
      assert.equal(after.last_read_at, 2000)
      assert.equal(after.marked_unread, 1)
    }
  },
  {
    name: '4. upsert refreshes updated_at',
    async fn({ readState }) {
      await readState.upsert({ userId: 'u_1', roomId: 'r_1', lastReadMessageId: 'm_1', lastReadAt: 1000 })
      const first = await readState.get('u_1', 'r_1')

      await new Promise((r) => setTimeout(r, 10))
      await readState.upsert({ userId: 'u_1', roomId: 'r_1', lastReadMessageId: 'm_2', lastReadAt: 2000 })
      const second = await readState.get('u_1', 'r_1')

      assert.ok(second.updated_at >= first.updated_at)
    }
  },
  {
    name: '5. upsert with omitted/null parameters preserves existing values',
    async fn({ readState }) {
      await readState.upsert({ userId: 'u_1', roomId: 'r_1', lastReadMessageId: 'm_1', lastReadAt: 1000 })
      await readState.upsert({ userId: 'u_1', roomId: 'r_1' })

      const row = await readState.get('u_1', 'r_1')
      assert.equal(row.last_read_message_id, 'm_1')
      assert.equal(row.last_read_at, 1000)
    }
  },
  {
    name: '6. setMarkedUnread(u, r, true) on existing row sets marked_unread = 1',
    async fn({ readState }) {
      await readState.upsert({ userId: 'u_1', roomId: 'r_1', lastReadMessageId: 'm_1' })
      const res = await readState.setMarkedUnread('u_1', 'r_1', true)
      assert.equal(res.changes, 1)

      const row = await readState.get('u_1', 'r_1')
      assert.equal(row.marked_unread, 1)
    }
  },
  {
    name: '7. setMarkedUnread(u, r, false) resets marked_unread = 0',
    async fn({ readState }) {
      await readState.upsert({ userId: 'u_1', roomId: 'r_1', lastReadMessageId: 'm_1' })
      await readState.setMarkedUnread('u_1', 'r_1', true)
      await readState.setMarkedUnread('u_1', 'r_1', false)

      const row = await readState.get('u_1', 'r_1')
      assert.equal(row.marked_unread, 0)
    }
  },
  {
    name: '8. setMarkedUnread on a non-existent row inserts a minimal row',
    async fn({ readState }) {
      const res = await readState.setMarkedUnread('u_new', 'r_new', true)
      assert.equal(res.changes, 1)

      const row = await readState.get('u_new', 'r_new')
      assert.ok(row)
      assert.equal(row.marked_unread, 1)
      assert.equal(row.last_read_message_id, null)
      assert.equal(row.last_read_at, null)
    }
  },
  {
    name: '9. clearMarkedUnread is equivalent to setMarkedUnread(u, r, false)',
    async fn({ readState }) {
      await readState.setMarkedUnread('u_1', 'r_1', true)
      await readState.clearMarkedUnread('u_1', 'r_1')

      const row = await readState.get('u_1', 'r_1')
      assert.equal(row.marked_unread, 0)
    }
  },
  {
    name: '10. listForUser returns rows ordered by updated_at DESC',
    async fn({ readState }) {
      await readState.upsert({ userId: 'u_1', roomId: 'r_1', lastReadMessageId: 'm_1' })
      await new Promise((r) => setTimeout(r, 10))
      await readState.upsert({ userId: 'u_1', roomId: 'r_2', lastReadMessageId: 'm_2' })

      const rows = await readState.listForUser('u_1')
      assert.equal(rows.length, 2)
      assert.equal(rows[0].room_id, 'r_2')
      assert.equal(rows[1].room_id, 'r_1')
    }
  },
  {
    name: '11. listForUser excludes rows for other users',
    async fn({ readState }) {
      await readState.upsert({ userId: 'u_1', roomId: 'r_1' })
      await readState.upsert({ userId: 'u_2', roomId: 'r_1' })

      const rows = await readState.listForUser('u_1')
      assert.equal(rows.length, 1)
      assert.equal(rows[0].user_id, 'u_1')
    }
  },
  {
    name: '12. remove deletes the row',
    async fn({ readState }) {
      await readState.upsert({ userId: 'u_1', roomId: 'r_1' })
      const res = await readState.remove('u_1', 'r_1')
      assert.equal(res.changes, 1)

      const row = await readState.get('u_1', 'r_1')
      assert.equal(row, undefined)
    }
  },
  {
    name: '13. remove on an unknown pair returns { changes: 0 }',
    async fn({ readState }) {
      const res = await readState.remove('u_missing', 'r_missing')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '14. clearAll/removeAll deletes every row',
    async fn({ readState }) {
      await readState.upsert({ userId: 'u_1', roomId: 'r_1' })
      await readState.upsert({ userId: 'u_2', roomId: 'r_2' })

      const res = await readState.clearAll()
      assert.equal(res.changes, 2)

      const rows = await readState.listForUser('u_1')
      assert.equal(rows.length, 0)
    }
  },
  {
    name: '15. createRepositories includes readState repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.readState)
      assert.equal(typeof repos.readState.get, 'function')
      assert.equal(typeof repos.readState.getForRoom, 'function')
      assert.equal(typeof repos.readState.upsert, 'function')
      assert.equal(typeof repos.readState.setMarkedUnread, 'function')
      assert.equal(typeof repos.readState.clearMarkedUnread, 'function')
      assert.equal(typeof repos.readState.listForUser, 'function')
      assert.equal(typeof repos.readState.remove, 'function')
      assert.equal(typeof repos.readState.removeAll, 'function')
      assert.equal(typeof repos.readState.clearAll, 'function')
    }
  }
]

test('Read State Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
