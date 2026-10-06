import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createRoomsStore } from '../../src/runtime/context/rooms.js'

/**
 * Helper to create a spy logger.
 *
 * @returns {{ logger: import('../../src/runtime/diagnostics/logger.js').Logger, warnings: Array<{ msg: string, meta?: any }> }}
 */
function makeSpyLogger () {
  /** @type {Array<{ msg: string, meta?: any }>} */
  const warnings = []
  const logger = /** @type {unknown} */ ({
    debug () {},
    info () {},
    warn (/** @type {string} */ msg, /** @type {any} */ meta) {
      warnings.push({ msg, meta })
    },
    error () {}
  })
  return { logger: /** @type {import('../../src/runtime/diagnostics/logger.js').Logger} */ (logger), warnings }
}

describe('RoomsStore unit tests', () => {
  it('1. List returns mapped rooms', async () => {
    const rawList = [
      { id: 'r_1', display_name: 'Room 1', member_count: 5 },
      { id: 'r_2', display_name: 'Room 2', member_count: 12 },
      { id: 'r_3', display_name: 'Room 3', member_count: 1 }
    ]
    const store = createRoomsStore({ fetchRoomList: async () => rawList })
    const rooms = await store.list()

    assert.equal(rooms.length, 3)
    assert.deepEqual(rooms[0], { id: 'r_1', displayName: 'Room 1', memberCount: 5 })
    assert.deepEqual(rooms[1], { id: 'r_2', displayName: 'Room 2', memberCount: 12 })
    assert.deepEqual(rooms[2], { id: 'r_3', displayName: 'Room 3', memberCount: 1 })
  })

  it('2. List maps missing display_name to null', async () => {
    const rawList = [{ id: 'r_1', member_count: 5 }]
    const store = createRoomsStore({ fetchRoomList: async () => rawList })
    const rooms = await store.list()

    assert.equal(rooms.length, 1)
    assert.deepEqual(rooms[0], { id: 'r_1', displayName: null, memberCount: 5 })
  })

  it('3. List maps missing member_count to 0', async () => {
    const rawList = [{ id: 'r_1', display_name: 'Room 1' }]
    const store = createRoomsStore({ fetchRoomList: async () => rawList })
    const rooms = await store.list()

    assert.equal(rooms.length, 1)
    assert.deepEqual(rooms[0], { id: 'r_1', displayName: 'Room 1', memberCount: 0 })
  })

  it('4. List skips entries without an id', async () => {
    const { logger, warnings } = makeSpyLogger()
    const rawList = /** @type {any[]} */ ([
      { display_name: 'X' },
      { id: 'r_valid', display_name: 'Valid' }
    ])
    const store = createRoomsStore({ fetchRoomList: async () => rawList, logger })
    const rooms = await store.list()

    assert.equal(rooms.length, 1)
    assert.equal(rooms[0]?.id, 'r_valid')
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0]?.meta?.meta?.reason, 'missing_room_id')
  })

  it('5. List skips entries with a non-string id', async () => {
    const { logger, warnings } = makeSpyLogger()
    const rawList = /** @type {any[]} */ ([
      { id: 123, display_name: 'Numeric ID' },
      { id: '', display_name: 'Empty ID' },
      { id: 'r_ok', display_name: 'OK' }
    ])
    const store = createRoomsStore({ fetchRoomList: async () => rawList, logger })
    const rooms = await store.list()

    assert.equal(rooms.length, 1)
    assert.equal(rooms[0]?.id, 'r_ok')
    assert.equal(warnings.length, 2)
  })

  it('6. Empty list returns []', async () => {
    const store = createRoomsStore({ fetchRoomList: async () => [] })
    const rooms = await store.list()

    assert.deepEqual(rooms, [])
  })

  it('7. Non-array response returns [] and logs a warning', async () => {
    const { logger, warnings } = makeSpyLogger()
    const store = createRoomsStore({ fetchRoomList: async () => /** @type {any} */ ({ error: 'bad shape' }), logger })
    const rooms = await store.list()

    assert.deepEqual(rooms, [])
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0]?.meta?.meta?.reason, 'non_array_response')
  })

  it('8. Get returns the matching room', async () => {
    const rawList = [
      { id: 'r_a', display_name: 'A' },
      { id: 'r_b', display_name: 'B' },
      { id: 'r_c', display_name: 'C' }
    ]
    const store = createRoomsStore({ fetchRoomList: async () => rawList })
    const room = await store.get('r_b')

    assert.deepEqual(room, { id: 'r_b', displayName: 'B', memberCount: 0 })
  })

  it('9. Get returns null for an absent room', async () => {
    const rawList = [{ id: 'r_a', display_name: 'A' }]
    const store = createRoomsStore({ fetchRoomList: async () => rawList })
    const room = await store.get('r_missing')

    assert.equal(room, null)
  })

  it('10. Get on an empty list returns null', async () => {
    const store = createRoomsStore({ fetchRoomList: async () => [] })
    const room = await store.get('r_any')

    assert.equal(room, null)
  })

  it('11. Get rejects non-string roomId', async () => {
    const store = createRoomsStore({ fetchRoomList: async () => [] })

    await assert.rejects(
      async () => {
        // @ts-expect-error testing invalid input
        await store.get(123)
      },
      TypeError
    )
  })

  it('12. Get rejects empty roomId', async () => {
    const store = createRoomsStore({ fetchRoomList: async () => [] })

    await assert.rejects(
      async () => {
        await store.get('')
      },
      TypeError
    )
  })

  it('13. Fetch rejection propagates from list', async () => {
    const fetchErr = new Error('network disconnect')
    const store = createRoomsStore({
      fetchRoomList: async () => {
        throw fetchErr
      }
    })

    await assert.rejects(
      async () => {
        await store.list()
      },
      (err) => err === fetchErr
    )
  })

  it('14. Fetch rejection propagates from get', async () => {
    const fetchErr = new Error('network disconnect')
    const store = createRoomsStore({
      fetchRoomList: async () => {
        throw fetchErr
      }
    })

    await assert.rejects(
      async () => {
        await store.get('r_1')
      },
      (err) => err === fetchErr
    )
  })

  it('15. No caching: two list() calls invoke fetchRoomList twice', async () => {
    let callCount = 0
    const store = createRoomsStore({
      fetchRoomList: async () => {
        callCount++
        return [{ id: `r_${callCount}` }]
      }
    })

    await store.list()
    await store.list()

    assert.equal(callCount, 2)
  })

  it('16. No caching: get() invokes fetchRoomList each time', async () => {
    let callCount = 0
    const store = createRoomsStore({
      fetchRoomList: async () => {
        callCount++
        return [{ id: 'r_target' }]
      }
    })

    await store.get('r_target')
    await store.get('r_target')

    assert.equal(callCount, 2)
  })

  it('17. Logger warns on non-array response', async () => {
    const { logger, warnings } = makeSpyLogger()
    const store = createRoomsStore({ fetchRoomList: async () => /** @type {any} */ (null), logger })
    await store.list()

    assert.equal(warnings.length, 1)
    assert.equal(warnings[0]?.msg, 'fetchRoomList returned non-array response')
  })

  it('18. Logger warns on skipped entry', async () => {
    const { logger, warnings } = makeSpyLogger()
    const store = createRoomsStore({
      fetchRoomList: async () => /** @type {any[]} */ ([
        { id: null },
        { id: 'r_valid' }
      ]),
      logger
    })
    await store.list()

    assert.equal(warnings.length, 1)
    assert.equal(warnings[0]?.msg, 'Skipping room entry with missing or invalid id')
  })
})
