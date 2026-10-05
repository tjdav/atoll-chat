import {
  PublisherKeyUnavailableError,
  PublisherKeyVerificationFailedError
} from '../../errors.js'
import { verify, encodePublisherKeyPayload } from './signing.js'

/**
 * Verifies a publisher key publication's signature.
 *
 * The signature must be a valid Ed25519 signature over
 * `encodePublisherKeyPayload({ roomId, epoch, publisherPublicKey })`,
 * produced by the signer's identity key.
 *
 * @param {object} publication - The publication object to verify.
 * @param {string} publication.roomId - The room id.
 * @param {number} publication.epoch - The MLS epoch number.
 * @param {Uint8Array} publication.publisherPublicKey - The 32-byte publisher public key.
 * @param {string} publication.signerUserId - The signer's user id.
 * @param {Uint8Array} publication.signature - The 64-byte signature.
 * @param {Uint8Array} signerPubkey - The signer's 32-byte Ed25519 identity public key.
 * @returns {{ verified: boolean, reason?: string }} - Verification result.
 */
export function verifyPublication (publication, signerPubkey) {
  if (
    !publication ||
    !(publication.publisherPublicKey instanceof Uint8Array) ||
    publication.publisherPublicKey.length !== 32
  ) {
    return {
      verified: false,
      reason: 'publisher_key_length'
    }
  }
  if (
    !(publication.signature instanceof Uint8Array) ||
    publication.signature.length !== 64
  ) {
    return {
      verified: false,
      reason: 'signature_length'
    }
  }
  if (
    !(signerPubkey instanceof Uint8Array) ||
    signerPubkey.length !== 32
  ) {
    return {
      verified: false,
      reason: 'signer_key_length'
    }
  }

  try {
    const payload = encodePublisherKeyPayload({
      roomId: publication.roomId,
      epoch: publication.epoch,
      publisherPublicKey: publication.publisherPublicKey
    })
    const isValid = verify(publication.signature, payload, signerPubkey)
    if (isValid) {
      return { verified: true }
    }
    return {
      verified: false,
      reason: 'signature_invalid'
    }
  } catch {
    return {
      verified: false,
      reason: 'signature_invalid'
    }
  }
}

/**
 * In-memory cache of publisher keys per room per epoch.
 *
 * The cache stores publications received from the server (via
 * `room.publisher_key_updated` events or REST fetches) and verifies
 * them against the signer's identity key. Verification happens on
 * insertion and again after a re-verification trigger such as
 * `bot.keys_rotated` or `kt.snapshot`.
 *
 * Eviction is LRU across rooms with a default limit of 100. Within a
 * room, only the current epoch and the two most recent prior epochs
 * are retained.
 */
export class PublisherKeyCache {
  /**
   * @param {object} [options] - Options for the cache.
   * @param {number} [options.maxRooms=100] - Maximum number of rooms to cache.
   * @param {(userId: string) => Promise<Uint8Array | null>} [options.lookupSignerPubkey] -
   *   Resolves a user id to their 32-byte Ed25519 identity public key.
   *   Returns null when the user is unknown. Parameterized for testing.
   * @param {() => number} [options.now=Date.now] - The clock. Returns
   *   milliseconds since the epoch. Parameterized for testing.
   */
  constructor ({ maxRooms = 100, lookupSignerPubkey = async () => null, now = Date.now } = {}) {
    this._maxRooms = maxRooms
    this._lookupSignerPubkey = lookupSignerPubkey
    this._now = now

    /**
     * @type {Map<string, { currentEpoch: number | undefined, keys: Map<number, { publisherPublicKey: Uint8Array, signerUserId: string, signature: Uint8Array, verifiedAt: number | null }> }>}
     */
    this._rooms = new Map()
  }

  /**
   * Moves a room to the end of Map iteration order for LRU tracking.
   *
   * @private
   * @param {string} roomId - The room id to touch.
   */
  _touchRoom (roomId) {
    const room = this._rooms.get(roomId)
    if (room) {
      this._rooms.delete(roomId)
      this._rooms.set(roomId, room)
    }
  }

