/**
 * Raw server representation of a room.
 *
 * @typedef {object} RawRoom
 * @property {string} id - The room id.
 * @property {string} [display_name] - Optional. Present when the
 *   server exposes it. snake_case to match server responses.
 * @property {number} [member_count] - Optional. Present when the
 *   server exposes it.
 */

/**
 * Maps a raw room entry to a normalized `RoomRef`.
 *
 * @param {RawRoom} raw - The raw room object.
 * @returns {RoomRef} The mapped room reference.
 */
function mapRoom (raw) {
  return {
    id: raw.id,
    displayName: typeof raw.display_name === 'string' ? raw.display_name : null,
    memberCount: typeof raw.member_count === 'number' ? raw.member_count : 0
  }
}

/**
 * Creates the `ctx.rooms` store.
 *
 * Every call fetches the current room list from the injected
 * `fetchRoomList`. There is no cache. The method that resolves rooms
 * is the caller's responsibility.
 *
 * The `RoomRef.displayName` and `RoomRef.memberCount` fields are
 * best-effort: the server may not expose them for the bot's mode. See
 * the task's Context section for the spec gaps.
 *
 * @param {object} deps - Dependencies.
 * @param {() => Promise<RawRoom[]>} deps.fetchRoomList - Resolves the
 *   raw list of rooms the bot is granted into. The shape is the raw
 *   server response. Injected because no bot-facing endpoint is
 *   specified.
 * @param {import('../diagnostics/logger.js').Logger} [deps.logger] -
 *   Optional logger.
 * @returns {RoomsStore} The store.
 */
export function createRoomsStore ({ fetchRoomList, logger }) {
  return {
    /**
     * Lists all rooms the bot is currently granted into.
     *
     * @returns {Promise<RoomRef[]>}
     */
    async list () {
      const rawList = await fetchRoomList()
      if (!Array.isArray(rawList)) {
        logger?.warn('fetchRoomList returned non-array response', {
          meta: { reason: 'non_array_response' }
        })
        return []
      }

      /** @type {RoomRef[]} */
      const result = []
      for (const entry of rawList) {
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.length === 0) {
          logger?.warn('Skipping room entry with missing or invalid id', {
            meta: { reason: 'missing_room_id' }
          })
          continue
        }
        result.push(mapRoom(/** @type {RawRoom} */ (entry)))
      }

      return result
    },

    /**
     * Looks up a room by ID.
     *
     * @param {string} roomId - The ID of the room.
     * @returns {Promise<RoomRef | null>}
     */
    async get (roomId) {
      if (typeof roomId !== 'string') {
        throw new TypeError(`roomId must be a non-empty string; received ${typeof roomId}`)
      }
      if (roomId.length === 0) {
        throw new TypeError('roomId must be a non-empty string; received empty string')
      }

      const rooms = await this.list()
      const found = rooms.find((r) => r.id === roomId)
      return found ?? null
    }
  }
}
