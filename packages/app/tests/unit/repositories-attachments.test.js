import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createAttachmentsRepository } from '../../src/lib/db/repositories/attachments.js'
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
  const attachments = createAttachmentsRepository({ db })
  await attachments.clearAll()
  return { db, attachments }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown file id',
    async fn({ attachments }) {
      const res = await attachments.get('f_missing')
      assert.equal(res, undefined)
    }
  },
  {
    name: '2. upsert inserts a new attachment with all fields and get reflects them',
    async fn({ attachments }) {
      await attachments.upsert({
        fileId: 'f_1',
        roomId: 'r_1',
        purpose: 'message',
        contentType: 'image/png',
        plaintextSize: 1024,
        encryptedSize: 1080,
        thumbnailFileId: 'f_thumb_1',
        durationMs: 0,
        uploadedAt: 1000,
        downloadedAt: 2000
      })

      const row = await attachments.get('f_1')
      assert.ok(row)
      assert.equal(row.file_id, 'f_1')
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.purpose, 'message')
      assert.equal(row.content_type, 'image/png')
      assert.equal(row.plaintext_size, 1024)
      assert.equal(row.encrypted_size, 1080)
      assert.equal(row.thumbnail_file_id, 'f_thumb_1')
      assert.equal(row.duration_ms, 0)
      assert.equal(row.uploaded_at, 1000)
      assert.equal(row.downloaded_at, 2000)
      assert.equal(typeof row.cached_at, 'number')
    }
  },
  {
    name: '3. upsert with a partial field does not clear others',
    async fn({ attachments }) {
      await attachments.upsert({
        fileId: 'f_partial',
        roomId: 'r_1',
        purpose: 'message',
        contentType: 'image/webp',
        plaintextSize: 500,
        encryptedSize: 556
      })

      await attachments.upsert({
        fileId: 'f_partial',
        purpose: 'message',
        durationMs: 12000
      })

      const row = await attachments.get('f_partial')
      assert.equal(row.room_id, 'r_1')
      assert.equal(row.content_type, 'image/webp')
      assert.equal(row.plaintext_size, 500)
      assert.equal(row.encrypted_size, 556)
      assert.equal(row.duration_ms, 12000)
    }
  },
  {
    name: '4. upsert refreshes cached_at',
    async fn({ attachments }) {
      await attachments.upsert({
        fileId: 'f_cache',
        purpose: 'sticker'
      })
      const initial = await attachments.get('f_cache')

      await new Promise((resolve) => setTimeout(resolve, 5))

      await attachments.upsert({
        fileId: 'f_cache',
        purpose: 'sticker'
      })
      const updated = await attachments.get('f_cache')

      assert.ok(updated.cached_at >= initial.cached_at)
    }
  },
  {
    name: '5. upsert without purpose on a fresh row throws the NOT NULL constraint',
    async fn({ attachments }) {
      await assert.rejects(
        async () => {
          await attachments.upsert({ fileId: 'f_no_purpose' })
        },
        (err) => err instanceof Error
      )
    }
  },
  {
    name: '6. markUploaded sets uploaded_at and encrypted_size and refreshes cached_at',
    async fn({ attachments }) {
      await attachments.upsert({
        fileId: 'f_upload',
        purpose: 'message'
      })

      const res = await attachments.markUploaded('f_upload', { encryptedSize: 2048 })
      assert.equal(res.changes, 1)

      const row = await attachments.get('f_upload')
      assert.ok(row.uploaded_at)
      assert.equal(row.encrypted_size, 2048)
    }
  },
  {
    name: '7. markUploaded without encryptedSize preserves the existing value',
    async fn({ attachments }) {
      await attachments.upsert({
        fileId: 'f_upload_keep',
        purpose: 'message',
        encryptedSize: 3000
      })

      await attachments.markUploaded('f_upload_keep')

      const row = await attachments.get('f_upload_keep')
      assert.equal(row.encrypted_size, 3000)
      assert.ok(row.uploaded_at)
    }
  },
  {
    name: '8. markDownloaded sets downloaded_at',
    async fn({ attachments }) {
      await attachments.upsert({
        fileId: 'f_download',
        purpose: 'message'
      })

      const res = await attachments.markDownloaded('f_download')
      assert.equal(res.changes, 1)

      const row = await attachments.get('f_download')
      assert.ok(row.downloaded_at)
    }
  },
  {
    name: '9. getMany([]) returns an empty array',
    async fn({ attachments }) {
      const res = await attachments.getMany([])
      assert.deepEqual(res, [])
    }
  },
  {
    name: '10. getMany([a, b]) returns rows for both',
    async fn({ attachments }) {
      await attachments.upsert({ fileId: 'f_a', purpose: 'message' })
      await attachments.upsert({ fileId: 'f_b', purpose: 'room-avatar' })

      const rows = await attachments.getMany(['f_a', 'f_b'])
      assert.equal(rows.length, 2)
      const ids = rows.map((r) => r.file_id).sort()
      assert.deepEqual(ids, ['f_a', 'f_b'])
    }
  },
  {
    name: '11. getMany([a, missing]) returns only found rows',
    async fn({ attachments }) {
      await attachments.upsert({ fileId: 'f_found', purpose: 'message' })

      const rows = await attachments.getMany(['f_found', 'f_missing'])
      assert.equal(rows.length, 1)
      assert.equal(rows[0].file_id, 'f_found')
    }
  },
  {
    name: '12. getMany builds IN clause from array length not values (SQL safety)',
    async fn({ attachments }) {
      const trickyId = "f_id' OR '1'='1"
      await attachments.upsert({ fileId: trickyId, purpose: 'message' })

      const rows = await attachments.getMany([trickyId])
      assert.equal(rows.length, 1)
      assert.equal(rows[0].file_id, trickyId)
    }
  },
  {
    name: '13. listByRoom orders by cached_at DESC and supports cursor pagination',
    async fn({ attachments }) {
      await attachments.upsert({ fileId: 'f_r1', roomId: 'r_100', purpose: 'message' })
      await new Promise((r) => setTimeout(r, 5))
      await attachments.upsert({ fileId: 'f_r2', roomId: 'r_100', purpose: 'message' })

      const firstPage = await attachments.listByRoom('r_100', { limit: 1 })
      assert.equal(firstPage.length, 1)
      assert.equal(firstPage[0].file_id, 'f_r2')

      const secondPage = await attachments.listByRoom('r_100', {
        limit: 10,
        cursor: firstPage[0].cached_at
      })
      assert.equal(secondPage.length, 1)
      assert.equal(secondPage[0].file_id, 'f_r1')
    }
  },
  {
    name: '14. listByPurpose returns only rows with that purpose',
    async fn({ attachments }) {
      await attachments.upsert({ fileId: 'f_p1', purpose: 'user-avatar' })
      await attachments.upsert({ fileId: 'f_p2', purpose: 'message' })

      const avatars = await attachments.listByPurpose('user-avatar')
      assert.equal(avatars.length, 1)
      assert.equal(avatars[0].file_id, 'f_p1')
    }
  },
  {
    name: '15. remove deletes a row',
    async fn({ attachments }) {
      await attachments.upsert({ fileId: 'f_del', purpose: 'message' })
      const res = await attachments.remove('f_del')
      assert.equal(res.changes, 1)

      const row = await attachments.get('f_del')
      assert.equal(row, undefined)
    }
  },
  {
    name: '16. remove on an unknown id returns { changes: 0 }',
    async fn({ attachments }) {
      const res = await attachments.remove('f_unknown')
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '17. countByRoom returns correct count',
    async fn({ attachments }) {
      await attachments.upsert({ fileId: 'f_c1', roomId: 'r_cnt', purpose: 'message' })
      await attachments.upsert({ fileId: 'f_c2', roomId: 'r_cnt', purpose: 'message' })
      await attachments.upsert({ fileId: 'f_c3', roomId: 'r_other', purpose: 'message' })

      const count = await attachments.countByRoom('r_cnt')
      assert.equal(count, 2)
    }
  },
  {
    name: '18. clearAll deletes every row',
    async fn({ attachments }) {
      await attachments.upsert({ fileId: 'f_clr1', purpose: 'message' })
      await attachments.upsert({ fileId: 'f_clr2', purpose: 'message' })

      await attachments.clearAll()

      const count = await attachments.countByRoom('r_cnt')
      assert.equal(count, 0)
      assert.equal(await attachments.get('f_clr1'), undefined)
    }
  },
  {
    name: '19. createRepositories returns attachments repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.attachments)
      assert.equal(typeof repos.attachments.get, 'function')
      assert.equal(typeof repos.attachments.upsert, 'function')
      assert.equal(typeof repos.attachments.getMany, 'function')
      assert.equal(typeof repos.attachments.clearAll, 'function')
    }
  }
]

test('Attachments Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
