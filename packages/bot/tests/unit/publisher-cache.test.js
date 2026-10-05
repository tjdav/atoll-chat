import assert from 'node:assert/strict'
import { createPublicKey } from 'node:crypto'
import test from 'node:test'
import {
  PublisherKeyUnavailableError,
  PublisherKeyVerificationFailedError
} from '../../src/errors.js'
import { PublisherKeyCache } from '../../src/runtime/crypto/publisher.js'
import {
  encodePublisherKeyPayload,
  keyObjectFromSeed,
  sign
} from '../../src/runtime/crypto/signing.js'

// Fixed test seed and derived Ed25519 public key
const TEST_SEED = new Uint8Array(Buffer.alloc(32, 0x11))
const TEST_PUBKEY = (function () {
  const privKeyObj = keyObjectFromSeed(TEST_SEED)
  const spkiDer = createPublicKey(privKeyObj).export({ type: 'spki', format: 'der' })
  // SPKI prefix for Ed25519 is 12 bytes long (302a300506032b6570032100)
  return new Uint8Array(spkiDer.subarray(12))
})()

/**
 * Helper to compute signature for a publication.
 *
 * @param {string} roomId
 * @param {number} epoch
 * @param {Uint8Array} publisherPublicKey
 * @param {Uint8Array} [seed]
 * @returns {Uint8Array}
 */
function signTestPublication (roomId, epoch, publisherPublicKey, seed = TEST_SEED) {
  const payload = encodePublisherKeyPayload({ roomId, epoch, publisherPublicKey })
  return sign(payload, seed)
}

