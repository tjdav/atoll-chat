import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  generateEphemeralKeypair,
  deriveSharedSecret,
  encrypt,
  decrypt,
  encryptCommandResult,
  decryptCommandResult,
  keyObjectFromX25519Private,
  keyObjectFromX25519Public
} from '../../src/runtime/crypto/command-result.js'

// Fixed test keypair A
const privABytes = new Uint8Array(Buffer.alloc(32, 0x11))
const privAKo = keyObjectFromX25519Private(privABytes)
const pubAKo = crypto.createPublicKey(privAKo)
const pubADer = pubAKo.export({ format: 'der', type: 'spki' })
const pubABytes = new Uint8Array(pubADer.subarray(12))

// Fixed test keypair B
const privBBytes = new Uint8Array(Buffer.alloc(32, 0x22))
const privBKo = keyObjectFromX25519Private(privBBytes)
const pubBKo = crypto.createPublicKey(privBKo)
const pubBDer = pubBKo.export({ format: 'der', type: 'spki' })
const pubBBytes = new Uint8Array(pubBDer.subarray(12))

// Fixed test keypair C
const privCBytes = new Uint8Array(Buffer.alloc(32, 0x33))
const privCKo = keyObjectFromX25519Private(privCBytes)
const pubCKo = crypto.createPublicKey(privCKo)
const pubCDer = pubCKo.export({ format: 'der', type: 'spki' })
const pubCBytes = new Uint8Array(pubCDer.subarray(12))

test('1. generateEphemeralKeypair returns 32-byte keys', () => {
  const kp = generateEphemeralKeypair()
  assert.ok(kp.publicKey instanceof Uint8Array)
  assert.equal(kp.publicKey.length, 32)
  assert.ok(kp.privateKey instanceof Uint8Array)
  assert.equal(kp.privateKey.length, 32)
})

test('2. generateEphemeralKeypair produces distinct keypairs', () => {
  const kp1 = generateEphemeralKeypair()
  const kp2 = generateEphemeralKeypair()
  assert.notDeepEqual(kp1.publicKey, kp2.publicKey)
  assert.notDeepEqual(kp1.privateKey, kp2.privateKey)
})

test('3. deriveSharedSecret is symmetric', () => {
  const secret1 = deriveSharedSecret(privABytes, pubBBytes)
  const secret2 = deriveSharedSecret(privBBytes, pubABytes)
  assert.deepEqual(secret1, secret2)
  assert.equal(secret1.length, 32)
})

test('4. deriveSharedSecret rejects wrong-length keys', () => {
  assert.throws(() => deriveSharedSecret(new Uint8Array(31), pubBBytes), /privateKey must be a Uint8Array of length 32/)
  assert.throws(() => deriveSharedSecret(privABytes, new Uint8Array(33)), /peerPublicKey must be a Uint8Array of length 32/)
})

test('5. deriveSharedSecret rejects low-order peer key', () => {
  const zeroPeerKey = new Uint8Array(32)
  assert.throws(
    () => deriveSharedSecret(privABytes, zeroPeerKey),
    /X25519 shared secret is all zeros; peer public key is a low-order point/
  )
})

test('6. encrypt/decrypt round-trip', () => {
  const plaintext = new TextEncoder().encode('hello world')
  const info = 'test-info-v1'
  const ciphertext = encrypt({
    privateKey: privABytes,
    peerPublicKey: pubBBytes,
    info,
    plaintext
  })
  const decrypted = decrypt({
    privateKey: privBBytes,
    peerPublicKey: pubABytes,
    info,
    ciphertext
  })
  assert.deepEqual(decrypted, plaintext)
})

test('7. encrypt output length', () => {
  const plaintext = new TextEncoder().encode('12345') // 5 bytes
  const ciphertext = encrypt({
    privateKey: privABytes,
    peerPublicKey: pubBBytes,
    info: 'test-info',
    plaintext
  })
  // 12 (nonce) + 5 (ct) + 16 (tag) = 33
  assert.equal(ciphertext.length, 33)
})

