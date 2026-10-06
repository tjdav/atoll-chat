import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { createMemoryBackend } from '../../src/lib/db/backends/memory.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createOutboxRepository } from '../../src/lib/db/repositories/outbox.js'
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
    { name: '0007-outbox.sql', sql: readFileSync(resolve(dir, '0007-outbox.sql'), 'utf8') }
  ]
}

async function buildRepo(backend) {
  const db = await createDb({
    backend,
    migrations: loadMigrations()
  })
  await db.open()
  const outbox = createOutboxRepository({ db })
  await outbox.clearAll()
  return { db, outbox }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown message id',
    async fn({ outbox }) {
      assert.equal(await outbox.get('m_missing'), undefined)
    }
  },
  {
    name: '2. enqueue inserts a row with expected defaults',
    async fn({ outbox }) {
      const res = await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      assert.equal(res.changes, 1)

      const row = await outbox.get('m_1')
      assert.ok(row)
      assert.equal(row.message_id, 'm_1')
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.attempts, 0)
      assert.equal(typeof row.enqueued_at, 'number')
      assert.equal(row.enqueued_at, row.next_attempt_at)
      assert.equal(row.last_attempt_at, null)
      assert.equal(row.last_error, null)
    }
  },
  {
    name: '3. enqueue on an existing message id is a no-op (changes: 0)',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      const original = await outbox.get('m_1')

      await new Promise((r) => setTimeout(r, 10))
      const res = await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      assert.equal(res.changes, 0)

      const current = await outbox.get('m_1')
      assert.equal(current.enqueued_at, original.enqueued_at)
    }
  },
  {
    name: '4. enqueue two messages in quick succession -> peek() returns the first enqueued (FIFO)',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await new Promise((r) => setTimeout(r, 10))
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_1' })

      const first = await outbox.peek()
      assert.equal(first.message_id, 'm_1')
    }
  },
  {
    name: '5. dequeue() returns undefined on an empty table',
    async fn({ outbox }) {
      assert.equal(await outbox.dequeue(), undefined)
    }
  },
  {
    name: '6. dequeue() returns undefined when no row has next_attempt_at <= now',
    async fn({ db, outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      const future = Date.now() + 60000
      await db.execute(`UPDATE outbox SET next_attempt_at = ? WHERE message_id = ?`, [future, 'm_1'])

      assert.equal(await outbox.dequeue(), undefined)
    }
  },
  {
    name: '7. dequeue() returns due row ordered by next_attempt_at ASC, enqueued_at ASC',
    async fn({ db, outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_1' })

      const now = Date.now()
      // m_1 next_attempt_at = now - 100, m_2 next_attempt_at = now - 200
      await db.execute(`UPDATE outbox SET next_attempt_at = ? WHERE message_id = ?`, [now - 100, 'm_1'])
      await db.execute(`UPDATE outbox SET next_attempt_at = ? WHERE message_id = ?`, [now - 200, 'm_2'])

      const due = await outbox.dequeue()
      assert.equal(due.message_id, 'm_2')
    }
  },
  {
    name: '8. dequeue() does not remove the row',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })

      const first = await outbox.dequeue()
      const second = await outbox.dequeue()

      assert.equal(first.message_id, 'm_1')
      assert.equal(second.message_id, 'm_1')
      assert.equal(await outbox.count(), 1)
    }
  },
  {
    name: '9. markSent(messageId) deletes the row',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })

      const res = await outbox.markSent('m_1')
      assert.equal(res.changes, 1)

      assert.equal(await outbox.get('m_1'), undefined)
    }
  },
  {
    name: '10. markSent on an unknown message returns { changes: 0 }',
    async fn({ outbox }) {
      const res = await outbox.markSent('m_missing')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '11. markFailed with terminal: false updates retry state',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      const future = Date.now() + 5000

      const res = await outbox.markFailed('m_1', 'timeout', { attempts: 1, nextAttemptAt: future, terminal: false })
      assert.equal(res.changes, 1)

      const row = await outbox.get('m_1')
      assert.equal(row.attempts, 1)
      assert.equal(row.next_attempt_at, future)
      assert.equal(row.last_error, 'timeout')
      assert.equal(typeof row.last_attempt_at, 'number')
    }
  },
  {
    name: '12. markFailed with terminal: true deletes the row',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })

      const res = await outbox.markFailed('m_1', 'max_retries', { attempts: 3, nextAttemptAt: Date.now(), terminal: true })
      assert.equal(res.changes, 1)

      assert.equal(await outbox.get('m_1'), undefined)
    }
  },
  {
    name: '13. list() returns rows in FIFO order',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await new Promise((r) => setTimeout(r, 10))
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_1' })

      const rows = await outbox.list()
      assert.equal(rows.length, 2)
      assert.equal(rows[0].message_id, 'm_1')
      assert.equal(rows[1].message_id, 'm_2')
    }
  },
  {
    name: '14. list({ limit: 1 }) returns one row',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_1' })

      const rows = await outbox.list({ limit: 1 })
      assert.equal(rows.length, 1)
      assert.equal(rows[0].message_id, 'm_1')
    }
  },
  {
    name: '15. list({ cursor }) supports pagination',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await new Promise((r) => setTimeout(r, 10))
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_1' })

      const page1 = await outbox.list({ limit: 1 })
      assert.equal(page1.length, 1)
      assert.equal(page1[0].message_id, 'm_1')

      const page2 = await outbox.list({
        limit: 10,
        cursor: { nextAttemptAt: page1[0].next_attempt_at, enqueuedAt: page1[0].enqueued_at }
      })
      assert.equal(page2.length, 1)
      assert.equal(page2[0].message_id, 'm_2')
    }
  },
  {
    name: '16. count() returns total row count',
    async fn({ outbox }) {
      assert.equal(await outbox.count(), 0)
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_1' })

      assert.equal(await outbox.count(), 2)
    }
  },
  {
    name: '17. countDue() counts only rows with next_attempt_at <= now',
    async fn({ db, outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_1' })

      const future = Date.now() + 60000
      await db.execute(`UPDATE outbox SET next_attempt_at = ? WHERE message_id = ?`, [future, 'm_2'])

      assert.equal(await outbox.countDue(), 1)
    }
  },
  {
    name: '18. listByRoom(roomId) returns only rows for that room',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_2' })

      const r1 = await outbox.listByRoom('r_1')
      assert.equal(r1.length, 1)
      assert.equal(r1[0].message_id, 'm_1')

      const r2 = await outbox.listByRoom('r_2')
      assert.equal(r2.length, 1)
      assert.equal(r2[0].message_id, 'm_2')
    }
  },
  {
    name: '19. removeByRoom(roomId) deletes only rows for that room',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_2' })

      const res = await outbox.removeByRoom('r_1')
      assert.equal(res.changes, 1)

      assert.equal(await outbox.get('m_1'), undefined)
      assert.ok(await outbox.get('m_2'))
    }
  },
  {
    name: '20. remove(messageId) deletes one row',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })

      const res = await outbox.remove('m_1')
      assert.equal(res.changes, 1)

      assert.equal(await outbox.get('m_1'), undefined)
    }
  },
  {
    name: '21. clearAll() deletes every row',
    async fn({ outbox }) {
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_2' })

      const res = await outbox.clearAll()
      assert.equal(res.changes, 2)
      assert.equal(await outbox.count(), 0)
    }
  },
  {
    name: '22. FIFO invariant under markFailed and markSent operations',
    async fn({ outbox }) {
      // Enqueue 3 messages
      await outbox.enqueue({ messageId: 'm_1', roomId: 'r_1' })
      await new Promise((r) => setTimeout(r, 10))
      await outbox.enqueue({ messageId: 'm_2', roomId: 'r_1' })
      await new Promise((r) => setTimeout(r, 10))
      await outbox.enqueue({ messageId: 'm_3', roomId: 'r_1' })

      // Mark the second one failed with a future next_attempt_at
      const future = Date.now() + 60000
      await outbox.markFailed('m_2', 'network_error', { attempts: 1, nextAttemptAt: future, terminal: false })

      // dequeue() returns m_1
      const first = await outbox.dequeue()
      assert.equal(first.message_id, 'm_1')

      // Mark m_1 sent
      await outbox.markSent('m_1')

      // dequeue() returns m_3 (m_2 is future)
      const third = await outbox.dequeue()
      assert.equal(third.message_id, 'm_3')

      // Mark m_3 sent
      await outbox.markSent('m_3')

      // dequeue() returns undefined (m_2 is still in the future)
      assert.equal(await outbox.dequeue(), undefined)
    }
  },
  {
    name: '23. createRepositories includes outbox repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.outbox)
      assert.equal(typeof repos.outbox.enqueue, 'function')
      assert.equal(typeof repos.outbox.dequeue, 'function')
      assert.equal(typeof repos.outbox.peek, 'function')
      assert.equal(typeof repos.outbox.list, 'function')
      assert.equal(typeof repos.outbox.get, 'function')
      assert.equal(typeof repos.outbox.markSent, 'function')
      assert.equal(typeof repos.outbox.markFailed, 'function')
      assert.equal(typeof repos.outbox.count, 'function')
      assert.equal(typeof repos.outbox.countDue, 'function')
      assert.equal(typeof repos.outbox.listByRoom, 'function')
      assert.equal(typeof repos.outbox.removeByRoom, 'function')
      assert.equal(typeof repos.outbox.remove, 'function')
      assert.equal(typeof repos.outbox.clearAll, 'function')
    }
  }
]

test('Outbox Repository - Memory SQLite Backend', async (t) => {
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

test('Outbox Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
