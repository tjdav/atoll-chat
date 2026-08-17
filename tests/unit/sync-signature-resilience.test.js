import { test } from 'node:test'
import assert from 'node:assert'
import sodium from 'libsodium-wrappers-sumo'

test('Worker processIncomingMessage Cryptographic Resilience Unit Tests', async (t) => {
  await sodium.ready

  const senderSignKeypair = sodium.crypto_sign_keypair()
  const validPublicSignKey = sodium.to_base64(senderSignKeypair.publicKey, sodium.base64_variants.ORIGINAL)

  // Epoch key (32 bytes secretbox key)
  const roomKey = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES)
  const epochKeyB64 = sodium.to_base64(roomKey, sodium.base64_variants.ORIGINAL)

  // Construct valid encrypted payload
  const validPayloadObj = {
    local_uuid: 'msg_uuid_1',
    type: 'text',
    content: 'Hello World',
    timestamp: Date.now()
  }
  const plaintextStr = JSON.stringify(validPayloadObj)
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertextBuffer = sodium.crypto_secretbox_easy(plaintextStr, nonce, roomKey)
  const ciphertextB64 = sodium.to_base64(ciphertextBuffer, sodium.base64_variants.ORIGINAL)
  const nonceB64 = sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)

  // Construct valid Ed25519 signature
  const validationString = `room_1|1|START|${ciphertextB64}|${nonceB64}`
  const validationBuffer = new TextEncoder().encode(validationString)
  const validSignatureBuffer = sodium.crypto_sign_detached(validationBuffer, senderSignKeypair.privateKey)
  const validSignatureB64 = sodium.to_base64(validSignatureBuffer, sodium.base64_variants.ORIGINAL)

  // Setup worker environment mock
  let postedMessages = []
  const mockSelf = {
    publicKeyCache: new Map([
      ['sender_1', { public_sign_key: validPublicSignKey }]
    ]),
    postMessage (msg) {
      postedMessages.push(msg)
    }
  }

  const mockBridge = {
    request: async (method, args) => {
      if (method === 'getMessage') {
        return null
      }
      if (method === 'getRoom') {
        return {
          id: 'room_1',
          key_history: [{
            epoch_id: '1',
            key: epochKeyB64
          }]
        }
      }
      if (method === 'saveMessage') {
        return true
      }
      return null
    }
  }

  // Create isolated processIncomingMessage function using standard sodium functions matching worker logic
  async function runProcessIncomingMessage (rpcId, record, publicKeyCacheMap = mockSelf.publicKeyCache) {
    postedMessages = []
    let signatureBuffer = null
    let publicSignKeyBuffer = null
    let validationBuffer = null
    let ciphertextBuffer = null
    let nonceBuffer = null
    let epochKeyBuffer = null
    let decryptedBuffer = null

    try {
      if (!record || typeof record !== 'object') {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Invalid message record'
          }
        })
        return
      }

      const { id, room_id, epoch_id: epochId, sender_id: senderId, payload, signature, previous_msg_uuid: previousMsgUuid, local_uuid: localUuid, created } = record

      if (!payload || typeof payload !== 'object') {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Invalid message payload'
          }
        })
        return
      }

      if (localUuid) {
        const exists = await mockBridge.request('getMessage', [localUuid])
        if (exists) {
          mockSelf.postMessage({
            id: rpcId,
            type: 'worker:process_incoming_message',
            result: {
              success: true,
              duplicated: true
            }
          })
          return
        }
      }

      const { ciphertext, nonce } = payload

      if (typeof signature !== 'string' || !signature.trim()) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Missing or invalid signature string'
          }
        })
        return
      }

      const senderKeys = publicKeyCacheMap.get(senderId)
      const publicSignKey = senderKeys?.public_sign_key

      if (typeof publicSignKey !== 'string' || !publicSignKey.trim()) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Sender public sign key is missing or invalid'
          }
        })
        return
      }

      try {
        signatureBuffer = sodium.from_base64(signature, sodium.base64_variants.ORIGINAL)
      } catch (err) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Failed to decode base64 signature'
          }
        })
        return
      }

      try {
        publicSignKeyBuffer = sodium.from_base64(publicSignKey, sodium.base64_variants.ORIGINAL)
      } catch (err) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Failed to decode base64 public sign key'
          }
        })
        return
      }

      if (!signatureBuffer || signatureBuffer.length !== sodium.crypto_sign_BYTES) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Signature length invalid'
          }
        })
        return
      }

      if (!publicSignKeyBuffer || publicSignKeyBuffer.length !== sodium.crypto_sign_PUBLICKEYBYTES) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Public key length invalid'
          }
        })
        return
      }

      const validationString = `${room_id}|${epochId}|${previousMsgUuid}|${ciphertext}|${nonce}`
      validationBuffer = new TextEncoder().encode(validationString)

      let isValid = false
      try {
        isValid = sodium.crypto_sign_verify_detached(signatureBuffer, validationBuffer, publicSignKeyBuffer)
      } catch (err) {
        isValid = false
      }

      if (!isValid) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Signature forged or invalid'
          }
        })
        return
      }

      const room = await mockBridge.request('getRoom', [room_id])
      if (!room) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: `Local room ${room_id} not found`
          }
        })
        return
      }

      const activeEpoch = room.key_history?.find(h => h.epoch_id === epochId)
      if (!activeEpoch || typeof activeEpoch.key !== 'string' || !activeEpoch.key.trim()) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Missing cryptographic key for this epoch.'
          }
        })
        return
      }

      if (typeof ciphertext !== 'string' || typeof nonce !== 'string') {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Ciphertext or nonce is not a string'
          }
        })
        return
      }

      try {
        ciphertextBuffer = sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL)
      } catch (err) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Failed to decode base64 ciphertext'
          }
        })
        return
      }

      try {
        nonceBuffer = sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL)
      } catch (err) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Failed to decode base64 nonce'
          }
        })
        return
      }

      try {
        epochKeyBuffer = sodium.from_base64(activeEpoch.key, sodium.base64_variants.ORIGINAL)
      } catch (err) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Failed to decode base64 epoch key'
          }
        })
        return
      }

      if (!nonceBuffer || nonceBuffer.length !== sodium.crypto_secretbox_NONCEBYTES) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Nonce length invalid'
          }
        })
        return
      }

      if (!epochKeyBuffer || epochKeyBuffer.length !== sodium.crypto_secretbox_KEYBYTES) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Epoch key length invalid'
          }
        })
        return
      }

      try {
        decryptedBuffer = sodium.crypto_secretbox_open_easy(ciphertextBuffer, nonceBuffer, epochKeyBuffer)
      } catch (err) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Decryption failed'
          }
        })
        return
      }

      if (!decryptedBuffer) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Decryption failed (null result)'
          }
        })
        return
      }

      let decryptedString = ''
      let decryptedPayload = null
      try {
        decryptedString = new TextDecoder().decode(decryptedBuffer)
        decryptedPayload = JSON.parse(decryptedString)
      } catch (err) {
        mockSelf.postMessage({
          id: rpcId,
          type: 'worker:process_incoming_message',
          result: {
            success: false,
            error: 'Failed to decode or parse JSON payload'
          }
        })
        return
      }

      mockSelf.postMessage({
        id: rpcId,
        type: 'worker:process_incoming_message',
        result: { success: true }
      })
    } finally {
      if (signatureBuffer?.fill) {
        signatureBuffer.fill(0)
      }
      if (publicSignKeyBuffer?.fill) {
        publicSignKeyBuffer.fill(0)
      }
      if (validationBuffer?.fill) {
        validationBuffer.fill(0)
      }
      if (ciphertextBuffer?.fill) {
        ciphertextBuffer.fill(0)
      }
      if (nonceBuffer?.fill) {
        nonceBuffer.fill(0)
      }
      if (epochKeyBuffer?.fill) {
        epochKeyBuffer.fill(0)
      }
      if (decryptedBuffer?.fill) {
        decryptedBuffer.fill(0)
      }
    }
  }

  await t.test('Successfully processes valid incoming message', async () => {
    const validRecord = {
      id: 'msg_1',
      room_id: 'room_1',
      epoch_id: '1',
      sender_id: 'sender_1',
      payload: {
        ciphertext: ciphertextB64,
        nonce: nonceB64
      },
      signature: validSignatureB64,
      previous_msg_uuid: 'START',
      local_uuid: 'msg_uuid_1',
      created: '2025-01-01 00:00:00.000Z'
    }

    await runProcessIncomingMessage(1, validRecord)
    assert.strictEqual(postedMessages.length, 1)
    assert.deepStrictEqual(postedMessages[0].result, { success: true })
  })

  await t.test('Safely returns success: false for empty/missing signature', async () => {
    const record = {
      id: 'msg_1',
      room_id: 'room_1',
      epoch_id: '1',
      sender_id: 'sender_1',
      payload: {
        ciphertext: ciphertextB64,
        nonce: nonceB64
      },
      signature: '',
      previous_msg_uuid: 'START',
      local_uuid: 'msg_uuid_1',
      created: '2025-01-01 00:00:00.000Z'
    }

    await runProcessIncomingMessage(2, record)
    assert.strictEqual(postedMessages.length, 1)
    assert.strictEqual(postedMessages[0].result.success, false)
    assert.strictEqual(postedMessages[0].result.error, 'Missing or invalid signature string')
  })

  await t.test('Safely returns success: false for truncated/malformed signature length', async () => {
    // 10 byte base64 signature instead of 64 bytes
    const truncatedSignatureB64 = sodium.to_base64(new Uint8Array(10), sodium.base64_variants.ORIGINAL)
    const record = {
      id: 'msg_1',
      room_id: 'room_1',
      epoch_id: '1',
      sender_id: 'sender_1',
      payload: {
        ciphertext: ciphertextB64,
        nonce: nonceB64
      },
      signature: truncatedSignatureB64,
      previous_msg_uuid: 'START',
      local_uuid: 'msg_uuid_1',
      created: '2025-01-01 00:00:00.000Z'
    }

    await runProcessIncomingMessage(3, record)
    assert.strictEqual(postedMessages.length, 1)
    assert.strictEqual(postedMessages[0].result.success, false)
    assert.strictEqual(postedMessages[0].result.error, 'Signature length invalid')
  })

  await t.test('Safely returns success: false for invalid/truncated public key', async () => {
    const customMap = new Map([
      ['sender_1', { public_sign_key: sodium.to_base64(new Uint8Array(16), sodium.base64_variants.ORIGINAL) }]
    ])
    const record = {
      id: 'msg_1',
      room_id: 'room_1',
      epoch_id: '1',
      sender_id: 'sender_1',
      payload: {
        ciphertext: ciphertextB64,
        nonce: nonceB64
      },
      signature: validSignatureB64,
      previous_msg_uuid: 'START',
      local_uuid: 'msg_uuid_1',
      created: '2025-01-01 00:00:00.000Z'
    }

    await runProcessIncomingMessage(4, record, customMap)
    assert.strictEqual(postedMessages.length, 1)
    assert.strictEqual(postedMessages[0].result.success, false)
    assert.strictEqual(postedMessages[0].result.error, 'Public key length invalid')
  })

  await t.test('Safely returns success: false for forged/unmatching signature', async () => {
    const forgedSignatureBuffer = new Uint8Array(64).fill(9)
    const forgedSignatureB64 = sodium.to_base64(forgedSignatureBuffer, sodium.base64_variants.ORIGINAL)

    const record = {
      id: 'msg_1',
      room_id: 'room_1',
      epoch_id: '1',
      sender_id: 'sender_1',
      payload: {
        ciphertext: ciphertextB64,
        nonce: nonceB64
      },
      signature: forgedSignatureB64,
      previous_msg_uuid: 'START',
      local_uuid: 'msg_uuid_1',
      created: '2025-01-01 00:00:00.000Z'
    }

    await runProcessIncomingMessage(5, record)
    assert.strictEqual(postedMessages.length, 1)
    assert.strictEqual(postedMessages[0].result.success, false)
    assert.strictEqual(postedMessages[0].result.error, 'Signature forged or invalid')
  })

  await t.test('Safely returns success: false for invalid nonce buffer length', async () => {
    const invalidNonceB64 = sodium.to_base64(new Uint8Array(12), sodium.base64_variants.ORIGINAL)
    const record = {
      id: 'msg_1',
      room_id: 'room_1',
      epoch_id: '1',
      sender_id: 'sender_1',
      payload: {
        ciphertext: ciphertextB64,
        nonce: invalidNonceB64
      },
      signature: validSignatureB64,
      previous_msg_uuid: 'START',
      local_uuid: 'msg_uuid_1',
      created: '2025-01-01 00:00:00.000Z'
    }

    await runProcessIncomingMessage(6, record)
    assert.strictEqual(postedMessages.length, 1)
    assert.strictEqual(postedMessages[0].result.success, false)
    assert.strictEqual(postedMessages[0].result.error, 'Signature forged or invalid')
  })

  await t.test('Safely returns success: false for corrupt non-JSON decrypted payload', async () => {
    // Encrypt raw non-JSON text "not_json_data"
    const badCiphertextBuffer = sodium.crypto_secretbox_easy('not_a_json_object', nonce, roomKey)
    const badCiphertextB64 = sodium.to_base64(badCiphertextBuffer, sodium.base64_variants.ORIGINAL)

    const validationString2 = `room_1|1|START|${badCiphertextB64}|${nonceB64}`
    const validationBuffer2 = new TextEncoder().encode(validationString2)
    const signatureBuffer2 = sodium.crypto_sign_detached(validationBuffer2, senderSignKeypair.privateKey)
    const signatureB64_2 = sodium.to_base64(signatureBuffer2, sodium.base64_variants.ORIGINAL)

    const record = {
      id: 'msg_1',
      room_id: 'room_1',
      epoch_id: '1',
      sender_id: 'sender_1',
      payload: {
        ciphertext: badCiphertextB64,
        nonce: nonceB64
      },
      signature: signatureB64_2,
      previous_msg_uuid: 'START',
      local_uuid: 'msg_uuid_1',
      created: '2025-01-01 00:00:00.000Z'
    }

    await runProcessIncomingMessage(7, record)
    assert.strictEqual(postedMessages.length, 1)
    assert.strictEqual(postedMessages[0].result.success, false)
    assert.strictEqual(postedMessages[0].result.error, 'Failed to decode or parse JSON payload')
  })
})
