import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { createMemoryBackend } from '../../src/lib/db/backends/memory.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createStarredItemsRepository } from '../../src/lib/db/repositories/starred-items.js'
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
  const starredItems = createStarredItemsRepository({ db })
  await starredItems.clearAll()
  return { db, starredItems }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown triple',
    async fn({ starredItems }) {
      assert.equal(await starredItems.get('u_1', 'item_1', 'message'), undefined)
    }
  },
  {
    name: '2. isStarred returns false for an unknown triple',
    async fn({ starredItems }) {
      assert.equal(await starredItems.isStarred('u_1', 'item_1', 'message'), false)
    }
  },
  {
    name: '3. applyRemote inserts a new row. isStarred returns true',
    async fn({ starredItems }) {
      const res = await starredItems.applyRemote({
        userId: 'u_1',
        itemId: 'item_1',
        itemType: 'message',
        roomId: 'r_1',
        userSeq: 10,
        starredAt: 1000
      })
      assert.equal(res.changes, 1)
      assert.equal(await starredItems.isStarred('u_1', 'item_1', 'message'), true)

      const row = await starredItems.get('u_1', 'item_1', 'message')
      assert.ok(row)
      assert.equal(row.user_id, 'u_1')
      assert.equal(row.item_id, 'item_1')
      assert.equal(row.item_type, 'message')
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.user_seq, 10)
      assert.equal(row.starred_at, 1000)
      assert.equal(row.deleted_at, null)
    }
  },
  {
    name: '4. applyRemote with a lower user_seq is a no-op',
    async fn({ starredItems }) {
      await starredItems.applyRemote({
        userId: 'u_1',
        itemId: 'item_1',
        itemType: 'message',
        roomId: 'r_1',
        userSeq: 20,
        starredAt: 2000
      })

      const res = await starredItems.applyRemote({
        userId: 'u_1',
        itemId: 'item_1',
        itemType: 'message',
        roomId: 'r_1',
        userSeq: 5,
        starredAt: 500
      })
      assert.equal(res.changes, 0)

      const row = await starredItems.get('u_1', 'item_1', 'message')
      assert.equal(row.user_seq, 20)
    }
  },
  {
    name: '5. applyRemote with a tombstone (deletedAt set) makes isStarred return false',
    async fn({ starredItems }) {
      await starredItems.applyRemote({
        userId: 'u_1',
        itemId: 'item_1',
        itemType: 'message',
        roomId: 'r_1',
        userSeq: 10,
        starredAt: 1000
      })

      const now = Date.now()
      const res = await starredItems.applyRemote({
        userId: 'u_1',
        itemId: 'item_1',
        itemType: 'message',
        roomId: 'r_1',
        userSeq: 11,
        starredAt: 1000,
        deletedAt: now
      })
      assert.equal(res.changes, 1)

      assert.equal(await starredItems.isStarred('u_1', 'item_1', 'message'), false)
      const row = await starredItems.get('u_1', 'item_1', 'message')
      assert.equal(row.deleted_at, now)
      assert.equal(row.user_seq, 11)
    }
  },
  {
    name: '6. listForUser returns only non-tombstoned rows ordered by starred_at DESC',
    async fn({ starredItems }) {
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_1', itemType: 'message', roomId: 'r_1', userSeq: 1, starredAt: 1000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_2', itemType: 'message', roomId: 'r_1', userSeq: 2, starredAt: 3000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_3', itemType: 'attachment', roomId: 'r_1', userSeq: 3, starredAt: 2000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_4', itemType: 'link', roomId: 'r_1', userSeq: 4, starredAt: 4000, deletedAt: Date.now() })

      const rows = await starredItems.listForUser('u_1')
      assert.equal(rows.length, 3)
      assert.equal(rows[0].item_id, 'i_2')
      assert.equal(rows[1].item_id, 'i_3')
      assert.equal(rows[2].item_id, 'i_1')
    }
  },
  {
    name: '7. listForUser with { type: "attachment" } filters by type',
    async fn({ starredItems }) {
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_1', itemType: 'message', roomId: 'r_1', userSeq: 1, starredAt: 1000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_2', itemType: 'attachment', roomId: 'r_1', userSeq: 2, starredAt: 2000 })

      const rows = await starredItems.listForUser('u_1', { type: 'attachment' })
      assert.equal(rows.length, 1)
      assert.equal(rows[0].item_id, 'i_2')
    }
  },
  {
    name: '8. listForUser with { roomId } filters by room',
    async fn({ starredItems }) {
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_1', itemType: 'message', roomId: 'r_1', userSeq: 1, starredAt: 1000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_2', itemType: 'message', roomId: 'r_2', userSeq: 2, starredAt: 2000 })

      const rows = await starredItems.listForUser('u_1', { roomId: 'r_2' })
      assert.equal(rows.length, 1)
      assert.equal(rows[0].item_id, 'i_2')
    }
  },
  {
    name: '9. listForUser with { limit: 2 } returns two rows',
    async fn({ starredItems }) {
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_1', itemType: 'message', roomId: 'r_1', userSeq: 1, starredAt: 1000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_2', itemType: 'message', roomId: 'r_1', userSeq: 2, starredAt: 2000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_3', itemType: 'message', roomId: 'r_1', userSeq: 3, starredAt: 3000 })

      const rows = await starredItems.listForUser('u_1', { limit: 2 })
      assert.equal(rows.length, 2)
      assert.equal(rows[0].item_id, 'i_3')
      assert.equal(rows[1].item_id, 'i_2')
    }
  },
  {
    name: '10. listForUser with a cursor paginates correctly',
    async fn({ starredItems }) {
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_1', itemType: 'message', roomId: 'r_1', userSeq: 1, starredAt: 1000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_2', itemType: 'message', roomId: 'r_1', userSeq: 2, starredAt: 2000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_3', itemType: 'message', roomId: 'r_1', userSeq: 3, starredAt: 3000 })

      const page1 = await starredItems.listForUser('u_1', { limit: 2 })
      assert.equal(page1.length, 2)
      const last = page1[page1.length - 1]

      const page2 = await starredItems.listForUser('u_1', {
        cursor: { starredAt: last.starred_at, itemId: last.item_id },
        limit: 2
      })
      assert.equal(page2.length, 1)
      assert.equal(page2[0].item_id, 'i_1')
    }
  },
  {
    name: '11. listForRoom returns all non-tombstoned stars for a room',
    async fn({ starredItems }) {
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_1', itemType: 'message', roomId: 'r_target', userSeq: 1, starredAt: 1000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_2', itemType: 'attachment', roomId: 'r_target', userSeq: 2, starredAt: 2000 })
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_3', itemType: 'link', roomId: 'r_other', userSeq: 3, starredAt: 3000 })

      const roomStars = await starredItems.listForRoom('u_1', 'r_target')
      assert.equal(roomStars.length, 2)
      assert.equal(roomStars[0].item_id, 'i_2')
      assert.equal(roomStars[1].item_id, 'i_1')
    }
  },
  {
    name: '12. applyAddedEvent inserts a new row with local starred_at and deleted_at = null',
    async fn({ starredItems }) {
      const res = await starredItems.applyAddedEvent({
        userId: 'u_1',
        itemId: 'i_event',
        itemType: 'message',
        roomId: 'r_1',
        userSeq: 100
      })
      assert.equal(res.changes, 1)

      const row = await starredItems.get('u_1', 'i_event', 'message')
      assert.ok(row)
      assert.equal(row.user_seq, 100)
      assert.equal(typeof row.starred_at, 'number')
      assert.equal(row.deleted_at, null)
    }
  },
  {
    name: '13. applyAddedEvent with a stale user_seq is a no-op',
    async fn({ starredItems }) {
      await starredItems.applyAddedEvent({
        userId: 'u_1',
        itemId: 'i_event',
        itemType: 'message',
        roomId: 'r_1',
        userSeq: 100
      })

      const res = await starredItems.applyAddedEvent({
        userId: 'u_1',
        itemId: 'i_event',
        itemType: 'message',
        roomId: 'r_1',
        userSeq: 50
      })
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '14. applyRemovedEvent on a known row sets deleted_at and bumps user_seq',
    async fn({ starredItems }) {
      await starredItems.applyAddedEvent({
        userId: 'u_1',
        itemId: 'i_remove_me',
        itemType: 'message',
        roomId: 'r_1',
        userSeq: 100
      })

      const res = await starredItems.applyRemovedEvent({
        userId: 'u_1',
        itemId: 'i_remove_me',
        itemType: 'message',
        userSeq: 101
      })
      assert.equal(res.changes, 1)

      const row = await starredItems.get('u_1', 'i_remove_me', 'message')
      assert.equal(row.user_seq, 101)
      assert.equal(typeof row.deleted_at, 'number')
      assert.equal(await starredItems.isStarred('u_1', 'i_remove_me', 'message'), false)
    }
  },
  {
    name: '15. applyRemovedEvent on an unknown triple is a no-op (changes: 0)',
    async fn({ starredItems }) {
      const res = await starredItems.applyRemovedEvent({
        userId: 'u_1',
        itemId: 'i_ghost',
        itemType: 'message',
        userSeq: 100
      })
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '16. applyRemovedEvent with a stale user_seq is a no-op',
    async fn({ starredItems }) {
      await starredItems.applyAddedEvent({
        userId: 'u_1',
        itemId: 'i_item',
        itemType: 'message',
        roomId: 'r_1',
        userSeq: 200
      })

      const res = await starredItems.applyRemovedEvent({
        userId: 'u_1',
        itemId: 'i_item',
        itemType: 'message',
        userSeq: 150
      })
      assert.equal(res.changes, 0)

      assert.equal(await starredItems.isStarred('u_1', 'i_item', 'message'), true)
    }
  },
  {
    name: '17. applyBatch applies multiple rows in order in a single transaction',
    async fn({ starredItems }) {
      const rows = [
        { itemId: 'i_3', itemType: 'message', roomId: 'r_1', userSeq: 30, starredAt: 3000 },
        { itemId: 'i_1', itemType: 'message', roomId: 'r_1', userSeq: 10, starredAt: 1000 },
        { itemId: 'i_2', itemType: 'message', roomId: 'r_1', userSeq: 20, starredAt: 2000 }
      ]

      const res = await starredItems.applyBatch('u_1', rows)
      assert.deepEqual(res, { applied: 3, skipped: 0 })

      const list = await starredItems.listForUser('u_1')
      assert.equal(list.length, 3)
      assert.equal(list[0].item_id, 'i_3')
    }
  },
  {
    name: '18. applyBatch rolls back on failure',
    async fn({ db, starredItems }) {
      await starredItems.applyRemote({ userId: 'u_1', itemId: 'i_pre', itemType: 'message', roomId: 'r_1', userSeq: 5, starredAt: 500 })

      const invalidRows = [
        { itemId: 'i_valid', itemType: 'message', roomId: 'r_1', userSeq: 10, starredAt: 1000 },
        { itemId: 'i_bad', itemType: null, roomId: 'r_1', userSeq: 20, starredAt: 2000 }
      ]

      await assert.rejects(async () => {
        await starredItems.applyBatch('u_1', invalidRows)
      })

      assert.equal(await starredItems.isStarred('u_1', 'i_valid', 'message'), false)
      assert.equal(await starredItems.countForUser('u_1'), 1)
    }
  },
  {
    name: '19. remove hard-deletes',
    async fn({ starredItems }) {
      await starredItems.applyAddedEvent({ userId: 'u_1', itemId: 'i_del', itemType: 'message', roomId: 'r_1', userSeq: 10 })
      const res = await starredItems.remove('u_1', 'i_del', 'message')
      assert.equal(res.changes, 1)
      assert.equal(await starredItems.get('u_1', 'i_del', 'message'), undefined)
    }
  },
  {
    name: '20. countForUser counts non-tombstoned rows',
    async fn({ starredItems }) {
      assert.equal(await starredItems.countForUser('u_1'), 0)

      await starredItems.applyAddedEvent({ userId: 'u_1', itemId: 'i_1', itemType: 'message', roomId: 'r_1', userSeq: 10 })
      await starredItems.applyAddedEvent({ userId: 'u_1', itemId: 'i_2', itemType: 'attachment', roomId: 'r_1', userSeq: 20 })
      await starredItems.applyAddedEvent({ userId: 'u_1', itemId: 'i_3', itemType: 'link', roomId: 'r_1', userSeq: 30 })
      await starredItems.applyRemovedEvent({ userId: 'u_1', itemId: 'i_2', itemType: 'attachment', userSeq: 40 })

      assert.equal(await starredItems.countForUser('u_1'), 2)
    }
  },
  {
    name: '21. countByType counts by type',
    async fn({ starredItems }) {
      await starredItems.applyAddedEvent({ userId: 'u_1', itemId: 'i_1', itemType: 'message', roomId: 'r_1', userSeq: 10 })
      await starredItems.applyAddedEvent({ userId: 'u_1', itemId: 'i_2', itemType: 'message', roomId: 'r_1', userSeq: 20 })
      await starredItems.applyAddedEvent({ userId: 'u_1', itemId: 'i_3', itemType: 'attachment', roomId: 'r_1', userSeq: 30 })

      assert.equal(await starredItems.countByType('u_1', 'message'), 2)
      assert.equal(await starredItems.countByType('u_1', 'attachment'), 1)
      assert.equal(await starredItems.countByType('u_1', 'link'), 0)
    }
  },
  {
    name: '22. getHighestSeq returns the maximum user_seq',
    async fn({ starredItems }) {
      assert.equal(await starredItems.getHighestSeq('u_nobody'), 0)

      await starredItems.applyAddedEvent({ userId: 'u_1', itemId: 'i_1', itemType: 'message', roomId: 'r_1', userSeq: 10 })
      await starredItems.applyAddedEvent({ userId: 'u_1', itemId: 'i_2', itemType: 'message', roomId: 'r_1', userSeq: 85 })

      assert.equal(await starredItems.getHighestSeq('u_1'), 85)
    }
  },
  {
    name: '23. clearAll deletes every row',
    async fn({ starredItems }) {
      await starredItems.applyAddedEvent({ userId: 'u_1', itemId: 'i_1', itemType: 'message', roomId: 'r_1', userSeq: 10 })
      await starredItems.applyAddedEvent({ userId: 'u_2', itemId: 'i_2', itemType: 'message', roomId: 'r_1', userSeq: 20 })

      const res = await starredItems.clearAll()
      assert.equal(res.changes, 2)
      assert.equal(await starredItems.countForUser('u_1'), 0)
      assert.equal(await starredItems.countForUser('u_2'), 0)
    }
  },
  {
    name: '24. createRepositories includes starredItems repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.starredItems)
      assert.equal(typeof repos.starredItems.get, 'function')
      assert.equal(typeof repos.starredItems.isStarred, 'function')
      assert.equal(typeof repos.starredItems.listForUser, 'function')
      assert.equal(typeof repos.starredItems.listForRoom, 'function')
      assert.equal(typeof repos.starredItems.applyRemote, 'function')
      assert.equal(typeof repos.starredItems.applyAddedEvent, 'function')
      assert.equal(typeof repos.starredItems.applyRemovedEvent, 'function')
      assert.equal(typeof repos.starredItems.applyBatch, 'function')
      assert.equal(typeof repos.starredItems.remove, 'function')
      assert.equal(typeof repos.starredItems.countForUser, 'function')
      assert.equal(typeof repos.starredItems.countByType, 'function')
      assert.equal(typeof repos.starredItems.getHighestSeq, 'function')
      assert.equal(typeof repos.starredItems.clearAll, 'function')
    }
  }
]

test('Starred Items Repository - Memory SQLite Backend', async (t) => {
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

test('Starred Items Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
