import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  encrypt,
  generateEphemeralKeypair,
  keyObjectFromX25519Private
} from '../../src/runtime/crypto/command-result.js'
import {
  decryptSettingsValue,
  parseSettingsWire,
  SETTINGS_INFO
} from '../../src/runtime/crypto/settings.js'

/**
 * Mimics client-side settings encryption.
 * Generates an ephemeral keypair, encrypts plaintext under "bot-settings-v1",
 * and produces base64url(ephemeral_pub(32) || nonce(12) || ct || tag(16)).
 *
 * @param {object} params
 * @param {Uint8Array} params.botCommandPublicKey
 * @param {Uint8Array} params.plaintext
 * @returns {string} The base64url wire string.
 */
function clientEncryptSettings ({ botCommandPublicKey, plaintext }) {
  const ephemeral = generateEphemeralKeypair()
  const inner = encrypt({
    privateKey: ephemeral.privateKey,
    peerPublicKey: botCommandPublicKey,
    info: SETTINGS_INFO,
    plaintext
  })
  const wire = Buffer.concat([ephemeral.publicKey, inner])
  return wire.toString('base64url')
}

describe('Settings Decryption & Crypto (B-016)', () => {
  // Fixed test keypair for bot command key
  const botCommandPrivateKeyBytes = new Uint8Array(Buffer.alloc(32, 0x33))
  const botPrivKo = keyObjectFromX25519Private(botCommandPrivateKeyBytes)
  const botPubKo = crypto.createPublicKey(botPrivKo)
  const spkiDer = botPubKo.export({ format: 'der', type: 'spki' })
  const botCommandPublicKeyBytes = new Uint8Array(spkiDer.subarray(12))

  test('1. Round-trip with a short plaintext', () => {
    const plaintext = new Uint8Array(Buffer.from('hello', 'utf8'))
    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const decrypted = decryptSettingsValue({
      encryptedBase64url,
      botCommandPrivateKey: botCommandPrivateKeyBytes
    })

    assert.deepEqual(decrypted, plaintext)
  })

  test('2. Round-trip with empty plaintext', () => {
    const plaintext = new Uint8Array(0)
    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const decrypted = decryptSettingsValue({
      encryptedBase64url,
      botCommandPrivateKey: botCommandPrivateKeyBytes
    })

    assert.equal(decrypted.length, 0)
    assert.deepEqual(decrypted, plaintext)
  })

  test('3. Round-trip with a large plaintext (1 MiB)', () => {
    const plaintext = new Uint8Array(1024 * 1024).fill(0xff)
    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const decrypted = decryptSettingsValue({
      encryptedBase64url,
      botCommandPrivateKey: botCommandPrivateKeyBytes
    })

    assert.equal(decrypted.length, 1024 * 1024)
    assert.deepEqual(decrypted, plaintext)
  })

  test('4. Round-trip with a JSON payload', () => {
    const obj = { apiToken: 'sk-1234567890abcdef', enabled: true, rateLimit: 100 }
    const plaintext = new Uint8Array(Buffer.from(JSON.stringify(obj), 'utf8'))
    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const decrypted = decryptSettingsValue({
      encryptedBase64url,
      botCommandPrivateKey: botCommandPrivateKeyBytes
    })

    const parsed = JSON.parse(Buffer.from(decrypted).toString('utf8'))
    assert.deepEqual(parsed, obj)
  })

  test('5. Round-trip with binary-safe plaintext', () => {
    const plaintext = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      plaintext[i] = i
    }

    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const decrypted = decryptSettingsValue({
      encryptedBase64url,
      botCommandPrivateKey: botCommandPrivateKeyBytes
    })

    assert.deepEqual(decrypted, plaintext)
  })

  test('6. Base64url unpadded input accepted', () => {
    const plaintext = new Uint8Array(Buffer.from('unpadded test', 'utf8'))
    const paddedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })
    const unpaddedBase64url = paddedBase64url.replace(/=+$/, '')

    const decrypted = decryptSettingsValue({
      encryptedBase64url: unpaddedBase64url,
      botCommandPrivateKey: botCommandPrivateKeyBytes
    })

    assert.deepEqual(decrypted, plaintext)
  })

  test('7. Base64url padded input accepted', () => {
    const plaintext = new Uint8Array(Buffer.from('padded test', 'utf8'))
    let base64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })
    // Ensure padding is added if missing
    while (base64url.length % 4 !== 0) {
      base64url += '='
    }

    const decrypted = decryptSettingsValue({
      encryptedBase64url: base64url,
      botCommandPrivateKey: botCommandPrivateKeyBytes
    })

    assert.deepEqual(decrypted, plaintext)
  })

  test('8. Wrong bot private key throws', () => {
    const plaintext = new Uint8Array(Buffer.from('secret payload', 'utf8'))
    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const wrongPrivateKey = new Uint8Array(Buffer.alloc(32, 0x44))

    assert.throws(() => {
      decryptSettingsValue({
        encryptedBase64url,
        botCommandPrivateKey: wrongPrivateKey
      })
    }, /Unsupported state or unable to authenticate data|tag|authenticate/i)
  })

  test('10. Tampered ciphertext throws', () => {
    const plaintext = new Uint8Array(Buffer.from('tamper test', 'utf8'))
    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const wire = Buffer.from(encryptedBase64url, 'base64url')
    // Flip a bit in the middle of ciphertext
    const targetByte = wire[48]
    if (targetByte !== undefined) {
      wire[48] = targetByte ^ 0x01
    }
    const tamperedBase64url = wire.toString('base64url')

    assert.throws(() => {
      decryptSettingsValue({
        encryptedBase64url: tamperedBase64url,
        botCommandPrivateKey: botCommandPrivateKeyBytes
      })
    })
  })

  test('11. Tampered ephemeral public key throws', () => {
    const plaintext = new Uint8Array(Buffer.from('tampered pubkey test', 'utf8'))
    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const wire = Buffer.from(encryptedBase64url, 'base64url')
    // Generate another valid non-low-order ephemeral key
    const otherEphemeral = generateEphemeralKeypair()
    wire.set(otherEphemeral.publicKey, 0)
    const tamperedBase64url = wire.toString('base64url')

    assert.throws(() => {
      decryptSettingsValue({
        encryptedBase64url: tamperedBase64url,
        botCommandPrivateKey: botCommandPrivateKeyBytes
      })
    })
  })

  test('12. Tampered tag throws', () => {
    const plaintext = new Uint8Array(Buffer.from('tampered tag test', 'utf8'))
    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const wire = Buffer.from(encryptedBase64url, 'base64url')
    // Flip a bit in the tag (last byte)
    const lastByteIndex = wire.length - 1
    const lastByte = wire[lastByteIndex]
    if (lastByte !== undefined) {
      wire[lastByteIndex] = lastByte ^ 0x01
    }
    const tamperedBase64url = wire.toString('base64url')

    assert.throws(() => {
      decryptSettingsValue({
        encryptedBase64url: tamperedBase64url,
        botCommandPrivateKey: botCommandPrivateKeyBytes
      })
    })
  })

  test('13. Too-short input throws', () => {
    const shortWire = new Uint8Array(59).fill(0xaa)
    const shortBase64url = Buffer.from(shortWire).toString('base64url')

    assert.throws(() => {
      decryptSettingsValue({
        encryptedBase64url: shortBase64url,
        botCommandPrivateKey: botCommandPrivateKeyBytes
      })
    }, /at least 60 bytes/i)
  })

  test('14. Empty string input throws', () => {
    assert.throws(() => {
      decryptSettingsValue({
        encryptedBase64url: '',
        botCommandPrivateKey: botCommandPrivateKeyBytes
      })
    }, /non-empty string/i)
  })

  test('15. Non-string input throws', () => {
    assert.throws(() => {
      decryptSettingsValue({
        // @ts-expect-error Testing non-string input
        encryptedBase64url: 12345,
        botCommandPrivateKey: botCommandPrivateKeyBytes
      })
    }, /non-empty string/i)
  })

  test('16. Invalid base64url input throws', () => {
    assert.throws(() => {
      decryptSettingsValue({
        encryptedBase64url: 'invalid!base64url@chars',
        botCommandPrivateKey: botCommandPrivateKeyBytes
      })
    }, /invalid base64url characters/i)
  })

  test('17. Wrong-length private key throws', () => {
    const plaintext = new Uint8Array(Buffer.from('test', 'utf8'))
    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    assert.throws(() => {
      decryptSettingsValue({
        encryptedBase64url,
        botCommandPrivateKey: new Uint8Array(31)
      })
    }, /length 32/i)

    assert.throws(() => {
      decryptSettingsValue({
        encryptedBase64url,
        botCommandPrivateKey: new Uint8Array(33)
      })
    }, /length 32/i)
  })

  test('18. parseSettingsWire on a valid wire returns three components', () => {
    const wire = new Uint8Array(100).fill(0x01)
    const { ephemeralPublicKey, nonce, ciphertext } = parseSettingsWire(wire)

    assert.equal(ephemeralPublicKey.length, 32)
    assert.equal(nonce.length, 12)
    assert.equal(ciphertext.length, 56)
  })

  test('19. parseSettingsWire on a wire of exactly 60 bytes returns an empty ciphertext', () => {
    const wire = new Uint8Array(60).fill(0x02)
    const { ephemeralPublicKey, nonce, ciphertext } = parseSettingsWire(wire)

    assert.equal(ephemeralPublicKey.length, 32)
    assert.equal(nonce.length, 12)
    assert.equal(ciphertext.length, 16) // 16-byte GCM tag, 0-byte ciphertext body
  })

  test('20. parseSettingsWire on a wire of 59 bytes throws', () => {
    const wire = new Uint8Array(59).fill(0x03)

    assert.throws(() => {
      parseSettingsWire(wire)
    }, /at least 60 bytes/i)
  })

  test('21. Low-order ephemeral public key throws', () => {
    // All-zero 32-byte ephemeral public key is low-order
    const lowOrderKey = new Uint8Array(32)
    const nonce = new Uint8Array(12).fill(0x01)
    const ciphertext = new Uint8Array(16).fill(0x02) // tag

    const wire = Buffer.concat([lowOrderKey, nonce, ciphertext])
    const encryptedBase64url = wire.toString('base64url')

    assert.throws(() => {
      decryptSettingsValue({
        encryptedBase64url,
        botCommandPrivateKey: botCommandPrivateKeyBytes
      })
    }, /low-order point/i)
  })

  test('22. SETTINGS_INFO is the expected string', () => {
    assert.equal(SETTINGS_INFO, 'bot-settings-v1')
  })

  test('23. Deterministic decryption', () => {
    const plaintext = new Uint8Array(Buffer.from('deterministic decryption check', 'utf8'))
    const encryptedBase64url = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const decrypted1 = decryptSettingsValue({
      encryptedBase64url,
      botCommandPrivateKey: botCommandPrivateKeyBytes
    })

    const decrypted2 = decryptSettingsValue({
      encryptedBase64url,
      botCommandPrivateKey: botCommandPrivateKeyBytes
    })

    assert.deepEqual(decrypted1, plaintext)
    assert.deepEqual(decrypted2, plaintext)
    assert.deepEqual(decrypted1, decrypted2)
  })

  test('24. Ephemeral key not reused between encryptions', () => {
    const plaintext = new Uint8Array(Buffer.from('fresh key test', 'utf8'))

    const wire1Str = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    const wire2Str = clientEncryptSettings({
      botCommandPublicKey: botCommandPublicKeyBytes,
      plaintext
    })

    assert.notEqual(wire1Str, wire2Str)

    const wire1 = Buffer.from(wire1Str, 'base64url')
    const wire2 = Buffer.from(wire2Str, 'base64url')

    const parsed1 = parseSettingsWire(wire1)
    const parsed2 = parseSettingsWire(wire2)

    assert.notDeepEqual(parsed1.ephemeralPublicKey, parsed2.ephemeralPublicKey)
    assert.notDeepEqual(parsed1.nonce, parsed2.nonce)
  })
})
