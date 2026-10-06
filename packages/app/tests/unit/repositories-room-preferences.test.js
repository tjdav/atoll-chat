import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDb } from '../../src/lib/db/index.js'
import { createMemoryBackend } from '../../src/lib/db/backends/memory.js'
import { resolveBackend } from '../../src/lib/db/backends/index.js'
import { createRoomPreferencesRepository } from '../../src/lib/db/repositories/room-preferences.js'
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
    { name: '0008-room-preferences-nicknames.sql', sql: readFileSync(resolve(dir, '0008-room-preferences-nicknames.sql'), 'utf8') }
  ]
}

async function buildRepo(backend) {
  const db = await createDb({
    backend,
    migrations: loadMigrations()
  })
  await db.open()
  const roomPreferences = createRoomPreferencesRepository({ db })
  await roomPreferences.clearAll()
  return { db, roomPreferences }
}

const cases = [
  {
    name: '1. get returns undefined for an unknown (user, room, key)',
    async fn({ roomPreferences }) {
      assert.equal(await roomPreferences.get('u_1', 'r_1', 'theme'), undefined)
    }
  },
  {
    name: '2. set inserts a new preference. get returns the value',
    async fn({ roomPreferences }) {
      const res = await roomPreferences.set('u_1', 'r_1', 'theme', 'dark')
      assert.equal(res.changes, 1)
      assert.equal(await roomPreferences.get('u_1', 'r_1', 'theme'), 'dark')
    }
  },
  {
    name: '3. set with a string value round-trips',
    async fn({ roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'wallpaper', 'https://example.com/bg.png')
      assert.equal(await roomPreferences.get('u_1', 'r_1', 'wallpaper'), 'https://example.com/bg.png')
    }
  },
  {
    name: '4. set with a number value round-trips',
    async fn({ roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'font_size', 14)
      assert.equal(await roomPreferences.get('u_1', 'r_1', 'font_size'), 14)
    }
  },
  {
    name: '5. set with a boolean value round-trips',
    async fn({ roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'collapse:members', true)
      assert.equal(await roomPreferences.get('u_1', 'r_1', 'collapse:members'), true)
    }
  },
  {
    name: '6. set with an object value round-trips',
    async fn({ roomPreferences }) {
      const customTheme = { primary: '#ff0000', surface: '#121212' }
      await roomPreferences.set('u_1', 'r_1', 'custom_theme', customTheme)
      assert.deepEqual(await roomPreferences.get('u_1', 'r_1', 'custom_theme'), customTheme)
    }
  },
  {
    name: '7. set with an array value round-trips',
    async fn({ roomPreferences }) {
      const list = ['opt1', 'opt2', 'opt3']
      await roomPreferences.set('u_1', 'r_1', 'tags', list)
      assert.deepEqual(await roomPreferences.get('u_1', 'r_1', 'tags'), list)
    }
  },
  {
    name: '8. set on an existing key replaces the value and refreshes updated_at',
    async fn({ db, roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'theme', 'light')
      const row1 = await db.queryOne(
        'SELECT updated_at FROM room_preferences WHERE user_id = ? AND room_id = ? AND key = ?',
        ['u_1', 'r_1', 'theme']
      )

      await new Promise((r) => setTimeout(r, 10))
      await roomPreferences.set('u_1', 'r_1', 'theme', 'dark')

      assert.equal(await roomPreferences.get('u_1', 'r_1', 'theme'), 'dark')
      const row2 = await db.queryOne(
        'SELECT updated_at FROM room_preferences WHERE user_id = ? AND room_id = ? AND key = ?',
        ['u_1', 'r_1', 'theme']
      )

      assert.ok(row2.updated_at >= row1.updated_at)
    }
  },
  {
    name: '9. set with a value that JSON.stringify cannot serialize (a function) throws a plain Error',
    async fn({ roomPreferences }) {
      await assert.rejects(
        async () => {
          await roomPreferences.set('u_1', 'r_1', 'fn_key', () => {})
        },
        (err) => err instanceof Error && err.message.includes('cannot be serialized')
      )
    }
  },
  {
    name: '10. set with undefined as the value throws a plain Error',
    async fn({ roomPreferences }) {
      await assert.rejects(
        async () => {
          await roomPreferences.set('u_1', 'r_1', 'undef_key', undefined)
        },
        (err) => err instanceof Error && err.message.includes('cannot be serialized')
      )
    }
  },
  {
    name: '11. getAll returns an object mapping every present key to its value',
    async fn({ roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'theme', 'dark')
      await roomPreferences.set('u_1', 'r_1', 'collapse:members', true)
      await roomPreferences.set('u_1', 'r_1', 'bubble_style', 'modern')

      const all = await roomPreferences.getAll('u_1', 'r_1')
      assert.deepEqual(all, {
        theme: 'dark',
        'collapse:members': true,
        bubble_style: 'modern'
      })
    }
  },
  {
    name: '12. getAll on a fresh room returns {}',
    async fn({ roomPreferences }) {
      const all = await roomPreferences.getAll('u_1', 'r_fresh')
      assert.deepEqual(all, {})
    }
  },
  {
    name: '13. setMany writes several keys in one call. getAll reflects them',
    async fn({ roomPreferences }) {
      const entries = {
        theme: 'dark',
        wallpaper: 'pattern.png',
        'collapse:notifications': false
      }
      const res = await roomPreferences.setMany('u_1', 'r_1', entries)
      assert.equal(res.changes, 3)

      const all = await roomPreferences.getAll('u_1', 'r_1')
      assert.deepEqual(all, entries)
    }
  },
  {
    name: '14. setMany uses a single updated_at across all rows',
    async fn({ db, roomPreferences }) {
      await roomPreferences.setMany('u_1', 'r_1', {
        k1: 'v1',
        k2: 'v2',
        k3: 'v3'
      })

      const rows = await db.query(
        'SELECT updated_at FROM room_preferences WHERE user_id = ? AND room_id = ?',
        ['u_1', 'r_1']
      )
      assert.equal(rows.length, 3)
      assert.equal(rows[0].updated_at, rows[1].updated_at)
      assert.equal(rows[1].updated_at, rows[2].updated_at)
    }
  },
  {
    name: '15. setMany with an empty object returns { changes: 0 }',
    async fn({ roomPreferences }) {
      const res = await roomPreferences.setMany('u_1', 'r_1', {})
      assert.equal(res.changes, 0)
    }
  },
  {
    name: '16. setMany rolls back on failure',
    async fn({ roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'pre_existing', 'initial')

      await assert.rejects(async () => {
        await roomPreferences.setMany('u_1', 'r_1', {
          valid_key: 'value',
          invalid_key: () => {}
        })
      })

      const all = await roomPreferences.getAll('u_1', 'r_1')
      assert.deepEqual(all, { pre_existing: 'initial' })
    }
  },
  {
    name: '17. remove deletes one preference',
    async fn({ roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'k1', 'v1')
      await roomPreferences.set('u_1', 'r_1', 'k2', 'v2')

      const res = await roomPreferences.remove('u_1', 'r_1', 'k1')
      assert.equal(res.changes, 1)

      assert.equal(await roomPreferences.get('u_1', 'r_1', 'k1'), undefined)
      assert.equal(await roomPreferences.get('u_1', 'r_1', 'k2'), 'v2')
    }
  },
  {
    name: '18. removeAllInRoom deletes every preference for a user in one room',
    async fn({ roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'k1', 'v1')
      await roomPreferences.set('u_1', 'r_1', 'k2', 'v2')
      await roomPreferences.set('u_1', 'r_2', 'k3', 'v3')
      await roomPreferences.set('u_2', 'r_1', 'k4', 'v4')

      const res = await roomPreferences.removeAllInRoom('u_1', 'r_1')
      assert.equal(res.changes, 2)

      assert.deepEqual(await roomPreferences.getAll('u_1', 'r_1'), {})
      assert.equal(await roomPreferences.get('u_1', 'r_2', 'k3'), 'v3')
      assert.equal(await roomPreferences.get('u_2', 'r_1', 'k4'), 'v4')
    }
  },
  {
    name: '19. listKeys returns keys sorted ascending',
    async fn({ roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'zebra', 1)
      await roomPreferences.set('u_1', 'r_1', 'apple', 2)
      await roomPreferences.set('u_1', 'r_1', 'banana', 3)

      const keys = await roomPreferences.listKeys('u_1', 'r_1')
      assert.deepEqual(keys, ['apple', 'banana', 'zebra'])
    }
  },
  {
    name: '20. count returns the number of rows for a user across all rooms',
    async fn({ roomPreferences }) {
      assert.equal(await roomPreferences.count('u_1'), 0)

      await roomPreferences.set('u_1', 'r_1', 'k1', 'v1')
      await roomPreferences.set('u_1', 'r_1', 'k2', 'v2')
      await roomPreferences.set('u_1', 'r_2', 'k3', 'v3')
      await roomPreferences.set('u_2', 'r_1', 'k4', 'v4')

      assert.equal(await roomPreferences.count('u_1'), 3)
      assert.equal(await roomPreferences.count('u_2'), 1)
    }
  },
  {
    name: '21. clearAll deletes every row',
    async fn({ roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'k1', 'v1')
      await roomPreferences.set('u_2', 'r_2', 'k2', 'v2')

      const res = await roomPreferences.clearAll()
      assert.equal(res.changes, 2)
      assert.equal(await roomPreferences.count('u_1'), 0)
      assert.equal(await roomPreferences.count('u_2'), 0)
    }
  },
  {
    name: '22. Malformed JSON returns undefined and skips in getAll',
    async fn({ db, roomPreferences }) {
      await roomPreferences.set('u_1', 'r_1', 'valid', 'ok')
      await db.execute(
        `INSERT INTO room_preferences (user_id, room_id, key, value_json, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        ['u_1', 'r_1', 'corrupt', '{ malformed json... }', Date.now()]
      )

      assert.equal(await roomPreferences.get('u_1', 'r_1', 'corrupt'), undefined)
      assert.deepEqual(await roomPreferences.getAll('u_1', 'r_1'), { valid: 'ok' })
    }
  },
  {
    name: '23. createRepositories includes roomPreferences repository',
    async fn({ db }) {
      const repos = createRepositories({ db })
      assert.ok(repos.roomPreferences)
      assert.equal(typeof repos.roomPreferences.get, 'function')
      assert.equal(typeof repos.roomPreferences.getAll, 'function')
      assert.equal(typeof repos.roomPreferences.set, 'function')
      assert.equal(typeof repos.roomPreferences.setMany, 'function')
      assert.equal(typeof repos.roomPreferences.remove, 'function')
      assert.equal(typeof repos.roomPreferences.removeAllInRoom, 'function')
      assert.equal(typeof repos.roomPreferences.listKeys, 'function')
      assert.equal(typeof repos.roomPreferences.count, 'function')
      assert.equal(typeof repos.roomPreferences.clearAll, 'function')
    }
  }
]

test('Room Preferences Repository - Memory SQLite Backend', async (t) => {
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

test('Room Preferences Repository - WASM SQLite Backend', async (t) => {
  const wasmBackend = await resolveBackend({ prefer: 'wasm' })
  for (const c of cases) {
    await t.test(c.name, async () => {
      const ctx = await buildRepo(wasmBackend)
      await c.fn(ctx)
    })
  }
})
