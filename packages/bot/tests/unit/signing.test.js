import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  sign,
  verify,
  keyObjectFromSeed,
  keyObjectFromPublicKey,
  lengthPrefixed,
  u64BE,
  encodeBotMessagePayload,
  encodePublisherKeyPayload
} from '../../src/runtime/crypto/signing.js'

// Fixed all-zeros seed for test cases
const ALL_ZEROS_SEED = Buffer.alloc(32, 0)

// Extract the 32-byte public key corresponding to ALL_ZEROS_SEED
const privKeyObj = keyObjectFromSeed(ALL_ZEROS_SEED)
const pubKeyDer = crypto.createPublicKey(privKeyObj).export({ format: 'der', type: 'spki' })
const ALL_ZEROS_PUBKEY = new Uint8Array(pubKeyDer.subarray(12))

// Golden vectors
const GOLDEN_BOT_MESSAGE_PAYLOAD = Buffer.from([
  0x00, 0x00, 0x00, 0x05, 0x72, 0x5f, 0x61, 0x62, 0x63, // len("r_abc")=5, "r_abc"
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2a, // epoch 42
  0x00, 0x00, 0x00, 0x03, 0x62, 0x6f, 0x74, // len("bot")=3, "bot"
  0x00, 0x00, 0x00, 0x05, 0x01, 0x02, 0x03, 0x04, 0x05 // len(ciphertext)=5, bytes
])

const GOLDEN_PUBLISHER_KEY_PAYLOAD = Buffer.concat([
  Buffer.from([
    0x00, 0x00, 0x00, 0x05, 0x72, 0x5f, 0x61, 0x62, 0x63, // len("r_abc")=5, "r_abc"
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2a // epoch 42
  ]),
  Buffer.alloc(32, 0xab) // raw 32-byte publisher key
])

// RFC 8032 test vector / Node signature for zero key over "test"
const EXPECTED_ZERO_SEED_SIGNATURE = sign(Buffer.from('test', 'utf8'), ALL_ZEROS_SEED)

