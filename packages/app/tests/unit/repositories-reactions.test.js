import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createReactionsRepository } from '../../src/lib/db/repositories/reactions.js'
import { createMessagesRepository } from '../../src/lib/db/repositories/messages.js'
import { createRepositories } from '../../src/lib/db/repositories/index.js'

function loadMigrations() {
  const dir = resolve(import.meta.dirname, '../../src/db/migrations')
  return [
    { name: '0001-meta.sql', sql: readFileSync(resolve(dir, '0001-meta.sql'), 'utf8') },
    { name: '0002-users.sql', sql: readFileSync(resolve(dir, '0002-users.sql'), 'utf8') },
    { name: '0003-rooms.sql', sql: readFileSync(resolve(dir, '0003-rooms.sql'), 'utf8') },
    { name: '0004-messages.sql', sql: readFileSync(resolve(dir, '0004-messages.sql'), 'utf8') },
    { name: '0005-attachments-reactions.sql', sql: readFileSync(resolve(dir, '0005-attachments-reactions.sql'), 'utf8') }
  ]
}

async function buildRepo(backend) {
  const db = await createDb({
    backend,
    migrations: loadMigrations()
  })
  await db.open()
  const reactions = createReactionsRepository({ db })
  const messages = createMessagesRepository({ db })
  await reactions.clearAll()
  await messages.clearAll()
  return { db, reactions, messages }
}

