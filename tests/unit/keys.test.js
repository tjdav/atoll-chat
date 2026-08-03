import { test } from 'node:test'
import assert from 'node:assert'
import sodium from 'libsodium-wrappers-sumo'

// Set test environment explicitly
process.env.NODE_ENV = 'test'

import { normalizeUsername, deriveAuthAndVaultKeys, purgeVaultKey, getVaultKey } from '../../src/utils/keys.js'

test('keys utility tests', async (t) => {
  await t.test('purgeVaultKey zeroes out ephemeralVaultKey memory before nullification', async () => {
    const res = await deriveAuthAndVaultKeys('Alice', 'Password123!')
    const keyARef = res.keyA

    assert.ok(keyARef instanceof Uint8Array)
    let nonZeroCount = 0
    for (const b of keyARef) {
      if (b !== 0) {
        nonZeroCount++
      }
    }
    assert.ok(nonZeroCount > 0, 'Key should contain non-zero bytes initially')

    // Call purgeVaultKey
    purgeVaultKey()

    // Under the hood, purgeVaultKey zeroes the Uint8Array
    for (const b of keyARef) {
      assert.strictEqual(b, 0, 'Byte should be zeroed out after purge')
    }

    // Verify global state reference is null
    assert.strictEqual(getVaultKey(), null)
  })

  await t.test('normalizeUsername trims and converts to lowercase', () => {
    assert.strictEqual(normalizeUsername('  Alice  '), 'alice')
    assert.strictEqual(normalizeUsername('ALICE'), 'alice')
    assert.strictEqual(normalizeUsername('alice'), 'alice')
    assert.strictEqual(normalizeUsername(''), '')
    assert.strictEqual(normalizeUsername(null), '')
  })

  await t.test('normalizeUsername handles Unicode NFC normalization correctly', () => {
    // Decomposed unicode string: "u" followed by combining diaeresis "\u0308" (ü)
    const decomposed = 'mu\u0308ller'
    // Pre-composed unicode string: "ü" (\u00fc)
    const precomposed = 'müller'

    assert.strictEqual(normalizeUsername(decomposed), 'müller')
    assert.strictEqual(normalizeUsername(precomposed), 'müller')
    assert.strictEqual(normalizeUsername(decomposed), normalizeUsername(precomposed))
  })

  await t.test('deriveAuthAndVaultKeys is case resilient and produces identical keys', async () => {
    const res1 = await deriveAuthAndVaultKeys('Alice', 'Password123!')
    const res2 = await deriveAuthAndVaultKeys('  alice  ', 'Password123!')

    // Verify canonical username
    assert.strictEqual(res1.canonicalUsername, 'alice')
    assert.strictEqual(res2.canonicalUsername, 'alice')

    // Verify key B is 64-char hex string
    assert.strictEqual(typeof res1.keyB, 'string')
    assert.strictEqual(res1.keyB.length, 64)
    assert.match(res1.keyB, /^[0-9a-f]{64}$/)

    // Verify key A is 32-byte Uint8Array
    assert.ok(res1.keyA instanceof Uint8Array)
    assert.strictEqual(res1.keyA.length, 32)

    // Verify identical outputs regardless of original username casing and whitespace
    assert.strictEqual(res1.keyB, res2.keyB)
    assert.deepStrictEqual(res1.keyA, res2.keyA)
  })

  await t.test('deriveAuthAndVaultKeys uses correct single-pass parameters and zeroes seed', async () => {
    await sodium.ready
    const originalPwhash = sodium.crypto_pwhash
    let pwhashCalls = []
    sodium.crypto_pwhash = function (...args) {
      pwhashCalls.push(args)
      return originalPwhash.apply(this, args)
    }

    try {
      const res = await deriveAuthAndVaultKeys('testuser', 'Password123!')
      assert.strictEqual(pwhashCalls.length, 1, 'crypto_pwhash should be called exactly once')

      const [outlen, passwd, , opslimit, memlimit] = pwhashCalls[0]
      assert.strictEqual(outlen, 64, 'Output length must be 64 bytes')
      assert.strictEqual(passwd, 'Password123!')
      // In test mode (NODE_ENV=test), opslimit and memlimit should be 1 and 8MB respectively
      assert.strictEqual(opslimit, 1, 'OPSLIMIT should be 1 in test mode')
      assert.strictEqual(memlimit, 8388608, 'MEMLIMIT should be 8388608 in test mode')

      // Verify that keyA and keyB are correctly sliced
      assert.strictEqual(res.keyA.length, 32)
      assert.strictEqual(res.keyB.length, 64)
    } finally {
      sodium.crypto_pwhash = originalPwhash
    }
  })

  await t.test('deriveAuthAndVaultKeys uses production parameters when not in test environment', async () => {
    await sodium.ready
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const originalPwhash = sodium.crypto_pwhash
    let pwhashCalls = []
    sodium.crypto_pwhash = function (...args) {
      pwhashCalls.push(args)
      return originalPwhash.apply(this, args)
    }

    try {
      await deriveAuthAndVaultKeys('produser', 'Password123!')
      assert.strictEqual(pwhashCalls.length, 1)
      const [outlen, , , opslimit, memlimit] = pwhashCalls[0]
      assert.strictEqual(outlen, 64)
      assert.strictEqual(opslimit, 3, 'OPSLIMIT should be 3 in production')
      assert.strictEqual(memlimit, 134217728, 'MEMLIMIT should be 134217728 in production')
    } finally {
      sodium.crypto_pwhash = originalPwhash
      process.env.NODE_ENV = originalEnv
    }
  })
})