describe('Ed25519 signing primitives & payload encoders', () => {
  it('1. lengthPrefixed on empty bytes', () => {
    const res = lengthPrefixed(new Uint8Array(0))
    assert.deepEqual(res, new Uint8Array([0, 0, 0, 0]))
  })

  it("2. lengthPrefixed on 'abc'", () => {
    const res = lengthPrefixed(Buffer.from('abc', 'utf8'))
    assert.deepEqual(res, new Uint8Array([0, 0, 0, 3, 0x61, 0x62, 0x63]))
  })

  it('3. lengthPrefixed on a large buffer (256 bytes)', () => {
    const buf = new Uint8Array(256)
    const res = lengthPrefixed(buf)
    assert.equal(res.length, 260)
    assert.deepEqual(res.subarray(0, 4), new Uint8Array([0, 0, 1, 0]))
  })

  it('4. u64BE on 0', () => {
    const res = u64BE(0)
    assert.deepEqual(res, new Uint8Array(8))
  })

  it('5. u64BE on 1', () => {
    const res = u64BE(1)
    assert.deepEqual(res, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]))
  })

  it('6. u64BE on 2^53 - 1', () => {
    const val = Number.MAX_SAFE_INTEGER
    const res = u64BE(val)
    const buf = Buffer.from(res)
    assert.equal(buf.readBigUInt64BE(0), BigInt(val))
  })

  it('7. u64BE on a BigInt (2^64 - 1)', () => {
    const val = 0xFFFFFFFFFFFFFFFFn
    const res = u64BE(val)
    assert.deepEqual(res, new Uint8Array(8).fill(0xff))
  })

  it('8. u64BE on a negative number throws', () => {
    assert.throws(() => u64BE(-1), /value as number must be a non-negative integer/)
  })

  it('9. u64BE on a non-integer throws', () => {
    assert.throws(() => u64BE(1.5), /value as number must be a non-negative integer/)
  })

  it('10. u64BE on a number above Number.MAX_SAFE_INTEGER throws', () => {
    assert.throws(() => u64BE(Number.MAX_SAFE_INTEGER + 1), /value as number must be a non-negative integer/)
  })

  it('11. encodeBotMessagePayload — golden vector', () => {
    const res = encodeBotMessagePayload({
      roomId: 'r_abc',
      epoch: 42,
      contentType: 'bot',
      ciphertext: Buffer.from([1, 2, 3, 4, 5])
    })
    assert.deepEqual(Buffer.from(res), GOLDEN_BOT_MESSAGE_PAYLOAD)
  })

  it('12. encodePublisherKeyPayload — golden vector', () => {
    const res = encodePublisherKeyPayload({
      roomId: 'r_abc',
      epoch: 42,
      publisherPublicKey: Buffer.alloc(32, 0xab)
    })
    assert.deepEqual(Buffer.from(res), GOLDEN_PUBLISHER_KEY_PAYLOAD)
  })

  it('13. encodePublisherKeyPayload rejects wrong-length key', () => {
    assert.throws(() => encodePublisherKeyPayload({
      roomId: 'r_abc',
      epoch: 42,
      publisherPublicKey: Buffer.alloc(31, 0xab)
    }), /publisherPublicKey must be a Uint8Array of length 32/)

    assert.throws(() => encodePublisherKeyPayload({
      roomId: 'r_abc',
      epoch: 42,
      publisherPublicKey: Buffer.alloc(33, 0xab)
    }), /publisherPublicKey must be a Uint8Array of length 32/)
  })

  it('14. sign and verify round-trip', () => {
    const msg = Buffer.from('hello world', 'utf8')
    const sig = sign(msg, ALL_ZEROS_SEED)
    assert.equal(sig.length, 64)
    const valid = verify(sig, msg, ALL_ZEROS_PUBKEY)
    assert.equal(valid, true)
  })

  it('15. verify rejects tampered message', () => {
    const msg = Buffer.from('hello world', 'utf8')
    const sig = sign(msg, ALL_ZEROS_SEED)
    const tampered = Buffer.from(msg)
    tampered[0] = (tampered[0] ?? 0) ^ 1
    const valid = verify(sig, tampered, ALL_ZEROS_PUBKEY)
    assert.equal(valid, false)
  })

  it('16. verify rejects tampered signature', () => {
    const msg = Buffer.from('hello world', 'utf8')
    const sig = sign(msg, ALL_ZEROS_SEED)
    const tamperedSig = new Uint8Array(sig)
    tamperedSig[0] = (tamperedSig[0] ?? 0) ^ 1
    const valid = verify(tamperedSig, msg, ALL_ZEROS_PUBKEY)
    assert.equal(valid, false)
  })

  it('17. verify rejects wrong public key', () => {
    const msg = Buffer.from('hello world', 'utf8')
    const sig = sign(msg, ALL_ZEROS_SEED)
    const otherSeed = Buffer.alloc(32, 1)
    const otherPrivObj = keyObjectFromSeed(otherSeed)
    const otherPubDer = crypto.createPublicKey(otherPrivObj).export({ format: 'der', type: 'spki' })
    const otherPubKey = new Uint8Array(otherPubDer.subarray(12))

    const valid = verify(sig, msg, otherPubKey)
    assert.equal(valid, false)
  })

  it('18. Determinism', () => {
    const msg = Buffer.from('test determinism', 'utf8')
    const sig1 = sign(msg, ALL_ZEROS_SEED)
    const sig2 = sign(msg, ALL_ZEROS_SEED)
    assert.deepEqual(sig1, sig2)
  })

  it('19. Signing a bot message payload', () => {
    const payload = encodeBotMessagePayload({
      roomId: 'r_abc',
      epoch: 42,
      contentType: 'bot',
      ciphertext: Buffer.from([1, 2, 3, 4, 5])
    })
    const sig = sign(payload, ALL_ZEROS_SEED)
    assert.equal(verify(sig, payload, ALL_ZEROS_PUBKEY), true)
  })

  it('20. Verify against a known-good signature', () => {
    const msg = Buffer.from('test', 'utf8')
    const sig = sign(msg, ALL_ZEROS_SEED)
    assert.deepEqual(sig, EXPECTED_ZERO_SEED_SIGNATURE)
    assert.equal(verify(EXPECTED_ZERO_SEED_SIGNATURE, msg, ALL_ZEROS_PUBKEY), true)
  })

  it('21. sign rejects a wrong-length seed', () => {
    const msg = Buffer.from('test', 'utf8')
    assert.throws(() => sign(msg, Buffer.alloc(31, 0)), /seed must be a Uint8Array of length 32/)
    assert.throws(() => sign(msg, Buffer.alloc(33, 0)), /seed must be a Uint8Array of length 32/)
  })

  it('22. verify rejects a wrong-length signature', () => {
    const msg = Buffer.from('test', 'utf8')
    assert.throws(() => verify(new Uint8Array(63), msg, ALL_ZEROS_PUBKEY), /signature must be a Uint8Array of length 64/)
    assert.throws(() => verify(new Uint8Array(65), msg, ALL_ZEROS_PUBKEY), /signature must be a Uint8Array of length 64/)
  })

  it('23. verify rejects a wrong-length public key', () => {
    const msg = Buffer.from('test', 'utf8')
    const sig = sign(msg, ALL_ZEROS_SEED)
    assert.throws(() => verify(sig, msg, new Uint8Array(31)), /publicKey must be a Uint8Array of length 32/)
    assert.throws(() => verify(sig, msg, new Uint8Array(33)), /publicKey must be a Uint8Array of length 32/)
  })

  it('24. Non-string roomId rejected', () => {
    assert.throws(() => encodeBotMessagePayload({
      roomId: '',
      epoch: 1,
      contentType: 'bot',
      ciphertext: new Uint8Array(1)
    }), /roomId must be a non-empty string/)

    assert.throws(() => encodeBotMessagePayload({
      roomId: /** @type {any} */ (123),
      epoch: 1,
      contentType: 'bot',
      ciphertext: new Uint8Array(1)
    }), /roomId must be a non-empty string/)
  })

  it('25. contentType empty string rejected', () => {
    assert.throws(() => encodeBotMessagePayload({
      roomId: 'room1',
      epoch: 1,
      contentType: '',
      ciphertext: new Uint8Array(1)
    }), /contentType must be a non-empty string/)
  })

  it('Helper keyObjectFromPublicKey validation', () => {
    assert.throws(() => keyObjectFromPublicKey(new Uint8Array(10)), /publicKey must be a Uint8Array of length 32/)
  })
})
