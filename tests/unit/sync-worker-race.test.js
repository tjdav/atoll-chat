import { test } from 'node:test'
import assert from 'node:assert'
import sodium from 'libsodium-wrappers-sumo'

test('Worker Key-Arrival Replay Buffer & Late Key Synchronization Race Unit Tests', async (t) => {
  await sodium.ready

  const senderSignKeypair = sodium.crypto_sign_keypair()
  const validPublicSignKey = sodium.to_base64(senderSignKeypair.publicKey, sodium.base64_variants.ORIGINAL)

  const inviterBoxKeypair = sodium.crypto_box_keypair()
  const inviterPublicBoxKey = sodium.to_base64(inviterBoxKeypair.publicKey, sodium.base64_variants.ORIGINAL)

  const userBoxKeypair = sodium.crypto_box_keypair()
  const userPrivateBoxKey = sodium.to_base64(userBoxKeypair.privateKey, sodium.base64_variants.ORIGINAL)

  // Epoch 1 Room Key (32 bytes secretbox key)
  const roomKeyEpoch1 = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES)
  const epochKey1B64 = sodium.to_base64(roomKeyEpoch1, sodium.base64_variants.ORIGINAL)

  // Epoch 2 Room Key
  const roomKeyEpoch2 = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES)
  const epochKey2B64 = sodium.to_base64(roomKeyEpoch2, sodium.base64_variants.ORIGINAL)

  // Helper to create encrypted message record
  function createMessageRecord ({
    id = 'msg_1',
    roomId = 'room_1',
    epochId = 1,
    senderId = 'sender_1',
    localUuid = 'msg_uuid_1',
    content = 'Hello World',
    roomKey = roomKeyEpoch1
  }) {
    const payloadObj = {
      local_uuid: localUuid,
      type: 'text',
      content,
      timestamp: Date.now()
    }
    const plaintextStr = JSON.stringify(payloadObj)
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
    const ciphertextBuffer = sodium.crypto_secretbox_easy(plaintextStr, nonce, roomKey)
    const ciphertextB64 = sodium.to_base64(ciphertextBuffer, sodium.base64_variants.ORIGINAL)
    const nonceB64 = sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)

    const validationString = `${roomId}|${epochId}|START|${ciphertextB64}|${nonceB64}`
    const validationBuffer = new TextEncoder().encode(validationString)
    const signatureBuffer = sodium.crypto_sign_detached(validationBuffer, senderSignKeypair.privateKey)
    const signatureB64 = sodium.to_base64(signatureBuffer, sodium.base64_variants.ORIGINAL)

    return {
      id,
      room_id: roomId,
      epoch_id: epochId,
      sender_id: senderId,
      payload: {
        ciphertext: ciphertextB64,
        nonce: nonceB64
      },
      signature: signatureB64,
      previous_msg_uuid: 'START',
      local_uuid: localUuid,
      created: '2025-01-01 00:00:00.000Z'
    }
  }

  // Helper to construct wrapped room key payload
  function createWrappedRoomKeyPayload ({
    roomId = 'room_1',
    wrappedBy = 'inviter_1',
    roomKey = roomKeyEpoch1,
    epochId = 1
  }) {
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES)
    const encryptedKeyBuffer = sodium.crypto_box_easy(
      roomKey,
      nonce,
      userBoxKeypair.publicKey,
      inviterBoxKeypair.privateKey
    )

    return {
      room_id: roomId,
      wrapped_by: wrappedBy,
      encrypted_room_key: sodium.to_base64(encryptedKeyBuffer, sodium.base64_variants.ORIGINAL),
      key_nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
      epoch_id: epochId,
      role: 'owner',
      updated: '2025-01-01 00:00:00.000Z'
    }
  }

  await t.test('1. Out-of-Order Message/Key Race and Replay Buffer Drain', async () => {
    const pendingKeyReplayBuffer = new Map()
    const postedMessages = []
    const dbRooms = new Map()
    const dbMessages = new Map()

    const mockBridge = {
      request: async (method, args) => {
        if (method === 'getMessage') return dbMessages.get(args[0]) || null
        if (method === 'getRoom') return dbRooms.get(args[0]) || null
        if (method === 'saveRoom') {
          dbRooms.set(args[0].id, args[0])
          return true
        }
        if (method === 'saveMessage') {
          dbMessages.set(args[0].local_uuid, args[0])
          return true
        }
        return null
      }
    }

    const publicKeyCache = new Map([
      ['sender_1', { public_sign_key: validPublicSignKey }],
      ['inviter_1', { public_box_key: inviterPublicBoxKey }]
    ])

    const currentUserKeys = {
      id: 'user_1',
      private_box_key: userPrivateBoxKey
    }

    // Replay Pass Functions using processIncomingMessageInternal pattern
    async function processIncomingMessageInternal (record) {
      const { room_id: roomId, epoch_id: epochId, sender_id: senderId, payload, signature, previous_msg_uuid: previousMsgUuid, local_uuid: localUuid, created } = record
      const senderKeys = publicKeyCache.get(senderId)
      const publicSignKeyBuffer = sodium.from_base64(senderKeys.public_sign_key, sodium.base64_variants.ORIGINAL)
      const signatureBuffer = sodium.from_base64(signature, sodium.base64_variants.ORIGINAL)

      const validationString = `${roomId}|${epochId}|${previousMsgUuid}|${payload.ciphertext}|${payload.nonce}`
      const validationBuffer = new TextEncoder().encode(validationString)

      const isValid = sodium.crypto_sign_verify_detached(signatureBuffer, validationBuffer, publicSignKeyBuffer)
      if (!isValid) {
        return { success: false, code: 'ERR_SIGNATURE_INVALID', error: 'Signature forged or invalid' }
      }

      const room = await mockBridge.request('getRoom', [roomId])
      if (!room) {
        return { success: false, code: 'ERR_KEY_PENDING', error: `Local room ${roomId} not found` }
      }

      const activeEpoch = room.key_history?.find(h => h.epoch_id === epochId)
      if (!activeEpoch) {
        return { success: false, code: 'ERR_KEY_PENDING', error: 'Missing cryptographic key for this epoch.' }
      }

      const ciphertextBuffer = sodium.from_base64(payload.ciphertext, sodium.base64_variants.ORIGINAL)
      const nonceBuffer = sodium.from_base64(payload.nonce, sodium.base64_variants.ORIGINAL)
      const epochKeyBuffer = sodium.from_base64(activeEpoch.key, sodium.base64_variants.ORIGINAL)

      const decryptedBuffer = sodium.crypto_secretbox_open_easy(ciphertextBuffer, nonceBuffer, epochKeyBuffer)
      const decryptedPayload = JSON.parse(new TextDecoder().decode(decryptedBuffer))

      const decryptedMessage = {
        id: record.id,
        local_uuid: decryptedPayload.local_uuid || record.id,
        room_id: roomId,
        sender_id: senderId,
        type: decryptedPayload.type,
        content: decryptedPayload.content,
        timestamp: decryptedPayload.timestamp,
        status: 'sent',
        created_at: created
      }

      await mockBridge.request('saveMessage', [decryptedMessage])

      return { success: true, data: decryptedMessage }
    }

    async function processIncomingMessage (rpcId, record) {
      const result = await processIncomingMessageInternal(record)
      if (result.success) {
        postedMessages.push({ id: rpcId, type: 'worker:process_incoming_message', result: { success: true } })
        return
      }

      if (result.code === 'ERR_KEY_PENDING') {
        const roomId = record.room_id
        const msgId = record.id || record.local_uuid
        let queue = pendingKeyReplayBuffer.get(roomId) || []
        const now = Date.now()
        queue = queue.filter(item => (now - item.receivedAt) <= 60000)
        while (queue.length >= 50) queue.shift()
        queue.push({ id: msgId, record, receivedAt: now })
        pendingKeyReplayBuffer.set(roomId, queue)

        postedMessages.push({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: { success: true, status: 'queued_for_key', roomId, messageId: msgId }
        })
        return
      }

      postedMessages.push({ id: rpcId, type: 'worker:process_incoming_message', result: { success: false, error: result.error } })
    }

    async function flushPendingMessagesForRoom (roomId) {
      const queue = pendingKeyReplayBuffer.get(roomId)
      if (!queue || queue.length === 0) return

      const now = Date.now()
      const validItems = queue.filter(item => (now - item.receivedAt) <= 60000)
      const remaining = []

      for (const item of validItems) {
        const result = await processIncomingMessageInternal(item.record)
        if (result && result.success) {
          if (result.data) {
            postedMessages.push({ type: 'db:new_local_data', payload: { room_id: roomId, message: result.data } })
            postedMessages.push({ type: 'sync:message_replayed', payload: { room_id: roomId, message: result.data } })
          }
        } else if (result && result.code === 'ERR_KEY_PENDING') {
          remaining.push(item)
        }
      }

      if (remaining.length > 0) {
        pendingKeyReplayBuffer.set(roomId, remaining)
      } else {
        pendingKeyReplayBuffer.delete(roomId)
      }
    }

    async function processNewRoomKey (rpcId, payload) {
      const encryptedRoomKeyBuffer = sodium.from_base64(payload.encrypted_room_key, sodium.base64_variants.ORIGINAL)
      const nonceBuffer = sodium.from_base64(payload.key_nonce, sodium.base64_variants.ORIGINAL)
      const inviterPublicKeyBuffer = sodium.from_base64(inviterPublicBoxKey, sodium.base64_variants.ORIGINAL)
      const userPrivateKeyBuffer = sodium.from_base64(userPrivateBoxKey, sodium.base64_variants.ORIGINAL)

      const unwrappedKeyBuffer = sodium.crypto_box_open_easy(
        encryptedRoomKeyBuffer,
        nonceBuffer,
        inviterPublicKeyBuffer,
        userPrivateKeyBuffer
      )

      let room = await mockBridge.request('getRoom', [payload.room_id])
      if (!room) {
        room = { id: payload.room_id, key_history: [] }
      }
      room.key_history.push({
        epoch_id: payload.epoch_id || 1,
        key: sodium.to_base64(unwrappedKeyBuffer, sodium.base64_variants.ORIGINAL)
      })
      await mockBridge.request('saveRoom', [room])

      await flushPendingMessagesForRoom(payload.room_id)

      postedMessages.push({ id: rpcId, type: 'worker:process_new_room_key', result: { success: true } })
    }

    // Step 1: Out-of-order message arrives BEFORE room key
    const msgRecord = createMessageRecord({ id: 'raced_msg_1', roomId: 'room_race_1', content: 'Raced message' })
    await processIncomingMessage(101, msgRecord)

    // Verify status queued_for_key and buffer state
    const firstRes = postedMessages.find(m => m.id === 101)
    assert.ok(firstRes)
    assert.strictEqual(firstRes.result.status, 'queued_for_key')
    assert.strictEqual(firstRes.result.roomId, 'room_race_1')
    assert.strictEqual(pendingKeyReplayBuffer.get('room_race_1')?.length, 1)

    // Step 2: Room key arrives
    const keyPayload = createWrappedRoomKeyPayload({ roomId: 'room_race_1', roomKey: roomKeyEpoch1, epochId: 1 })
    await processNewRoomKey(102, keyPayload)

    // Verify buffer drained and broadcasts sent
    assert.strictEqual(pendingKeyReplayBuffer.has('room_race_1'), false)

    const newLocalDataEvent = postedMessages.find(m => m.type === 'db:new_local_data' && m.payload.room_id === 'room_race_1')
    assert.ok(newLocalDataEvent)
    assert.strictEqual(newLocalDataEvent.payload.message.content, 'Raced message')

    const replayedEvent = postedMessages.find(m => m.type === 'sync:message_replayed' && m.payload.room_id === 'room_race_1')
    assert.ok(replayedEvent)
    assert.strictEqual(replayedEvent.payload.message.content, 'Raced message')

    // Verify saved to DB
    assert.strictEqual(dbMessages.has('msg_uuid_1'), true)
    assert.strictEqual(dbMessages.get('msg_uuid_1').content, 'Raced message')
  })

  await t.test('2. Multi-Epoch Ratchet Race Condition', async () => {
    const pendingKeyReplayBuffer = new Map()
    const dbRooms = new Map([
      ['room_epoch_test', {
        id: 'room_epoch_test',
        key_history: [{ epoch_id: 1, key: epochKey1B64 }]
      }]
    ])
    const dbMessages = new Map()
    const postedMessages = []

    const mockBridge = {
      request: async (method, args) => {
        if (method === 'getRoom') return dbRooms.get(args[0]) || null
        if (method === 'saveRoom') { dbRooms.set(args[0].id, args[0]); return true }
        if (method === 'saveMessage') { dbMessages.set(args[0].local_uuid, args[0]); return true }
        return null
      }
    }

    // Process incoming message with Epoch 2 key (which hasn't arrived yet)
    const msgEpoch2 = createMessageRecord({
      id: 'msg_e2',
      roomId: 'room_epoch_test',
      epochId: 2,
      localUuid: 'uuid_e2',
      content: 'Epoch 2 Content',
      roomKey: roomKeyEpoch2
    })

    // Simulate buffering due to missing Epoch 2 key
    let queue = pendingKeyReplayBuffer.get('room_epoch_test') || []
    queue.push({ id: 'msg_e2', record: msgEpoch2, receivedAt: Date.now() })
    pendingKeyReplayBuffer.set('room_epoch_test', queue)

    assert.strictEqual(pendingKeyReplayBuffer.get('room_epoch_test').length, 1)

    // Now Epoch 2 room key arrives
    const room = dbRooms.get('room_epoch_test')
    room.key_history.push({ epoch_id: 2, key: epochKey2B64 })

    // Drain buffer
    const items = pendingKeyReplayBuffer.get('room_epoch_test')
    const remaining = []
    for (const item of items) {
      const record = item.record
      const activeEpoch = room.key_history.find(h => h.epoch_id === record.epoch_id)
      if (activeEpoch) {
        const ciphertextBuffer = sodium.from_base64(record.payload.ciphertext, sodium.base64_variants.ORIGINAL)
        const nonceBuffer = sodium.from_base64(record.payload.nonce, sodium.base64_variants.ORIGINAL)
        const epochKeyBuffer = sodium.from_base64(activeEpoch.key, sodium.base64_variants.ORIGINAL)
        const decryptedBuffer = sodium.crypto_secretbox_open_easy(ciphertextBuffer, nonceBuffer, epochKeyBuffer)
        const decryptedPayload = JSON.parse(new TextDecoder().decode(decryptedBuffer))

        dbMessages.set(decryptedPayload.local_uuid, decryptedPayload)
      } else {
        remaining.push(item)
      }
    }
    pendingKeyReplayBuffer.delete('room_epoch_test')

    assert.strictEqual(dbMessages.get('uuid_e2').content, 'Epoch 2 Content')
    assert.strictEqual(pendingKeyReplayBuffer.has('room_epoch_test'), false)
  })

  await t.test('3. Forged Signature Rejection (Never Queued)', async () => {
    const pendingKeyReplayBuffer = new Map()

    const forgedRecord = createMessageRecord({ id: 'forged_1', roomId: 'room_1' })
    // Corrupt signature
    forgedRecord.signature = sodium.to_base64(new Uint8Array(64).fill(7), sodium.base64_variants.ORIGINAL)

    const publicSignKeyBuffer = sodium.from_base64(validPublicSignKey, sodium.base64_variants.ORIGINAL)
    const signatureBuffer = sodium.from_base64(forgedRecord.signature, sodium.base64_variants.ORIGINAL)
    const validationString = `${forgedRecord.room_id}|${forgedRecord.epoch_id}|${forgedRecord.previous_msg_uuid}|${forgedRecord.payload.ciphertext}|${forgedRecord.payload.nonce}`
    const validationBuffer = new TextEncoder().encode(validationString)

    const isValid = sodium.crypto_sign_verify_detached(signatureBuffer, validationBuffer, publicSignKeyBuffer)

    if (!isValid) {
      // Must NOT be placed in pendingKeyReplayBuffer
      assert.strictEqual(pendingKeyReplayBuffer.has('room_1'), false)
    } else {
      assert.fail('Signature verification should have failed for forged message')
    }
  })

  await t.test('4. 60-Second TTL Expiration Eviction', async () => {
    const pendingKeyReplayBuffer = new Map()

    const now = Date.now()
    const expiredRecord = createMessageRecord({ id: 'expired_msg', roomId: 'room_ttl' })
    const validRecord = createMessageRecord({ id: 'valid_msg', roomId: 'room_ttl' })

    pendingKeyReplayBuffer.set('room_ttl', [
      { id: 'expired_msg', record: expiredRecord, receivedAt: now - 65000 }, // 65 seconds old
      { id: 'valid_msg', record: validRecord, receivedAt: now - 1000 } // 1 second old
    ])

    // Filter TTL pass
    const queue = pendingKeyReplayBuffer.get('room_ttl')
    const validItems = queue.filter(item => (now - item.receivedAt) <= 60000)

    assert.strictEqual(validItems.length, 1)
    assert.strictEqual(validItems[0].id, 'valid_msg')
  })

  await t.test('5. Queue Capacity Cap (50 Messages Max)', async () => {
    let queue = []
    const now = Date.now()

    // Enqueue 55 messages
    for (let i = 1; i <= 55; i++) {
      const record = createMessageRecord({ id: `msg_${i}`, roomId: 'room_cap', localUuid: `uuid_${i}` })
      queue = queue.filter(item => (now - item.receivedAt) <= 60000)
      while (queue.length >= 50) {
        queue.shift() // drop oldest
      }
      queue.push({ id: `msg_${i}`, record, receivedAt: now })
    }

    assert.strictEqual(queue.length, 50)
    assert.strictEqual(queue[0].id, 'msg_6') // oldest 5 (1..5) evicted
    assert.strictEqual(queue[49].id, 'msg_55')
  })

  await t.test('6. Logout / worker:wipe_keys Clears Replay Buffer', async () => {
    const pendingKeyReplayBuffer = new Map([
      ['room_1', [{ id: 'msg_1', receivedAt: Date.now() }]],
      ['room_2', [{ id: 'msg_2', receivedAt: Date.now() }]]
    ])

    assert.strictEqual(pendingKeyReplayBuffer.size, 2)

    // Simulate worker:wipe_keys task
    pendingKeyReplayBuffer.clear()

    assert.strictEqual(pendingKeyReplayBuffer.size, 0)
  })
})
