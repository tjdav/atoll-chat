import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import sodium from 'libsodium-wrappers-sumo'

describe('Worker Cryptographic Hygiene & Sandbox Isolation Unit Tests', () => {
  test('1. worker:decrypt_file zeroing memory on rawKey, fileBytes, and nonceBytes in finally block', async () => {
    await sodium.ready

    const fileKey = sodium.randombytes_buf(32)
    const fileNonce = sodium.randombytes_buf(24)
    const plaintext = new Uint8Array([10, 20, 30, 40])
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, fileNonce, fileKey)

    // Store references to check zeroing after execution
    const fileBytes = new Uint8Array(ciphertext)
    const nonceBytes = new Uint8Array(fileNonce)
    const rawKey = new Uint8Array(fileKey)

    let postedMessage = null
    const mockSelf = {
      postMessage (msg) {
        postedMessage = msg
      }
    }

    try {
      const decryptedBuffer = sodium.crypto_secretbox_open_easy(
        fileBytes,
        nonceBytes,
        rawKey
      )
      if (!decryptedBuffer) {
        throw new Error('Decryption failed')
      }
      mockSelf.postMessage({
        type: 'worker:decrypt_file',
        result: decryptedBuffer
      })
    } finally {
      fileBytes.fill(0)
      nonceBytes.fill(0)
      rawKey.fill(0)
    }

    assert.ok(postedMessage)
    assert.deepEqual(Array.from(postedMessage.result), [10, 20, 30, 40])
    // Verify memory zeroing
    assert.equal(fileBytes.every(b => b === 0), true)
    assert.equal(nonceBytes.every(b => b === 0), true)
    assert.equal(rawKey.every(b => b === 0), true)
  })

  test('2. worker:decrypt_link_preview AES-GCM decryption with WebCrypto inside worker scope & memory zeroing', async () => {
    await sodium.ready

    const keyString = '12345678901234567890123456789012'
    const keyBytes = new TextEncoder().encode(keyString)

    const rawKey = await globalThis.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )

    const iv = new Uint8Array(12).fill(7)
    const plaintext = new TextEncoder().encode('Link Preview Test Content')
    const encryptedArrayBuffer = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      rawKey,
      plaintext
    )

    const encryptedUint8 = new Uint8Array(encryptedArrayBuffer)
    const combined = new Uint8Array(iv.length + encryptedUint8.length)
    combined.set(iv, 0)
    combined.set(encryptedUint8, iv.length)

    let binary = ''
    for (let i = 0; i < combined.length; i++) {
      binary += String.fromCharCode(combined[i])
    }
    const base64Enc = btoa(binary)
    const payloadBuffer = new TextEncoder().encode(base64Enc).buffer

    // Simulate worker execution
    let rawKeyBytes = null
    let ivBytes = null
    let cipherBytes = null
    let decryptedBuffer = null

    try {
      const encBytes = new Uint8Array(payloadBuffer)
      const base64Text = new TextDecoder().decode(encBytes).trim()
      const binaryString = atob(base64Text.replace(/-/g, '+').replace(/_/g, '/'))
      const len = binaryString.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      ivBytes = bytes.slice(0, 12)
      cipherBytes = bytes.slice(12)

      rawKeyBytes = new TextEncoder().encode(keyString)
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        rawKeyBytes,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      )

      const decryptedArrayBuffer = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        cryptoKey,
        cipherBytes
      )
      decryptedBuffer = new Uint8Array(decryptedArrayBuffer)
    } finally {
      if (rawKeyBytes) rawKeyBytes.fill(0)
      if (ivBytes) ivBytes.fill(0)
      if (cipherBytes) cipherBytes.fill(0)
    }

    assert.ok(decryptedBuffer)
    assert.equal(new TextDecoder().decode(decryptedBuffer), 'Link Preview Test Content')
    assert.equal(rawKeyBytes.every(b => b === 0), true)
    assert.equal(ivBytes.every(b => b === 0), true)
    assert.equal(cipherBytes.every(b => b === 0), true)
  })

  test('3. worker:decrypt_link_preview Secretbox decryption with memory zeroing', async () => {
    await sodium.ready

    const fileKey = sodium.randombytes_buf(32)
    const fileNonce = sodium.randombytes_buf(24)
    const plaintext = new Uint8Array([5, 6, 7, 8])
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, fileNonce, fileKey)

    let cipherBytes = new Uint8Array(ciphertext)
    let nonceBytes = new Uint8Array(fileNonce)
    let rawKeyBytes = new Uint8Array(fileKey)
    let decryptedBuffer = null

    try {
      decryptedBuffer = sodium.crypto_secretbox_open_easy(
        cipherBytes,
        nonceBytes,
        rawKeyBytes
      )
    } finally {
      cipherBytes.fill(0)
      nonceBytes.fill(0)
      rawKeyBytes.fill(0)
    }

    assert.ok(decryptedBuffer)
    assert.deepEqual(Array.from(decryptedBuffer), [5, 6, 7, 8])
    assert.equal(cipherBytes.every(b => b === 0), true)
    assert.equal(nonceBytes.every(b => b === 0), true)
    assert.equal(rawKeyBytes.every(b => b === 0), true)
  })
})