test('8. encrypt output has a fresh nonce', () => {
  const plaintext = new TextEncoder().encode('same plaintext')
  const info = 'test-info'
  const ct1 = encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info, plaintext })
  const ct2 = encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info, plaintext })
  assert.notDeepEqual(ct1, ct2)
})

test('9. decrypt rejects a tampered tag', () => {
  const plaintext = new TextEncoder().encode('tamper test')
  const info = 'test-info'
  const ciphertext = encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info, plaintext })
  const tampered = new Uint8Array(ciphertext)
  const lastIdx = tampered.length - 1
  tampered[lastIdx] = (tampered[lastIdx] ?? 0) ^ 0x01
  assert.throws(() => {
    decrypt({ privateKey: privBBytes, peerPublicKey: pubABytes, info, ciphertext: tampered })
  })
})

test('10. decrypt rejects a tampered ciphertext', () => {
  const plaintext = new TextEncoder().encode('tamper test body')
  const info = 'test-info'
  const ciphertext = encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info, plaintext })
  const tampered = new Uint8Array(ciphertext)
  tampered[15] = (tampered[15] ?? 0) ^ 0x01 // Bit flip in body
  assert.throws(() => {
    decrypt({ privateKey: privBBytes, peerPublicKey: pubABytes, info, ciphertext: tampered })
  })
})

test('11. decrypt rejects a wrong peer public key', () => {
  const plaintext = new TextEncoder().encode('wrong peer pubkey')
  const info = 'test-info'
  const ciphertext = encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info, plaintext })
  assert.throws(() => {
    decrypt({ privateKey: privBBytes, peerPublicKey: pubCBytes, info, ciphertext })
  })
})

test('12. decrypt rejects a wrong private key', () => {
  const plaintext = new TextEncoder().encode('wrong privkey')
  const info = 'test-info'
  const ciphertext = encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info, plaintext })
  assert.throws(() => {
    decrypt({ privateKey: privCBytes, peerPublicKey: pubABytes, info, ciphertext })
  })
})

test('13. decrypt rejects a mismatched info string', () => {
  const plaintext = new TextEncoder().encode('mismatched info')
  const ciphertext = encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info: 'info-a', plaintext })
  assert.throws(() => {
    decrypt({ privateKey: privBBytes, peerPublicKey: pubABytes, info: 'info-b', ciphertext })
  })
})

test('14. decrypt rejects a short blob', () => {
  const shortBlob = new Uint8Array(20)
  assert.throws(() => {
    decrypt({ privateKey: privBBytes, peerPublicKey: pubABytes, info: 'info', ciphertext: shortBlob })
  }, /ciphertext wire length must be at least 28 bytes/)
})

test('15. decrypt rejects empty input', () => {
  assert.throws(() => {
    decrypt({ privateKey: privBBytes, peerPublicKey: pubABytes, info: 'info', ciphertext: new Uint8Array(0) })
  }, /ciphertext wire length must be at least 28 bytes/)
})

test('16. encryptCommandResult round-trip', () => {
  const clientKp = generateEphemeralKeypair()
  const plaintext = new TextEncoder().encode('command result text')
  const result = encryptCommandResult({ peerPublicKey: clientKp.publicKey, plaintext })

  const decrypted = decryptCommandResult({
    privateKey: clientKp.privateKey,
    peerPublicKey: result.publicKey,
    ciphertext: result.ciphertext
  })
  assert.deepEqual(decrypted, plaintext)
})

test('17. encryptCommandResult uses the fixed info string', () => {
  const clientKp = generateEphemeralKeypair()
  const plaintext = new TextEncoder().encode('fixed info check')
  const result = encryptCommandResult({ peerPublicKey: clientKp.publicKey, plaintext })

  const decrypted = decrypt({
    privateKey: clientKp.privateKey,
    peerPublicKey: result.publicKey,
    info: 'bot-command-result-v1',
    ciphertext: result.ciphertext
  })
  assert.deepEqual(decrypted, plaintext)
})

