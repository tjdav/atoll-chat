import { test } from 'node:test'
import assert from 'node:assert'
import { normalizeUsername, deriveAuthAndVaultKeys } from '../../src/utils/keys.js'

test('keys utility tests', async (t) => {
  await t.test('normalizeUsername trims and converts to lowercase', () => {
    assert.strictEqual(normalizeUsername('  Alice  '), 'alice')
    assert.strictEqual(normalizeUsername('ALICE'), 'alice')
    assert.strictEqual(normalizeUsername('alice'), 'alice')
    assert.strictEqual(normalizeUsername(''), '')
    assert.strictEqual(normalizeUsername(null), '')
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
})
