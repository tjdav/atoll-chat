import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runUserScopedSync } from '../../src/lib/sync/index.js'

function makeDeps(overrides = {}) {
  const calls = {
    metaGet: [],
    metaSet: [],
    apiGet: [],
    readStateUpsert: [],
    deviceNamesApplyBatch: [],
    starredItemsApplyBatch: []
  }

  const deps = {
    api: {
      get: async (path, opts) => {
        calls.apiGet.push({ path, opts })
        return {
          read_state: [],
          device_state: [],
          starred_items: [],
          user_preferences: [],
          max_seq: 0,
          full_resync_required: false
        }
      }
    },
    storage: {
      meta: {
        get: async (k) => {
          calls.metaGet.push(k)
          return undefined
        },
        set: async (k, v) => {
          calls.metaSet.push({ k, v })
        }
      }
    },
    repos: {
      readState: {
        upsert: async (params) => {
          calls.readStateUpsert.push(params)
          return { changes: 1 }
        }
      },
      deviceNames: {
        applyBatch: async (userId, rows) => {
          calls.deviceNamesApplyBatch.push({ userId, rows })
          return { applied: rows.length, skipped: 0 }
        }
      },
      starredItems: {
        applyBatch: async (userId, rows) => {
          calls.starredItemsApplyBatch.push({ userId, rows })
          return { applied: rows.length, skipped: 0 }
        }
      }
    },
    userId: 'u_me',
    ...overrides
  }

  return { deps, calls }
}

