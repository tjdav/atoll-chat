import { test } from 'node:test'
import assert from 'node:assert'
import { MessageChannel } from 'node:worker_threads'
import { getTransferables } from '../../src/utils/transferables.js'

test('Zero-Copy ArrayBuffer Transfer Tests', async (t) => {
  await t.test('getTransferables extracts direct ArrayBuffer instances', () => {
    const buffer = new ArrayBuffer(16)
    const payload = { data: buffer }
    const transferables = getTransferables(payload)

    assert.strictEqual(transferables.length, 1)
    assert.strictEqual(transferables[0], buffer)
  })

  await t.test('getTransferables extracts underlying ArrayBuffer from TypedArrays', () => {
    const uint8 = new Uint8Array([1, 2, 3, 4])
    const payload = { nested: { array: uint8 } }
    const transferables = getTransferables(payload)

    assert.strictEqual(transferables.length, 1)
    assert.strictEqual(transferables[0], uint8.buffer)
  })

  await t.test('getTransferables handles circular references gracefully without infinite loop', () => {
    const payload = {}
    payload.self = payload
    const transferables = getTransferables(payload)

    assert.strictEqual(transferables.length, 0)
  })

  await t.test('getTransferables handles complex deep structures with multiple buffers', () => {
    const buf1 = new ArrayBuffer(8)
    const buf2 = new ArrayBuffer(12)
    const view = new DataView(buf2)

    const payload = {
      id: 1,
      buffers: [buf1, { view }]
    }

    const transferables = getTransferables(payload)
    assert.strictEqual(transferables.length, 2)
    assert.ok(transferables.includes(buf1))
    assert.ok(transferables.includes(buf2))
  })

  await t.test('Zero-copy postMessage detaches the transferred buffer on sender thread', () => {
    const { port1, port2 } = new MessageChannel()

    const buffer = new ArrayBuffer(32)
    const uint8 = new Uint8Array(buffer)
    uint8[0] = 42

    assert.strictEqual(buffer.byteLength, 32)
    assert.strictEqual(uint8.byteLength, 32)

    const payload = { fileData: uint8 }
    const transferables = getTransferables(payload)

    // Send payload transferring the underlying buffer
    port1.postMessage(payload, transferables)

    // After posting with transfer list, the buffer must be detached
    assert.strictEqual(buffer.byteLength, 0, 'Source ArrayBuffer should be detached')
    assert.strictEqual(uint8.byteLength, 0, 'Uint8Array view should be detached')

    port1.close()
    port2.close()
  })
})