const cases = [
  {
    name: '1. listForMessage returns an empty array for a message with no reactions',
    async fn({ reactions }) {
      const rows = await reactions.listForMessage('m_none')
      assert.deepEqual(rows, [])
    }
  },
  {
    name: '2. add inserts a reaction and listForMessage returns it',
    async fn({ reactions }) {
      await reactions.add({
        messageId: 'm_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        reaction: '👍'
      })

      const rows = await reactions.listForMessage('m_1')
      assert.equal(rows.length, 1)
      assert.equal(rows[0].message_id, 'm_1')
      assert.equal(rows[0].sender_user_id, 'u_1')
      assert.equal(rows[0].sender_client_id, 'c_1')
      assert.equal(rows[0].reaction, '👍')
      assert.ok(rows[0].created_at)
    }
  },
  {
    name: '3. add on an existing active reaction refreshes created_at and leaves deleted_at NULL',
    async fn({ reactions }) {
      await reactions.add({
        messageId: 'm_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        reaction: '👍'
      })

      const firstRow = await reactions.get('m_1', 'u_1', 'c_1', '👍')
      await new Promise((r) => setTimeout(r, 5))

      await reactions.add({
        messageId: 'm_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        reaction: '👍'
      })

      const secondRow = await reactions.get('m_1', 'u_1', 'c_1', '👍')
      assert.equal(secondRow.deleted_at, null)
      assert.ok(secondRow.created_at >= firstRow.created_at)
    }
  },
  {
    name: '4. add on a soft-deleted reaction reactivates it (sets deleted_at to NULL)',
    async fn({ reactions }) {
      await reactions.add({
        messageId: 'm_reactivate',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        reaction: '❤️'
      })

      await reactions.remove({
        messageId: 'm_reactivate',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        reaction: '❤️'
      })

      const deletedRow = await reactions.get('m_reactivate', 'u_1', 'c_1', '❤️')
      assert.ok(deletedRow.deleted_at)

      await reactions.add({
        messageId: 'm_reactivate',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        reaction: '❤️'
      })

      const activeRow = await reactions.get('m_reactivate', 'u_1', 'c_1', '❤️')
      assert.equal(activeRow.deleted_at, null)
      const list = await reactions.listForMessage('m_reactivate')
      assert.equal(list.length, 1)
    }
  },
  {
    name: '5. remove soft-deletes and listForMessage excludes the row',
    async fn({ reactions }) {
      await reactions.add({
        messageId: 'm_soft',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        reaction: '🎉'
      })

      const res = await reactions.remove({
        messageId: 'm_soft',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        reaction: '🎉'
      })
      assert.equal(res.changes, 1)

      const active = await reactions.listForMessage('m_soft')
      assert.equal(active.length, 0)

      const raw = await reactions.get('m_soft', 'u_1', 'c_1', '🎉')
      assert.ok(raw.deleted_at)
    }
  },
  {
    name: '6. remove on an unknown four-tuple returns { changes: 0 }',
    async fn({ reactions }) {
      const res = await reactions.remove({
        messageId: 'm_unk',
        senderUserId: 'u_unk',
        senderClientId: 'c_unk',
        reaction: '🔥'
      })
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '7. removeByMessage deletes every reaction for a message',
    async fn({ reactions }) {
      await reactions.add({ messageId: 'm_clear', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '👍' })
      await reactions.add({ messageId: 'm_clear', senderUserId: 'u_2', senderClientId: 'c_1', reaction: '❤️' })

      const res = await reactions.removeByMessage('m_clear')
      assert.equal(res.changes, 2)

      const list = await reactions.listForMessage('m_clear')
      assert.equal(list.length, 0)
    }
  },
  {
    name: '8. listForRoom returns reactions for all messages in one room',
    async fn({ reactions, messages }) {
      await messages.upsert({ messageId: 'm_r1', roomId: 'r_target', senderUserId: 'u_s', senderClientId: 'c_s', epoch: 1, seq: 1, contentType: 'application', ciphertext: new Uint8Array([1]) })
      await messages.upsert({ messageId: 'm_r2', roomId: 'r_target', senderUserId: 'u_s', senderClientId: 'c_s', epoch: 1, seq: 2, contentType: 'application', ciphertext: new Uint8Array([1]) })

      await reactions.add({ messageId: 'm_r1', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '🚀' })
      await reactions.add({ messageId: 'm_r2', senderUserId: 'u_2', senderClientId: 'c_1', reaction: '✨' })

      const roomReactions = await reactions.listForRoom('r_target')
      assert.equal(roomReactions.length, 2)
    }
  },
  {
    name: '9. listForRoom excludes soft-deleted reactions',
    async fn({ reactions, messages }) {
      await messages.upsert({ messageId: 'm_del_room', roomId: 'r_del', senderUserId: 'u_s', senderClientId: 'c_s', epoch: 1, seq: 1, contentType: 'application', ciphertext: new Uint8Array([1]) })
      await reactions.add({ messageId: 'm_del_room', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '💩' })
      await reactions.remove({ messageId: 'm_del_room', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '💩' })

      const roomReactions = await reactions.listForRoom('r_del')
      assert.equal(roomReactions.length, 0)
    }
  },
  {
    name: '10. listForRoom excludes reactions on messages from other rooms',
    async fn({ reactions, messages }) {
      await messages.upsert({ messageId: 'm_other', roomId: 'r_other', senderUserId: 'u_s', senderClientId: 'c_s', epoch: 1, seq: 1, contentType: 'application', ciphertext: new Uint8Array([1]) })
      await reactions.add({ messageId: 'm_other', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '👀' })

      const roomReactions = await reactions.listForRoom('r_target_none')
      assert.equal(roomReactions.length, 0)
    }
  },
  {
    name: '11. countForMessage counts only active reactions',
    async fn({ reactions }) {
      await reactions.add({ messageId: 'm_cnt', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '👍' })
      await reactions.add({ messageId: 'm_cnt', senderUserId: 'u_2', senderClientId: 'c_1', reaction: '❤️' })
      await reactions.add({ messageId: 'm_cnt', senderUserId: 'u_3', senderClientId: 'c_1', reaction: '🔥' })
      await reactions.remove({ messageId: 'm_cnt', senderUserId: 'u_3', senderClientId: 'c_1', reaction: '🔥' })

      const count = await reactions.countForMessage('m_cnt')
      assert.equal(count, 2)
    }
  },
  {
    name: '12. aggregateForMessage returns { reaction, users } counts deduplicating multi-device reactions',
    async fn({ reactions }) {
      // User 1 reacts with 👍 from device c_1 and device c_2
      await reactions.add({ messageId: 'm_agg', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '👍' })
      await reactions.add({ messageId: 'm_agg', senderUserId: 'u_1', senderClientId: 'c_2', reaction: '👍' })
      // User 2 reacts with 👍 from device c_1
      await reactions.add({ messageId: 'm_agg', senderUserId: 'u_2', senderClientId: 'c_1', reaction: '👍' })
      // User 3 reacts with ❤️ from device c_1
      await reactions.add({ messageId: 'm_agg', senderUserId: 'u_3', senderClientId: 'c_1', reaction: '❤️' })

      const aggregated = await reactions.aggregateForMessage('m_agg')
      assert.equal(aggregated.length, 2)
      assert.deepEqual(aggregated[0], { reaction: '👍', users: 2 })
      assert.deepEqual(aggregated[1], { reaction: '❤️', users: 1 })
    }
  },
  {
    name: '13. aggregateForMessage orders by count descending then by reaction ascending',
    async fn({ reactions }) {
      await reactions.add({ messageId: 'm_sort', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '🎉' })
      await reactions.add({ messageId: 'm_sort', senderUserId: 'u_2', senderClientId: 'c_1', reaction: '🎉' })
      await reactions.add({ messageId: 'm_sort', senderUserId: 'u_3', senderClientId: 'c_1', reaction: '🍎' })

      const aggregated = await reactions.aggregateForMessage('m_sort')
      assert.equal(aggregated[0].reaction, '🎉')
      assert.equal(aggregated[0].users, 2)
      assert.equal(aggregated[1].reaction, '🍎')
      assert.equal(aggregated[1].users, 1)
    }
  },
  {
    name: '14. hasReacted returns true for a matching active reaction',
    async fn({ reactions }) {
      await reactions.add({ messageId: 'm_has', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '✅' })

      const has = await reactions.hasReacted('m_has', 'u_1', '✅')
      assert.equal(has, true)
    }
  },
  {
    name: '15. hasReacted returns false when the reaction is from a different user',
    async fn({ reactions }) {
      await reactions.add({ messageId: 'm_has_diff', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '✅' })

      const has = await reactions.hasReacted('m_has_diff', 'u_2', '✅')
      assert.equal(has, false)
    }
  },
  {
    name: '16. hasReacted returns false when the reaction is soft-deleted',
    async fn({ reactions }) {
      await reactions.add({ messageId: 'm_has_del', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '✅' })
      await reactions.remove({ messageId: 'm_has_del', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '✅' })

      const has = await reactions.hasReacted('m_has_del', 'u_1', '✅')
      assert.equal(has, false)
    }
  },
  {
    name: '17. get returns the row or undefined',
    async fn({ reactions }) {
      await reactions.add({ messageId: 'm_get', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '⭐' })

      const row = await reactions.get('m_get', 'u_1', 'c_1', '⭐')
      assert.ok(row)
      assert.equal(row.reaction, '⭐')

      const missing = await reactions.get('m_get', 'u_missing', 'c_1', '⭐')
      assert.equal(missing, undefined)
    }
  },
  {
    name: '18. clearAll hard-deletes every row',
    async fn({ reactions }) {
      await reactions.add({ messageId: 'm_c1', senderUserId: 'u_1', senderClientId: 'c_1', reaction: '⭐' })
      await reactions.add({ messageId: 'm_c2', senderUserId: 'u_2', senderClientId: 'c_1', reaction: '⭐' })

      await reactions.clearAll()

      const count1 = await reactions.countForMessage('m_c1')
      assert.equal(count1, 0)
      assert.equal(await reactions.get('m_c1', 'u_1', 'c_1', '⭐'), undefined)
    }
  },
  {
    name: '19. createRepositories returns reactions repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.reactions)
      assert.equal(typeof repos.reactions.listForMessage, 'function')
      assert.equal(typeof repos.reactions.add, 'function')
      assert.equal(typeof repos.reactions.aggregateForMessage, 'function')
      assert.equal(typeof repos.reactions.clearAll, 'function')
    }
  }
]

test('Reactions Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