describe('runUserScopedSync', () => {
  it('1. fresh sync with no cursor fetches with since_seq: 0 and stores max_seq', async () => {
    const { deps, calls } = makeDeps({
      api: {
        get: async (path, opts) => {
          calls.apiGet.push({ path, opts })
          return { max_seq: 10, read_state: [], device_state: [], starred_items: [] }
        }
      }
    })

    const res = await runUserScopedSync(deps)

    assert.equal(calls.metaGet[0], 'last_user_seq')
    assert.deepEqual(calls.apiGet[0], { path: '/users/me/sync', opts: { query: { since_seq: 0 } } })
    assert.deepEqual(calls.metaSet[0], { k: 'last_user_seq', v: 10 })
    assert.deepEqual(res, {
      applied: { readState: 0, deviceState: 0, starredItems: 0 },
      cursor: 10,
      fullResync: false
    })
  })

  it('2. subsequent sync with stored cursor passes stored cursor to query', async () => {
    const { deps, calls } = makeDeps({
      storage: {
        meta: {
          get: async () => 42,
          set: async (k, v) => calls.metaSet.push({ k, v })
        }
      },
      api: {
        get: async (path, opts) => {
          calls.apiGet.push({ path, opts })
          return { max_seq: 50 }
        }
      }
    })

    const res = await runUserScopedSync(deps)

    assert.deepEqual(calls.apiGet[0], { path: '/users/me/sync', opts: { query: { since_seq: 42 } } })
    assert.deepEqual(calls.metaSet[0], { k: 'last_user_seq', v: 50 })
    assert.equal(res.cursor, 50)
  })

  it('3. handles empty response smoothly', async () => {
    const { deps } = makeDeps()
    const res = await runUserScopedSync(deps)

    assert.deepEqual(res, {
      applied: { readState: 0, deviceState: 0, starredItems: 0 },
      cursor: 0,
      fullResync: false
    })
  })

  it('4. applies active read state rows via repos.readState.upsert', async () => {
    const { deps, calls } = makeDeps({
      api: {
        get: async () => ({
          read_state: [
            { room_id: 'r_1', last_read_message_id: 'm_10', user_seq: 1 },
            { room_id: 'r_2', last_read_message_id: 'm_20', user_seq: 2 }
          ],
          max_seq: 2
        })
      }
    })

    const res = await runUserScopedSync(deps)

    assert.equal(res.applied.readState, 2)
    assert.equal(calls.readStateUpsert.length, 2)
    assert.deepEqual(calls.readStateUpsert[0], { userId: 'u_me', roomId: 'r_1', lastReadMessageId: 'm_10' })
    assert.deepEqual(calls.readStateUpsert[1], { userId: 'u_me', roomId: 'r_2', lastReadMessageId: 'm_20' })
  })

  it('5. applies device state rows via repos.deviceNames.applyBatch', async () => {
    const { deps, calls } = makeDeps({
      api: {
        get: async () => ({
          device_state: [
            { device_id: 'd_1', encrypted_device_name: 'enc1', user_seq: 3 },
            { device_id: 'd_2', encrypted_device_name: 'enc2', user_seq: 4 }
          ],
          max_seq: 4
        })
      }
    })

    const res = await runUserScopedSync(deps)

    assert.equal(res.applied.deviceState, 2)
    assert.equal(calls.deviceNamesApplyBatch.length, 1)
    assert.equal(calls.deviceNamesApplyBatch[0].userId, 'u_me')
    assert.equal(calls.deviceNamesApplyBatch[0].rows.length, 2)
  })

  it('6. applies starred items rows via repos.starredItems.applyBatch', async () => {
    const { deps, calls } = makeDeps({
      api: {
        get: async () => ({
          starred_items: [
            { item_id: 'i_1', item_type: 'message', room_id: 'r_1', user_seq: 5, starred_at: '2026-01-01T00:00:00Z' }
          ],
          max_seq: 5
        })
      }
    })

    const res = await runUserScopedSync(deps)

    assert.equal(res.applied.starredItems, 1)
    assert.equal(calls.starredItemsApplyBatch.length, 1)
    assert.equal(calls.starredItemsApplyBatch[0].userId, 'u_me')
  })

  it('7. deleted_at on read state rows causes them to be skipped', async () => {
    const { deps, calls } = makeDeps({
      api: {
        get: async () => ({
          read_state: [
            { room_id: 'r_del', last_read_message_id: 'm_del', user_seq: 1, deleted_at: '2026-01-01T00:00:00Z' },
            { room_id: 'r_ok', last_read_message_id: 'm_ok', user_seq: 2 }
          ],
          max_seq: 2
        })
      }
    })

    const res = await runUserScopedSync(deps)

    assert.equal(res.applied.readState, 1)
    assert.equal(calls.readStateUpsert.length, 1)
    assert.equal(calls.readStateUpsert[0].roomId, 'r_ok')
  })

  it('8. starred_at ISO string is converted to milliseconds timestamp', async () => {
    const isoString = '2026-01-01T00:00:00.000Z'
    const expectedMs = Date.parse(isoString)

    const { deps, calls } = makeDeps({
      api: {
        get: async () => ({
          starred_items: [
            { item_id: 'i_1', item_type: 'message', room_id: 'r_1', user_seq: 1, starred_at: isoString }
          ],
          max_seq: 1
        })
      }
    })

    await runUserScopedSync(deps)

    assert.equal(calls.starredItemsApplyBatch[0].rows[0].starredAt, expectedMs)
  })

  it('9. full_resync_required: true resets last_user_seq to 0 and returns early', async () => {
    const { deps, calls } = makeDeps({
      api: {
        get: async () => ({ full_resync_required: true })
      }
    })

    const res = await runUserScopedSync(deps)

    assert.deepEqual(calls.metaSet[0], { k: 'last_user_seq', v: 0 })
    assert.deepEqual(res, {
      applied: { readState: 0, deviceState: 0, starredItems: 0 },
      cursor: 0,
      fullResync: true
    })
  })

  it('10. onProgress callback is invoked across phases when provided', async () => {
    const progressEvents = []
    const { deps } = makeDeps({
      onProgress: (phase, detail) => progressEvents.push({ phase, detail }),
      api: {
        get: async () => ({
          read_state: [{ room_id: 'r_1', last_read_message_id: 'm_1' }],
          max_seq: 5
        })
      }
    })

    await runUserScopedSync(deps)

    const phases = progressEvents.map((p) => p.phase)
    assert.deepEqual(phases, [
      'fetch',
      'apply-read-state',
      'apply-device-state',
      'apply-starred',
      'store-cursor'
    ])
  })

  it('11. onProgress is optional and sync executes without error if omitted', async () => {
    const { deps } = makeDeps()
    delete deps.onProgress

    const res = await runUserScopedSync(deps)
    assert.equal(res.cursor, 0)
  })

  it('12. network error from api.get propagates without setting cursor', async () => {
    const { deps, calls } = makeDeps({
      api: {
        get: async () => {
          throw new Error('Network failure')
        }
      }
    })

    await assert.rejects(
      async () => runUserScopedSync(deps),
      /Network failure/
    )
    assert.equal(calls.metaSet.length, 0)
  })

  it('13. application error in repository propagates without setting cursor', async () => {
    const { deps, calls } = makeDeps({
      api: {
        get: async () => ({
          read_state: [{ room_id: 'r_err', last_read_message_id: 'm_err' }]
        })
      },
      repos: {
        readState: {
          upsert: async () => {
            throw new Error('Database write lock error')
          }
        }
      }
    })

    await assert.rejects(
      async () => runUserScopedSync(deps),
      /Database write lock error/
    )
    assert.equal(calls.metaSet.length, 0)
  })

  it('14. userId parameter is passed through to repositories', async () => {
    const customUserId = 'u_custom_99'
    const { deps, calls } = makeDeps({
      userId: customUserId,
      api: {
        get: async () => ({
          read_state: [{ room_id: 'r_1', last_read_message_id: 'm_1' }],
          device_state: [{ device_id: 'd_1', encrypted_device_name: 'e_1', user_seq: 1 }],
          starred_items: [{ item_id: 'i_1', item_type: 'msg', room_id: 'r_1', user_seq: 1, starred_at: 100 }]
        })
      }
    })

    await runUserScopedSync(deps)

    assert.equal(calls.readStateUpsert[0].userId, customUserId)
    assert.equal(calls.deviceNamesApplyBatch[0].userId, customUserId)
    assert.equal(calls.starredItemsApplyBatch[0].userId, customUserId)
  })
})
