import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createMessagesRepository } from '../../src/lib/db/repositories/messages.js'
import { createRepositories } from '../../src/lib/db/repositories/index.js'

function loadMigrations() {
  const dir = resolve(import.meta.dirname, '../../src/db/migrations')
  return [
    { name: '0001-meta.sql', sql: readFileSync(resolve(dir, '0001-meta.sql'), 'utf8') },
    { name: '0002-users.sql', sql: readFileSync(resolve(dir, '0002-users.sql'), 'utf8') },
    { name: '0003-rooms.sql', sql: readFileSync(resolve(dir, '0003-rooms.sql'), 'utf8') },
    { name: '0004-messages.sql', sql: readFileSync(resolve(dir, '0004-messages.sql'), 'utf8') }
  ]
}

async function buildRepo(backend) {
  const db = await createDb({
    backend,
    migrations: loadMigrations()
  })
  await db.open()
  const messages = createMessagesRepository({ db })
  await messages.clearAll()
  return { db, messages }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown message',
    async fn({ messages }) {
      const res = await messages.get('m_missing')
      assert.equal(res, undefined)
    }
  },
  {
    name: '2. upsert inserts a new message',
    async fn({ messages }) {
      const ct = new Uint8Array([1, 2, 3])
      const res = await messages.upsert({
        messageId: 'm_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 10,
        contentType: 'application',
        ciphertext: ct,
        decryptedPayload: '{"text":"hello"}'
      })
      assert.equal(res.changes, 1)

      const row = await messages.get('m_1')
      assert.equal(row.message_id, 'm_1')
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.sender_user_id, 'u_1')
      assert.equal(row.sender_client_id, 'c_1')
      assert.equal(row.epoch, 1)
      assert.equal(row.seq, 10)
      assert.equal(row.content_type, 'application')
      assert.equal(row.decrypted_payload, '{"text":"hello"}')
      assert.equal(row.reply_to, null)
      assert.equal(row.edited_at, null)
      assert.equal(row.deleted_at, null)
      assert.equal(row.expires_at, null)
      assert.equal(row.local_status, 'sent')
      assert.equal(row.local_error, null)
      assert.equal(typeof row.created_at, 'number')
      assert.equal(typeof row.updated_at, 'number')
    }
  },
  {
    name: '3. upsert with a partial field does not clear others',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 10,
        contentType: 'application',
        ciphertext: new Uint8Array([1, 2, 3]),
        decryptedPayload: '{"text":"hello"}'
      })

      await messages.upsert({
        messageId: 'm_1',
        decryptedPayload: '{"text":"hello edited"}'
      })

      const row = await messages.get('m_1')
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.sender_user_id, 'u_1')
      assert.equal(row.epoch, 1)
      assert.equal(row.decrypted_payload, '{"text":"hello edited"}')
    }
  },
  {
    name: '4. upsert refreshes updated_at',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 10,
        contentType: 'application',
        ciphertext: new Uint8Array([1, 2, 3])
      })
      const row1 = await messages.get('m_1')
      const t1 = row1.updated_at

      await new Promise((r) => setTimeout(r, 5))

      await messages.upsert({
        messageId: 'm_1',
        decryptedPayload: '{"text":"updated"}'
      })
      const row2 = await messages.get('m_1')
      const t2 = row2.updated_at

      assert.ok(t2 > t1, `expected ${t2} > ${t1}`)
    }
  },
  {
    name: '5. updateLocalStatus updates only status and error',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 10,
        contentType: 'application',
        ciphertext: new Uint8Array([1, 2, 3]),
        localStatus: 'pending'
      })

      const res = await messages.updateLocalStatus('m_1', 'failed', { error: 'network error' })
      assert.equal(res.changes, 1)

      const row = await messages.get('m_1')
      assert.equal(row.local_status, 'failed')
      assert.equal(row.local_error, 'network error')
      assert.equal(row.room_id, 'r_1')
    }
  },
  {
    name: '6. updateLocalStatus clears local_error when no error is passed',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 10,
        contentType: 'application',
        ciphertext: new Uint8Array([1, 2, 3]),
        localStatus: 'failed',
        localError: 'previous error'
      })

      await messages.updateLocalStatus('m_1', 'sent')
      const row = await messages.get('m_1')
      assert.equal(row.local_status, 'sent')
      assert.equal(row.local_error, null)
    }
  },
  {
    name: '7. markDeleted sets deleted_at',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 10,
        contentType: 'application',
        ciphertext: new Uint8Array([1, 2, 3])
      })

      const res = await messages.markDeleted('m_1')
      assert.equal(res.changes, 1)

      const row = await messages.get('m_1')
      assert.equal(typeof row.deleted_at, 'number')
      assert.ok(row.deleted_at > 0)
    }
  },
  {
    name: '8. remove deletes the message and its versions',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 10,
        contentType: 'application',
        ciphertext: new Uint8Array([1, 2, 3])
      })
      await messages.upsertVersion({
        messageId: 'm_1',
        editSequence: 0,
        ciphertext: new Uint8Array([1]),
        decryptedPayload: 'v0',
        editedAt: 1000
      })
      await messages.upsertVersion({
        messageId: 'm_1',
        editSequence: 1,
        ciphertext: new Uint8Array([2]),
        decryptedPayload: 'v1',
        editedAt: 1005
      })

      const delRes = await messages.remove('m_1')
      assert.equal(delRes.changes, 1)

      assert.equal(await messages.get('m_1'), undefined)
      assert.deepEqual(await messages.listVersions('m_1'), [])
    }
  },
  {
    name: '9. removeExpired deletes only expired messages',
    async fn({ messages }) {
      const now = Date.now()
      // Past expired
      await messages.upsert({
        messageId: 'm_past',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 1,
        contentType: 'application',
        ciphertext: new Uint8Array([1]),
        expiresAt: now - 10000
      })
      // Future expired
      await messages.upsert({
        messageId: 'm_future',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 2,
        contentType: 'application',
        ciphertext: new Uint8Array([2]),
        expiresAt: now + 100000
      })
      // No expire
      await messages.upsert({
        messageId: 'm_null',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 3,
        contentType: 'application',
        ciphertext: new Uint8Array([3]),
        expiresAt: null
      })

      const res = await messages.removeExpired()
      assert.equal(res.changes, 1)

      assert.equal(await messages.get('m_past'), undefined)
      assert.ok(await messages.get('m_future'))
      assert.ok(await messages.get('m_null'))
    }
  },
  {
    name: '10. removeAllInRoom deletes all messages in one room and none in another',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_r1_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 1,
        contentType: 'application',
        ciphertext: new Uint8Array([1])
      })
      await messages.upsert({
        messageId: 'm_r1_2',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 2,
        contentType: 'application',
        ciphertext: new Uint8Array([2])
      })
      await messages.upsert({
        messageId: 'm_r2_1',
        roomId: 'r_2',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 1,
        contentType: 'application',
        ciphertext: new Uint8Array([3])
      })

      const res = await messages.removeAllInRoom('r_1')
      assert.equal(res.changes, 2)

      assert.equal(await messages.countInRoom('r_1'), 0)
      assert.equal(await messages.countInRoom('r_2'), 1)
    }
  },
  {
    name: '11. listInRoom orders by (epoch DESC, seq DESC)',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_1_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 1,
        contentType: 'application',
        ciphertext: new Uint8Array([1])
      })
      await messages.upsert({
        messageId: 'm_1_2',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 2,
        contentType: 'application',
        ciphertext: new Uint8Array([2])
      })
      await messages.upsert({
        messageId: 'm_2_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 2,
        seq: 1,
        contentType: 'application',
        ciphertext: new Uint8Array([3])
      })

      const rows = await messages.listInRoom('r_1')
      assert.equal(rows.length, 3)
      assert.equal(rows[0].message_id, 'm_2_1')
      assert.equal(rows[1].message_id, 'm_1_2')
      assert.equal(rows[2].message_id, 'm_1_1')
    }
  },
  {
    name: '12. listInRoom respects limit',
    async fn({ messages }) {
      for (let i = 1; i <= 5; i++) {
        await messages.upsert({
          messageId: `m_${i}`,
          roomId: 'r_1',
          senderUserId: 'u_1',
          senderClientId: 'c_1',
          epoch: 1,
          seq: i,
          contentType: 'application',
          ciphertext: new Uint8Array([i])
        })
      }
      const rows = await messages.listInRoom('r_1', { limit: 2 })
      assert.equal(rows.length, 2)
    }
  },
  {
    name: '13. listInRoom supports cursor pagination',
    async fn({ messages }) {
      for (let i = 1; i <= 5; i++) {
        await messages.upsert({
          messageId: `m_${i}`,
          roomId: 'r_1',
          senderUserId: 'u_1',
          senderClientId: 'c_1',
          epoch: 1,
          seq: i,
          contentType: 'application',
          ciphertext: new Uint8Array([i])
        })
      }

      const page1 = await messages.listInRoom('r_1', { limit: 2 })
      assert.equal(page1.length, 2)
      assert.equal(page1[0].message_id, 'm_5')
      assert.equal(page1[1].message_id, 'm_4')

      const cursor = { epoch: page1[1].epoch, seq: page1[1].seq }
      const page2 = await messages.listInRoom('r_1', { limit: 2, cursor })
      assert.equal(page2.length, 2)
      assert.equal(page2[0].message_id, 'm_3')
      assert.equal(page2[1].message_id, 'm_2')
    }
  },
  {
    name: '14. listInRoom scopes to the room',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_r1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 1,
        contentType: 'application',
        ciphertext: new Uint8Array([1])
      })
      await messages.upsert({
        messageId: 'm_r2',
        roomId: 'r_2',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 1,
        contentType: 'application',
        ciphertext: new Uint8Array([2])
      })

      const rows = await messages.listInRoom('r_1')
      assert.equal(rows.length, 1)
      assert.equal(rows[0].message_id, 'm_r1')
    }
  },
  {
    name: '15. listApplicationsInRoom excludes commit and proposal messages',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_app',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 1,
        contentType: 'application',
        ciphertext: new Uint8Array([1])
      })
      await messages.upsert({
        messageId: 'm_commit',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 2,
        contentType: 'commit',
        ciphertext: new Uint8Array([2])
      })
      await messages.upsert({
        messageId: 'm_prop',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 3,
        contentType: 'proposal',
        ciphertext: new Uint8Array([3])
      })

      const rows = await messages.listApplicationsInRoom('r_1')
      assert.equal(rows.length, 1)
      assert.equal(rows[0].message_id, 'm_app')
    }
  },
  {
    name: '16. countInRoom and countApplicationsInRoom return correct counts',
    async fn({ messages }) {
      assert.equal(await messages.countInRoom('r_1'), 0)
      assert.equal(await messages.countApplicationsInRoom('r_1'), 0)

      await messages.upsert({
        messageId: 'm_app',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 1,
        contentType: 'application',
        ciphertext: new Uint8Array([1])
      })
      await messages.upsert({
        messageId: 'm_commit',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 2,
        contentType: 'commit',
        ciphertext: new Uint8Array([2])
      })

      assert.equal(await messages.countInRoom('r_1'), 2)
      assert.equal(await messages.countApplicationsInRoom('r_1'), 1)
    }
  },
  {
    name: '17. upsertVersion inserts a version and listVersions returns it',
    async fn({ messages }) {
      const res = await messages.upsertVersion({
        messageId: 'm_1',
        editSequence: 0,
        ciphertext: new Uint8Array([1, 2]),
        decryptedPayload: '{"text":"v0"}',
        editedAt: 1000
      })
      assert.equal(res.changes, 1)

      const versions = await messages.listVersions('m_1')
      assert.equal(versions.length, 1)
      assert.equal(versions[0].message_id, 'm_1')
      assert.equal(versions[0].edit_sequence, 0)
      assert.equal(versions[0].decrypted_payload, '{"text":"v0"}')
      assert.equal(versions[0].edited_at, 1000)
    }
  },
  {
    name: '18. upsertVersion overwrites an identical (message_id, edit_sequence)',
    async fn({ messages }) {
      await messages.upsertVersion({
        messageId: 'm_1',
        editSequence: 0,
        ciphertext: new Uint8Array([1]),
        decryptedPayload: 'a',
        editedAt: 1000
      })
      await messages.upsertVersion({
        messageId: 'm_1',
        editSequence: 0,
        ciphertext: new Uint8Array([2]),
        decryptedPayload: 'b',
        editedAt: 1005
      })

      const versions = await messages.listVersions('m_1')
      assert.equal(versions.length, 1)
      assert.equal(versions[0].decrypted_payload, 'b')
      assert.equal(versions[0].edited_at, 1005)
    }
  },
  {
    name: '19. listVersions orders by edit_sequence ASC',
    async fn({ messages }) {
      await messages.upsertVersion({
        messageId: 'm_1',
        editSequence: 1,
        ciphertext: new Uint8Array([2]),
        decryptedPayload: 'v1',
        editedAt: 1005
      })
      await messages.upsertVersion({
        messageId: 'm_1',
        editSequence: 0,
        ciphertext: new Uint8Array([1]),
        decryptedPayload: 'v0',
        editedAt: 1000
      })

      const versions = await messages.listVersions('m_1')
      assert.equal(versions.length, 2)
      assert.equal(versions[0].edit_sequence, 0)
      assert.equal(versions[1].edit_sequence, 1)
    }
  },
  {
    name: '20. getVersion returns undefined for an unknown sequence',
    async fn({ messages }) {
      assert.equal(await messages.getVersion('m_1', 99), undefined)
    }
  },
  {
    name: '21. countVersions returns correct count',
    async fn({ messages }) {
      assert.equal(await messages.countVersions('m_1'), 0)
      await messages.upsertVersion({
        messageId: 'm_1',
        editSequence: 0,
        ciphertext: new Uint8Array([1]),
        editedAt: 1000
      })
      await messages.upsertVersion({
        messageId: 'm_1',
        editSequence: 1,
        ciphertext: new Uint8Array([2]),
        editedAt: 1005
      })
      assert.equal(await messages.countVersions('m_1'), 2)
    }
  },
  {
    name: '22. clearAll deletes every message and version',
    async fn({ messages }) {
      await messages.upsert({
        messageId: 'm_1',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 1,
        contentType: 'application',
        ciphertext: new Uint8Array([1])
      })
      await messages.upsertVersion({
        messageId: 'm_1',
        editSequence: 0,
        ciphertext: new Uint8Array([1]),
        editedAt: 1000
      })

      const res = await messages.clearAll()
      assert.equal(res.changes, 1)
      assert.equal(await messages.countInRoom('r_1'), 0)
      assert.equal(await messages.countVersions('m_1'), 0)
    }
  },
  {
    name: '23. Ciphertext round-trips correctly',
    async fn({ messages }) {
      const inputBytes = new Uint8Array([255, 0, 128, 64, 32, 16])
      await messages.upsert({
        messageId: 'm_bytes',
        roomId: 'r_1',
        senderUserId: 'u_1',
        senderClientId: 'c_1',
        epoch: 1,
        seq: 1,
        contentType: 'application',
        ciphertext: inputBytes
      })

      const row = await messages.get('m_bytes')
      const readBytes = Array.from(new Uint8Array(row.ciphertext))
      assert.deepEqual(readBytes, Array.from(inputBytes))
    }
  },
  {
    name: '24. createRepositories returns messages repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.messages)
      assert.equal(typeof repos.messages.get, 'function')
      assert.equal(typeof repos.messages.upsert, 'function')
      assert.equal(typeof repos.messages.remove, 'function')
      assert.equal(typeof repos.messages.clearAll, 'function')
    }
  }
]

test('Messages Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