  /**
   * Evicts expired epochs for a room, retaining current epoch and two prior.
   *
   * @private
   * @param {{ currentEpoch: number | undefined, keys: Map<number, { publisherPublicKey: Uint8Array, signerUserId: string, signature: Uint8Array, verifiedAt: number | null }> }} room - The room state object.
   */
  _evictExpiredEpochs (room) {
    if (room.currentEpoch === undefined) {
      return
    }
    const current = room.currentEpoch
    const priorEpochs = Array.from(room.keys.keys())
      .filter((e) => e < current)
      .sort((a, b) => b - a)
    const keepPriors = new Set(priorEpochs.slice(0, 2))

    for (const epoch of room.keys.keys()) {
      if (epoch < current && !keepPriors.has(epoch)) {
        room.keys.delete(epoch)
      }
    }
  }

  /**
   * Records a publisher key publication. Verifies the signature
   * immediately. Returns the verification result.
   *
   * @param {object} publication - The publication object.
   * @param {string} publication.roomId - The room id.
   * @param {number} publication.epoch - The MLS epoch number.
   * @param {Uint8Array} publication.publisherPublicKey - 32 bytes.
   * @param {string} publication.signerUserId - The signer's user id.
   * @param {Uint8Array} publication.signature - 64 bytes.
   * @returns {Promise<{ verified: boolean, reason?: string }>} The
   *   verification result. When `verified` is false, `reason` names
   *   the cause.
   */
  async recordPublication ({ roomId, epoch, publisherPublicKey, signerUserId, signature }) {
    if (typeof roomId !== 'string' || roomId.length === 0) {
      throw new Error('roomId must be a non-empty string')
    }
    if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) {
      throw new Error('epoch must be a non-negative integer')
    }
    if (!(publisherPublicKey instanceof Uint8Array) || publisherPublicKey.length !== 32) {
      throw new Error('publisherPublicKey must be a Uint8Array of length 32')
    }
    if (!(signature instanceof Uint8Array) || signature.length !== 64) {
      throw new Error('signature must be a Uint8Array of length 64')
    }
    if (typeof signerUserId !== 'string' || signerUserId.length === 0) {
      throw new Error('signerUserId must be a non-empty string')
    }

    let room = this._rooms.get(roomId)
    if (!room) {
      if (this._rooms.size >= this._maxRooms) {
        const oldestRoomId = this._rooms.keys().next().value
        if (oldestRoomId !== undefined) {
          this._rooms.delete(oldestRoomId)
        }
      }
      room = {
        currentEpoch: undefined,
        keys: new Map()
      }
      this._rooms.set(roomId, room)
    } else {
      this._touchRoom(roomId)
    }

    const signerPubkey = await this._lookupSignerPubkey(signerUserId)
    let verifiedAt = null
    /** @type {{ verified: boolean, reason?: string }} */
    let result = {
      verified: false,
      reason: 'signer_unknown'
    }

    if (signerPubkey !== null && signerPubkey !== undefined) {
      result = verifyPublication(
        {
          roomId,
          epoch,
          publisherPublicKey,
          signerUserId,
          signature
        },
        signerPubkey
      )
      if (result.verified) {
        verifiedAt = this._now()
      }
    }

    room.keys.set(epoch, {
      publisherPublicKey: new Uint8Array(publisherPublicKey),
      signerUserId,
      signature: new Uint8Array(signature),
      verifiedAt
    })

    if (room.currentEpoch === undefined || epoch > room.currentEpoch) {
      room.currentEpoch = epoch
    }

    this._evictExpiredEpochs(room)

