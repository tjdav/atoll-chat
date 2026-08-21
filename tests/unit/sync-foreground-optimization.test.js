import { test } from 'node:test'
import assert from 'node:assert'
import sodium from 'libsodium-wrappers-sumo'

test('Sync Foreground Optimization & Event Avalanche Unit Tests', async (t) => {
  await sodium.ready

  const user1BoxKeypair = sodium.crypto_box_keypair()
  const user1PrivateBoxKeyB64 = sodium.to_base64(user1BoxKeypair.privateKey, sodium.base64_variants.ORIGINAL)

  const inviterBoxKeypair = sodium.crypto_box_keypair()

  const roomKey = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES)
  const roomKeyB64 = sodium.to_base64(roomKey, sodium.base64_variants.ORIGINAL)

  function createWrappedRoomKeyPayload ({
    roomId = 'room_101',
    wrappedBy = 'inviter_1',
    epochId = 1,
    updated = '2025-01-01 12:00:00.000Z'
  }) {
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES)
    const encryptedKeyBuffer = sodium.crypto_box_easy(
      roomKey,
      nonce,
      user1BoxKeypair.publicKey,
      inviterBoxKeypair.privateKey
    )

    return {
      room_id: roomId,
      wrapped_by: wrappedBy,
      encrypted_room_key: sodium.to_base64(encryptedKeyBuffer, sodium.base64_variants.ORIGINAL),
      key_nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
      epoch_id: epochId,
      role: 'member',
      updated
    }
  }

  await t.test('1. Worker processNewRoomKey Short-Circuit & Flush when room is up to date', async () => {
    const dbRooms = new Map()
    let flushedRoomId = null

    const currentUserKeys = {
      id: 'user_1',
      private_box_key: user1PrivateBoxKeyB64
    }

    // Seed existing room matching current user, epoch key, and timestamp
    dbRooms.set('room_101', {
      id: 'room_101',
      synced_user_id: 'user_1',
      updated_at: '2025-01-01 12:00:00.000Z',
      key_history: [{
        epoch_id: 1,
        key: roomKeyB64
      }]
    })

    const mockWorkerBridge = {
      request: async (method, args) => {
        if (method === 'getRoom') {
          return dbRooms.get(args[0]) || null
        }
        if (method === 'saveRoom') {
          dbRooms.set(args[0].id, args[0])
          return true
        }
        return null
      }
    }

    async function mockFlushPendingMessagesForRoom (roomId) {
      flushedRoomId = roomId
    }

    async function processNewRoomKey (rpcId, payload) {
      const { room_id, epoch_id, updated } = payload
      const effectiveEpochId = epoch_id || 1

      const existingRoom = await mockWorkerBridge.request('getRoom', [room_id])
      const isSameUser = existingRoom?.synced_user_id === currentUserKeys?.id
      const hasEpochKey = existingRoom?.key_history?.some(h => h.epoch_id === effectiveEpochId && !!h.key)
      const isUpToDate = existingRoom?.updated_at && updated && existingRoom.updated_at >= updated

      if (isSameUser && hasEpochKey && isUpToDate) {
        await mockFlushPendingMessagesForRoom(room_id)
        return {
          id: rpcId,
          type: 'worker:process_new_room_key',
          result: {
            success: true,
            skipped: true
          }
        }
      }

      return {
        id: rpcId,
        type: 'worker:process_new_room_key',
        result: {
          success: true,
          skipped: false
        }
      }
    }

    const payload = createWrappedRoomKeyPayload({
      roomId: 'room_101',
      epochId: 1,
      updated: '2025-01-01 12:00:00.000Z'
    })

    const response = await processNewRoomKey(1, payload)

    assert.strictEqual(response.result.success, true)
    assert.strictEqual(response.result.skipped, true)
    assert.strictEqual(flushedRoomId, 'room_101')
  })

  await t.test('2. Multi-User Isolation: Worker does NOT short-circuit when synced_user_id differs', async () => {
    const dbRooms = new Map()
    const currentUserKeys = {
      id: 'user_2', // Current user is user_2
      private_box_key: user1PrivateBoxKeyB64
    }

    // Room was previously saved by user_1
    dbRooms.set('room_101', {
      id: 'room_101',
      synced_user_id: 'user_1',
      updated_at: '2025-01-01 12:00:00.000Z',
      key_history: [{
        epoch_id: 1,
        key: roomKeyB64
      }]
    })

    const mockWorkerBridge = {
      request: async (method, args) => {
        if (method === 'getRoom') {
          return dbRooms.get(args[0]) || null
        }
        return null
      }
    }

    async function processNewRoomKey (rpcId, payload) {
      const { room_id, epoch_id, updated } = payload
      const effectiveEpochId = epoch_id || 1

      const existingRoom = await mockWorkerBridge.request('getRoom', [room_id])
      const isSameUser = existingRoom?.synced_user_id === currentUserKeys?.id
      const hasEpochKey = existingRoom?.key_history?.some(h => h.epoch_id === effectiveEpochId && !!h.key)
      const isUpToDate = existingRoom?.updated_at && updated && existingRoom.updated_at >= updated

      if (isSameUser && hasEpochKey && isUpToDate) {
        return {
          id: rpcId,
          type: 'worker:process_new_room_key',
          result: {
            success: true,
            skipped: true
          }
        }
      }

      // Full processing required because user differs
      return {
        id: rpcId,
        type: 'worker:process_new_room_key',
        result: {
          success: true,
          skipped: false
        }
      }
    }

    const payload = createWrappedRoomKeyPayload({
      roomId: 'room_101',
      epochId: 1,
      updated: '2025-01-01 12:00:00.000Z'
    })

    const response = await processNewRoomKey(2, payload)

    assert.strictEqual(response.result.success, true)
    assert.strictEqual(response.result.skipped, false)
  })

  await t.test('3. Sync catch-up watermark and isCatchingUp state transition ordering', async () => {
    let lastRoomSyncTime = null
    const $state = { isCatchingUp: false }
    const emittedEvents = []

    const mockBus = {
      emit: (event, payload) => {
        emittedEventsPush(event, {
          isCatchingUp: $state.isCatchingUp,
          payload
        })
      }
    }

    function emittedEventsPush (event, data) {
      emittedEvents.push({
        event,
        ...data
      })
    }

    function handleLogout () {
      lastRoomSyncTime = null
    }

    async function performCatchUpSync () {
      $state.isCatchingUp = true

      const filter = lastRoomSyncTime
        ? `user_id = "u1" && updated >= "${lastRoomSyncTime}"`
        : 'user_id = "u1"'

      lastRoomSyncTime = new Date().toISOString().replace('T', ' ')

      // Set isCatchingUp to false BEFORE emitting sync:complete
      $state.isCatchingUp = false
      mockBus.emit('sync:complete')

      return filter
    }

    assert.strictEqual(lastRoomSyncTime, null)

    const firstFilter = await performCatchUpSync()
    assert.strictEqual(firstFilter, 'user_id = "u1"')
    assert.ok(lastRoomSyncTime)

    // Verify sync:complete event observed isCatchingUp === false
    const syncCompleteEvent = emittedEvents.find(e => e.event === 'sync:complete')
    assert.ok(syncCompleteEvent)
    assert.strictEqual(syncCompleteEvent.isCatchingUp, false)

    // Second sync uses lastRoomSyncTime filter
    const secondFilter = await performCatchUpSync()
    assert.ok(secondFilter.includes('updated >= "20'))

    // Logout resets watermark
    handleLogout()
    assert.strictEqual(lastRoomSyncTime, null)
  })

  await t.test('4. Targeted Media List Payload Filters', async () => {
    // Picture List Filter
    const isPictureMatch = (payload) => {
      const msg = payload?.message
      return Boolean(
        msg?.mime_type?.startsWith('image/') ||
        msg?.attachments?.some(a => a.mime_type?.startsWith('image/')) ||
        payload?.mime_type?.startsWith('image/')
      )
    }

    // Video List Filter
    const isVideoMatch = (payload) => {
      const msg = payload?.message
      return Boolean(
        msg?.mime_type?.startsWith('video/') ||
        msg?.attachments?.some(a => a.mime_type?.startsWith('video/')) ||
        payload?.mime_type?.startsWith('video/')
      )
    }

    // Music List Filter
    const isMusicMatch = (payload) => {
      const msg = payload?.message
      return Boolean(
        msg?.mime_type?.startsWith('audio/') ||
        msg?.attachments?.some(a => a.mime_type?.startsWith('audio/')) ||
        payload?.mime_type?.startsWith('audio/')
      )
    }

    // Document List Filter
    const isDocumentMatch = (payload) => {
      const msg = payload?.message
      const isMediaMime = (mime) => mime?.startsWith('image/') || mime?.startsWith('video/') || mime?.startsWith('audio/')
      const hasDocMime = msg?.mime_type && !isMediaMime(msg.mime_type)
      const hasDocAttachment = msg?.attachments?.some(a => a.mime_type && !isMediaMime(a.mime_type))
      const isDocType = msg?.type === 'file' || msg?.type === 'document' || payload?.type === 'file' || payload?.type === 'document'
      return Boolean(hasDocMime || hasDocAttachment || isDocType)
    }

    // Link List Filter
    const isLinkMatch = (payload) => {
      const msg = payload?.message
      return Boolean(
        msg?.type === 'link' || (Array.isArray(msg?.links) && msg.links.length > 0) || payload?.type === 'link' || (Array.isArray(payload?.links) && payload.links.length > 0)
      )
    }

    // Test cases
    const plainTextPayload = {
      room_id: 'r1',
      message: {
        type: 'text',
        content: 'Hello world'
      }
    }
    const imagePayload = {
      room_id: 'r1',
      message: {
        type: 'media',
        mime_type: 'image/png',
        filename: 'pic.png'
      }
    }
    const videoPayload = {
      room_id: 'r1',
      message: {
        type: 'media',
        mime_type: 'video/mp4',
        filename: 'clip.mp4'
      }
    }
    const audioPayload = {
      room_id: 'r1',
      message: {
        type: 'media',
        mime_type: 'audio/mp3',
        filename: 'song.mp3'
      }
    }
    const docPayload = {
      room_id: 'r1',
      message: {
        type: 'media',
        mime_type: 'application/pdf',
        filename: 'doc.pdf'
      }
    }
    const linkPayload = {
      room_id: 'r1',
      message: {
        type: 'link',
        content: 'https://example.com',
        links: [{ url: 'https://example.com' }]
      }
    }
    const mixedAttachmentsPayload = {
      room_id: 'r1',
      message: {
        type: 'media',
        attachments: [
          {
            mime_type: 'image/jpeg',
            filename: 'photo.jpg'
          },
          {
            mime_type: 'application/zip',
            filename: 'archive.zip'
          }
        ]
      }
    }

    // Plain text is ignored by all media lists
    assert.strictEqual(isPictureMatch(plainTextPayload), false)
    assert.strictEqual(isVideoMatch(plainTextPayload), false)
    assert.strictEqual(isMusicMatch(plainTextPayload), false)
    assert.strictEqual(isDocumentMatch(plainTextPayload), false)
    assert.strictEqual(isLinkMatch(plainTextPayload), false)

    // Category matching assertions
    assert.strictEqual(isPictureMatch(imagePayload), true)
    assert.strictEqual(isVideoMatch(imagePayload), false)

    assert.strictEqual(isVideoMatch(videoPayload), true)
    assert.strictEqual(isPictureMatch(videoPayload), false)

    assert.strictEqual(isMusicMatch(audioPayload), true)
    assert.strictEqual(isVideoMatch(audioPayload), false)

    assert.strictEqual(isDocumentMatch(docPayload), true)
    assert.strictEqual(isPictureMatch(docPayload), false)

    assert.strictEqual(isLinkMatch(linkPayload), true)
    assert.strictEqual(isPictureMatch(linkPayload), false)

    // Multi-attachment mixed payload matches both image and document lists
    assert.strictEqual(isPictureMatch(mixedAttachmentsPayload), true)
    assert.strictEqual(isDocumentMatch(mixedAttachmentsPayload), true)
    assert.strictEqual(isVideoMatch(mixedAttachmentsPayload), false)
  })

  await t.test('5. Watermark Format Compatibility: Space-separated PocketBase Date Format', async () => {
    // PocketBase stores dates as "YYYY-MM-DD HH:mm:ss.SSSZ" (space-separated, not 'T'-separated)
    const watermarkISO = new Date('2026-08-21T12:00:00.000Z').toISOString() // "2026-08-21T12:00:00.000Z"
    const watermarkPB = watermarkISO.replace('T', ' ') // "2026-08-21 12:00:00.000Z"

    // Record updated 1 second AFTER the watermark in PocketBase format
    const recordUpdatedPB = '2026-08-21 12:00:01.000Z'

    // Demonstrating the bug if 'T' were used:
    // '2026-08-21 12:00:01.000Z' >= '2026-08-21T12:00:00.000Z' is FALSE because ' ' (0x20) < 'T' (0x54)
    assert.strictEqual(recordUpdatedPB >= watermarkISO, false)

    // Correct behavior with replace('T', ' '):
    // '2026-08-21 12:00:01.000Z' >= '2026-08-21 12:00:00.000Z' is TRUE
    assert.strictEqual(recordUpdatedPB >= watermarkPB, true)
  })

  await t.test('6. Worker shouldSkipRoomKeyProcessing helper logic', async () => {
    function shouldSkipRoomKeyProcessing (existingRoom, payload, currentUserId) {
      const effectiveEpochId = payload?.epoch_id || 1
      const isSameUser = existingRoom?.synced_user_id === currentUserId
      const hasEpochKey = existingRoom?.key_history?.some(h => h.epoch_id === effectiveEpochId && !!h.key)
      const isUpToDate = existingRoom?.updated_at && payload?.updated && existingRoom.updated_at >= payload.updated
      return Boolean(isSameUser && hasEpochKey && isUpToDate)
    }

    const validRoom = {
      id: 'r1',
      synced_user_id: 'userA',
      updated_at: '2026-08-21 12:00:05.000Z',
      key_history: [{
        epoch_id: 1,
        key: 'validKey'
      }]
    }

    const matchingPayload = {
      room_id: 'r1',
      epoch_id: 1,
      updated: '2026-08-21 12:00:00.000Z'
    }

    // Matching user, key present, room is up to date -> SKIP
    assert.strictEqual(shouldSkipRoomKeyProcessing(validRoom, matchingPayload, 'userA'), true)

    // User mismatch -> DO NOT SKIP
    assert.strictEqual(shouldSkipRoomKeyProcessing(validRoom, matchingPayload, 'userB'), false)

    // Missing epoch key -> DO NOT SKIP
    const missingKeyRoom = {
      ...validRoom,
      key_history: []
    }
    assert.strictEqual(shouldSkipRoomKeyProcessing(missingKeyRoom, matchingPayload, 'userA'), false)

    // Newer payload updated -> DO NOT SKIP
    const newerPayload = {
      ...matchingPayload,
      updated: '2026-08-21 12:05:00.000Z'
    }
    assert.strictEqual(shouldSkipRoomKeyProcessing(validRoom, newerPayload, 'userA'), false)
  })
})