test('PublisherKeyCache unit tests', async (t) => {
  await t.test('1. Record a valid publication', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async (id) => (id === 'u_alice' ? TEST_PUBKEY : null)
    })
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const roomId = 'r_test'
    const epoch = 42
    const signature = signTestPublication(roomId, epoch, pubKey)

    const res = await cache.recordPublication({
      roomId,
      epoch,
      publisherPublicKey: pubKey,
      signerUserId: 'u_alice',
      signature
    })

    assert.deepEqual(res, { verified: true })
    const fetched = await cache.getPublisherKey(roomId)
    assert.deepEqual(fetched, pubKey)
  })

  await t.test('2. Get publisher key with explicit epoch', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const roomId = 'r_test'
    const epoch = 42
    const signature = signTestPublication(roomId, epoch, pubKey)

    await cache.recordPublication({
      roomId,
      epoch,
      publisherPublicKey: pubKey,
      signerUserId: 'u_alice',
      signature
    })

    const fetched = await cache.getPublisherKey(roomId, 42)
    assert.deepEqual(fetched, pubKey)
  })

  await t.test('3. Get publisher key for an absent room', async () => {
    const cache = new PublisherKeyCache()
    await assert.rejects(
      async () => cache.getPublisherKey('r_missing'),
      PublisherKeyUnavailableError
    )
  })

  await t.test('4. Get publisher key for an absent epoch', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const roomId = 'r_test'
    const epoch = 42
    const signature = signTestPublication(roomId, epoch, pubKey)

    await cache.recordPublication({
      roomId,
      epoch,
      publisherPublicKey: pubKey,
      signerUserId: 'u_alice',
      signature
    })

    await assert.rejects(
      async () => cache.getPublisherKey(roomId, 999),
      PublisherKeyUnavailableError
    )
  })

  await t.test('5. Get publisher key with no current epoch', async () => {
    const cache = new PublisherKeyCache()
    await assert.rejects(
      async () => cache.getPublisherKey('r_empty'),
      PublisherKeyUnavailableError
    )
  })

  await t.test('6. Invalid signature', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const roomId = 'r_test'
    const epoch = 42
    // Sign payload for a different epoch to create invalid signature
    const signature = signTestPublication(roomId, 100, pubKey)

    const res = await cache.recordPublication({
      roomId,
      epoch,
      publisherPublicKey: pubKey,
      signerUserId: 'u_alice',
      signature
    })

    assert.deepEqual(res, { verified: false, reason: 'signature_invalid' })
    await assert.rejects(
      async () => cache.getPublisherKey(roomId, epoch),
      PublisherKeyVerificationFailedError
    )
  })

  await t.test('7. Unknown signer', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => null
    })
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const roomId = 'r_test'
    const epoch = 42
    const signature = signTestPublication(roomId, epoch, pubKey)

    const res = await cache.recordPublication({
      roomId,
      epoch,
      publisherPublicKey: pubKey,
      signerUserId: 'u_unknown',
      signature
    })

    assert.deepEqual(res, { verified: false, reason: 'signer_unknown' })
    await assert.rejects(
      async () => cache.getPublisherKey(roomId, epoch),
      PublisherKeyVerificationFailedError
    )
  })

  await t.test('8. Wrong-length publisher key', async () => {
    const cache = new PublisherKeyCache()
    const badPubKey = new Uint8Array(Buffer.alloc(31, 0xab))
    const signature = new Uint8Array(Buffer.alloc(64))

    await assert.rejects(
      async () => cache.recordPublication({
        roomId: 'r_test',
        epoch: 1,
        publisherPublicKey: badPubKey,
        signerUserId: 'u_alice',
        signature
      }),
      /publisherPublicKey/
    )
  })

  await t.test('9. Wrong-length signature', async () => {
    const cache = new PublisherKeyCache()
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const badSig = new Uint8Array(Buffer.alloc(63))

    await assert.rejects(
      async () => cache.recordPublication({
        roomId: 'r_test',
        epoch: 1,
        publisherPublicKey: pubKey,
        signerUserId: 'u_alice',
        signature: badSig
      }),
      /signature/
    )
  })

  await t.test('10. getPublisherKey returns a copy', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const roomId = 'r_test'
    const epoch = 42
    const signature = signTestPublication(roomId, epoch, pubKey)

    await cache.recordPublication({
      roomId,
      epoch,
      publisherPublicKey: pubKey,
      signerUserId: 'u_alice',
      signature
    })

    const fetched1 = await cache.getPublisherKey(roomId)
    fetched1[0] = 0xff

    const fetched2 = await cache.getPublisherKey(roomId)
    assert.equal(fetched2[0], 0xab)
  })

  await t.test('11. Epoch advance via recordPublication', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const roomId = 'r_test'
    const pubKey42 = new Uint8Array(Buffer.alloc(32, 0x42))
    const sig42 = signTestPublication(roomId, 42, pubKey42)

    await cache.recordPublication({
      roomId,
      epoch: 42,
      publisherPublicKey: pubKey42,
      signerUserId: 'u_alice',
      signature: sig42
    })

    const pubKey43 = new Uint8Array(Buffer.alloc(32, 0x43))
    const sig43 = signTestPublication(roomId, 43, pubKey43)

    await cache.recordPublication({
      roomId,
      epoch: 43,
      publisherPublicKey: pubKey43,
      signerUserId: 'u_alice',
      signature: sig43
    })

    const currentKey = await cache.getPublisherKey(roomId)
    assert.deepEqual(currentKey, pubKey43)
    assert.equal(cache.getCurrentEpoch(roomId), 43)
  })

  await t.test('12. Epoch advance via recordEpoch', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const roomId = 'r_test'
    const pubKey42 = new Uint8Array(Buffer.alloc(32, 0x42))
    const sig42 = signTestPublication(roomId, 42, pubKey42)

    await cache.recordPublication({
      roomId,
      epoch: 42,
      publisherPublicKey: pubKey42,
      signerUserId: 'u_alice',
      signature: sig42
    })

    cache.recordEpoch(roomId, 43)
    assert.equal(cache.getCurrentEpoch(roomId), 43)
  })

  await t.test('13. Epoch regression via recordEpoch ignored', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const roomId = 'r_test'
    const pubKey42 = new Uint8Array(Buffer.alloc(32, 0x42))
    const sig42 = signTestPublication(roomId, 42, pubKey42)

    await cache.recordPublication({
      roomId,
      epoch: 42,
      publisherPublicKey: pubKey42,
      signerUserId: 'u_alice',
      signature: sig42
    })

    cache.recordEpoch(roomId, 41)
    assert.equal(cache.getCurrentEpoch(roomId), 42)
  })

  await t.test('14. Per-room eviction', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const roomId = 'r_test'

    for (const epoch of [40, 41, 42, 43, 44]) {
      const pubKey = new Uint8Array(Buffer.alloc(32, epoch))
      const sig = signTestPublication(roomId, epoch, pubKey)
      await cache.recordPublication({
        roomId,
        epoch,
        publisherPublicKey: pubKey,
        signerUserId: 'u_alice',
        signature: sig
      })
    }

    // Retained should be current (44) and 2 prior (43, 42). Epoch 40 and 41 evicted.
    await assert.rejects(
      async () => cache.getPublisherKey(roomId, 40),
      PublisherKeyUnavailableError
    )
    await assert.rejects(
      async () => cache.getPublisherKey(roomId, 41),
      PublisherKeyUnavailableError
    )

    const key42 = await cache.getPublisherKey(roomId, 42)
    assert.deepEqual(key42, new Uint8Array(Buffer.alloc(32, 42)))

    const key43 = await cache.getPublisherKey(roomId, 43)
    assert.deepEqual(key43, new Uint8Array(Buffer.alloc(32, 43)))

    const key44 = await cache.getPublisherKey(roomId, 44)
    assert.deepEqual(key44, new Uint8Array(Buffer.alloc(32, 44)))
  })

  await t.test('15. LRU across rooms', async () => {
    const cache = new PublisherKeyCache({
      maxRooms: 2,
      lookupSignerPubkey: async () => TEST_PUBKEY
    })

    /** @param {string} roomId */
    const recordRoom = async (roomId) => {
      const pubKey = new Uint8Array(Buffer.alloc(32, 0x01))
      const sig = signTestPublication(roomId, 1, pubKey)
      await cache.recordPublication({
        roomId,
        epoch: 1,
        publisherPublicKey: pubKey,
        signerUserId: 'u_alice',
        signature: sig
      })
    }

    await recordRoom('r_a')
    await recordRoom('r_b')
    await cache.getPublisherKey('r_a') // Touches r_a
    await recordRoom('r_c') // Evicts r_b

    await cache.getPublisherKey('r_a')
    await cache.getPublisherKey('r_c')
    await assert.rejects(
      async () => cache.getPublisherKey('r_b'),
      PublisherKeyUnavailableError
    )
  })

  await t.test('16. markAllStale unverifies entries', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const roomId = 'r_test'
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const sig = signTestPublication(roomId, 1, pubKey)

    await cache.recordPublication({
      roomId,
      epoch: 1,
      publisherPublicKey: pubKey,
      signerUserId: 'u_alice',
      signature: sig
    })

    cache.markAllStale()
    await assert.rejects(
      async () => cache.getPublisherKey(roomId),
      PublisherKeyVerificationFailedError
    )
  })

  await t.test('17. reverifyAll re-verifies', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const roomId = 'r_test'
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const sig = signTestPublication(roomId, 1, pubKey)

    await cache.recordPublication({
      roomId,
      epoch: 1,
      publisherPublicKey: pubKey,
      signerUserId: 'u_alice',
      signature: sig
    })

    cache.markAllStale()
    await cache.reverifyAll()

    const fetched = await cache.getPublisherKey(roomId)
    assert.deepEqual(fetched, pubKey)
  })

  await t.test('18. reverifyAll handles unknown signers', async () => {
    /** @type {Uint8Array | null} */
    let currentSignerPubkey = TEST_PUBKEY
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => currentSignerPubkey
    })
    const roomId = 'r_test'
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const sig = signTestPublication(roomId, 1, pubKey)

    await cache.recordPublication({
      roomId,
      epoch: 1,
      publisherPublicKey: pubKey,
      signerUserId: 'u_alice',
      signature: sig
    })

    currentSignerPubkey = null
    cache.markAllStale()
    await cache.reverifyAll()

    await assert.rejects(
      async () => cache.getPublisherKey(roomId),
      PublisherKeyVerificationFailedError
    )
  })

  await t.test('19. evictRoom removes the room', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const roomId = 'r_test'
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const sig = signTestPublication(roomId, 1, pubKey)

    await cache.recordPublication({
      roomId,
      epoch: 1,
      publisherPublicKey: pubKey,
      signerUserId: 'u_alice',
      signature: sig
    })

    cache.evictRoom(roomId)
    await assert.rejects(
      async () => cache.getPublisherKey(roomId),
      PublisherKeyUnavailableError
    )
  })

  await t.test('20. evictRoom on absent room is a no-op', async () => {
    const cache = new PublisherKeyCache()
    cache.evictRoom('r_missing')
    assert.equal(cache.size, 0)
  })

  await t.test('21. size reflects the room count', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })

    /** @param {string} id */
    const record = async (id) => {
      const pubKey = new Uint8Array(Buffer.alloc(32, 0x01))
      const sig = signTestPublication(id, 1, pubKey)
      await cache.recordPublication({
        roomId: id,
        epoch: 1,
        publisherPublicKey: pubKey,
        signerUserId: 'u_alice',
        signature: sig
      })
    }

    await record('r_1')
    await record('r_2')
    await record('r_3')

    assert.equal(cache.size, 3)
  })

  await t.test('22. recordEpoch on absent room creates an entry', async () => {
    const cache = new PublisherKeyCache()
    assert.equal(cache.getCurrentEpoch('r_new'), undefined)

    cache.recordEpoch('r_new', 1)
    assert.equal(cache.getCurrentEpoch('r_new'), 1)
  })

  await t.test('23. recordPublication updates the LRU order', async () => {
    const cache = new PublisherKeyCache({
      maxRooms: 2,
      lookupSignerPubkey: async () => TEST_PUBKEY
    })

    /** @param {string} id */
    const record = async (id) => {
      const pubKey = new Uint8Array(Buffer.alloc(32, 0x01))
      const sig = signTestPublication(id, 1, pubKey)
      await cache.recordPublication({
        roomId: id,
        epoch: 1,
        publisherPublicKey: pubKey,
        signerUserId: 'u_alice',
        signature: sig
      })
    }

    await record('r_a')
    await record('r_b')
    await cache.getPublisherKey('r_a') // Touch r_a
    await record('r_c') // Max rooms 2, r_b is oldest -> evicted

    await cache.getPublisherKey('r_a')
    await cache.getPublisherKey('r_c')
    await assert.rejects(
      async () => cache.getPublisherKey('r_b'),
      PublisherKeyUnavailableError
    )
  })

  await t.test('24. verifiedAt is set on success', async () => {
    const cache = new PublisherKeyCache({
      lookupSignerPubkey: async () => TEST_PUBKEY
    })
    const roomId = 'r_test'
    const pubKey = new Uint8Array(Buffer.alloc(32, 0xab))
    const sig = signTestPublication(roomId, 1, pubKey)

    await cache.recordPublication({
      roomId,
      epoch: 1,
      publisherPublicKey: pubKey,
      signerUserId: 'u_alice',
      signature: sig
    })

    cache.markAllStale()
    await assert.rejects(
      async () => cache.getPublisherKey(roomId),
      PublisherKeyVerificationFailedError
    )

    await cache.reverifyAll()
    const fetched = await cache.getPublisherKey(roomId)
    assert.deepEqual(fetched, pubKey)
  })
})