    return result
  }

  /**
   * Returns the publisher key for a room. When `epoch` is omitted,
   * returns the current epoch's key.
   *
   * @param {string} roomId - The room id.
   * @param {number} [epoch] - Optional epoch number.
   * @returns {Promise<Uint8Array>} The 32-byte publisher public key.
   * @throws {PublisherKeyUnavailableError} When no cached entry exists
   *   for the requested (room, epoch).
   * @throws {PublisherKeyVerificationFailedError} When the entry
   *   exists but its signature has not been verified.
   */
  async getPublisherKey (roomId, epoch) {
    const room = this._rooms.get(roomId)
    if (!room) {
      throw new PublisherKeyUnavailableError('Room not cached')
    }

    const targetEpoch = epoch !== undefined ? epoch : room.currentEpoch
    if (targetEpoch === undefined) {
      throw new PublisherKeyUnavailableError('No current epoch for room')
    }

    const entry = room.keys.get(targetEpoch)
    if (!entry) {
      throw new PublisherKeyUnavailableError(`Publisher key unavailable for room ${roomId} epoch ${targetEpoch}`)
    }

    if (entry.verifiedAt === null) {
      throw new PublisherKeyVerificationFailedError(`Publisher key unverified for room ${roomId} epoch ${targetEpoch}`)
    }

    this._touchRoom(roomId)

    return new Uint8Array(entry.publisherPublicKey)
  }

  /**
   * Returns the current epoch for a room, or undefined when the room
   * is not cached.
   *
   * @param {string} roomId - The room id.
   * @returns {number | undefined} The current epoch or undefined.
   */
  getCurrentEpoch (roomId) {
    const room = this._rooms.get(roomId)
    return room?.currentEpoch
  }

  /**
   * Records an MLS epoch advance from an `epoch.updated` event or a
   * message event's `epoch` field. Member-mode bots receive these
   * events; write-only and observer modes typically do not.
   *
   * @param {string} roomId - The room id.
   * @param {number} epoch - The new epoch number.
   */
  recordEpoch (roomId, epoch) {
    if (typeof roomId !== 'string' || roomId.length === 0) {
      throw new Error('roomId must be a non-empty string')
    }
    if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) {
      throw new Error('epoch must be a non-negative integer')
    }

    let room = this._rooms.get(roomId)
    if (!room) {
      if (this._rooms.size >= this._maxRooms) {
        const oldestRoomId = this._rooms.keys().next().value
        if (oldestRoomId !== undefined) {
          this._rooms.delete(oldestRoomId)
        }
      }
      room = {
        currentEpoch: epoch,
        keys: new Map()
      }
      this._rooms.set(roomId, room)
      return
    }

    this._touchRoom(roomId)

    if (room.currentEpoch === undefined || epoch > room.currentEpoch) {
      room.currentEpoch = epoch
      this._evictExpiredEpochs(room)
    }
  }

  /**
   * Marks every cached entry as unverified. Subsequent
   * `getPublisherKey` calls throw until re-verification runs.
   *
   * Used on `bot.keys_rotated` and `kt.snapshot`.
   */
  markAllStale () {
    for (const room of this._rooms.values()) {
      for (const entry of room.keys.values()) {
        entry.verifiedAt = null
      }
    }
  }

  /**
   * Schedules re-verification of every cached entry. Re-runs the
   * signature check against each entry's stored signer key. Updates
   * `verifiedAt` on success, leaves it null on failure.
   *
   * @returns {Promise<void>}
   */
  async reverifyAll () {
    for (const [roomId, room] of this._rooms) {
      for (const [epoch, entry] of room.keys) {
        try {
          const signerPubkey = await this._lookupSignerPubkey(entry.signerUserId)
          if (signerPubkey !== null && signerPubkey !== undefined) {
            const result = verifyPublication(
              {
                roomId,
                epoch,
                publisherPublicKey: entry.publisherPublicKey,
                signerUserId: entry.signerUserId,
                signature: entry.signature
              },
              signerPubkey
            )
            if (result.verified) {
              entry.verifiedAt = this._now()
            } else {
              entry.verifiedAt = null
            }
          } else {
            entry.verifiedAt = null
          }
        } catch {
          entry.verifiedAt = null
        }
      }
    }
  }

  /**
   * Evicts a room from the cache entirely. Used when the bot is
   * revoked from a room or the runtime shuts down.
   *
   * @param {string} roomId - The room id to evict.
   */
  evictRoom (roomId) {
    this._rooms.delete(roomId)
  }

  /**
   * The number of rooms currently cached.
   *
   * @returns {number}
   */
  get size () {
    return this._rooms.size
  }
}