test('18. encryptCommandResult uses a fresh keypair per call', () => {
  const clientKp = generateEphemeralKeypair()
  const plaintext = new TextEncoder().encode('fresh keypair check')
  const res1 = encryptCommandResult({ peerPublicKey: clientKp.publicKey, plaintext })
  const res2 = encryptCommandResult({ peerPublicKey: clientKp.publicKey, plaintext })

  assert.notDeepEqual(res1.publicKey, res2.publicKey)
  assert.notDeepEqual(res1.ciphertext, res2.ciphertext)
})

test('19. encryptCommandResult rejects a wrong-length peer key', () => {
  const plaintext = new TextEncoder().encode('bad key length')
  assert.throws(() => {
    encryptCommandResult({ peerPublicKey: new Uint8Array(16), plaintext })
  }, /peerPublicKey must be a Uint8Array of length 32/)
})

test('20. Empty plaintext', () => {
  const plaintext = new Uint8Array(0)
  const info = 'empty-test'
  const ciphertext = encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info, plaintext })
  assert.equal(ciphertext.length, 28) // 12 nonce + 16 tag

  const decrypted = decrypt({ privateKey: privBBytes, peerPublicKey: pubABytes, info, ciphertext })
  assert.deepEqual(decrypted, plaintext)
})

test('21. Large plaintext', () => {
  const plaintext = new Uint8Array(1024 * 1024).fill(0xff)
  const info = 'large-test'
  const ciphertext = encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info, plaintext })
  assert.equal(ciphertext.length, 12 + 1024 * 1024 + 16)

  const decrypted = decrypt({ privateKey: privBBytes, peerPublicKey: pubABytes, info, ciphertext })
  assert.deepEqual(decrypted, plaintext)
})

test('22. JSON payload', () => {
  const obj = { type: 'local_message', content: 'hello' }
  const plaintext = new TextEncoder().encode(JSON.stringify(obj))
  const clientKp = generateEphemeralKeypair()

  const result = encryptCommandResult({ peerPublicKey: clientKp.publicKey, plaintext })
  const decryptedBytes = decryptCommandResult({
    privateKey: clientKp.privateKey,
    peerPublicKey: result.publicKey,
    ciphertext: result.ciphertext
  })

  const recoveredObj = JSON.parse(new TextDecoder().decode(decryptedBytes))
  assert.deepEqual(recoveredObj, obj)
})

test('23. Binary safety', () => {
  const bytes = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    bytes[i] = i
  }
  const info = 'binary-safety'
  const ciphertext = encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info, plaintext: bytes })
  const decrypted = decrypt({ privateKey: privBBytes, peerPublicKey: pubABytes, info, ciphertext })
  assert.deepEqual(decrypted, bytes)
})

test('24. encrypt rejects a wrong-length private key', () => {
  const plaintext = new TextEncoder().encode('bad privkey')
  assert.throws(() => {
    encrypt({ privateKey: new Uint8Array(16), peerPublicKey: pubBBytes, info: 'info', plaintext })
  }, /privateKey must be a Uint8Array of length 32/)
})

test('25. encrypt rejects an empty info string', () => {
  const plaintext = new TextEncoder().encode('bad info')
  assert.throws(() => {
    encrypt({ privateKey: privABytes, peerPublicKey: pubBBytes, info: '', plaintext })
  }, /info must be a non-empty string/)
})

test('26. decrypt rejects an empty info string', () => {
  const ciphertext = new Uint8Array(30)
  assert.throws(() => {
    decrypt({ privateKey: privBBytes, peerPublicKey: pubABytes, info: '', ciphertext })
  }, /info must be a non-empty string/)
})

test('Helper keyObjectFromX25519Public validation', () => {
  assert.throws(() => keyObjectFromX25519Public(new Uint8Array(10)), /publicKey must be a Uint8Array of length 32/)
})
