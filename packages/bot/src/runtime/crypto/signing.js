import crypto from 'node:crypto'

/**
 * PKCS#8 DER prefix for Ed25519 private keys.
 */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

/**
 * SPKI DER prefix for Ed25519 public keys.
 */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * Creates a Node.js KeyObject for an Ed25519 private key seed.
 *
 * @param {Uint8Array} seed - The 32-byte seed.
 * @returns {import('node:crypto').KeyObject} The private key.
 */
export function keyObjectFromSeed (seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new Error('seed must be a Uint8Array of length 32')
  }
  const der = Buffer.concat([PKCS8_PREFIX, seed])
  return crypto.createPrivateKey({
    key: der,
    format: 'der',
    type: 'pkcs8'
  })
}

/**
 * Creates a Node.js KeyObject for an Ed25519 public key.
 *
 * @param {Uint8Array} publicKey - The 32-byte public key.
 * @returns {import('node:crypto').KeyObject} The public key.
 */
export function keyObjectFromPublicKey (publicKey) {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
    throw new Error('publicKey must be a Uint8Array of length 32')
  }
  const der = Buffer.concat([SPKI_PREFIX, publicKey])
  return crypto.createPublicKey({
    key: der,
    format: 'der',
    type: 'spki'
  })
}

/**
 * Signs a message with an Ed25519 private key.
 *
 * @param {Uint8Array} message - The bytes to sign.
 * @param {Uint8Array} privateKeySeed - The 32-byte Ed25519 seed.
 * @returns {Uint8Array} The 64-byte signature.
 */
export function sign (message, privateKeySeed) {
  if (!(message instanceof Uint8Array)) {
    throw new Error('message must be a Uint8Array')
  }
  const keyObject = keyObjectFromSeed(privateKeySeed)
  const sig = crypto.sign(null, message, keyObject)
  return new Uint8Array(sig.buffer, sig.byteOffset, sig.byteLength)
}

/**
 * Verifies an Ed25519 signature.
 *
 * @param {Uint8Array} signature - The 64-byte signature.
 * @param {Uint8Array} message - The bytes the signature covers.
 * @param {Uint8Array} publicKey - The 32-byte Ed25519 public key.
 * @returns {boolean} True when the signature is valid.
 */
export function verify (signature, message, publicKey) {
  if (!(signature instanceof Uint8Array) || signature.length !== 64) {
    throw new Error('signature must be a Uint8Array of length 64')
  }
  if (!(message instanceof Uint8Array)) {
    throw new Error('message must be a Uint8Array')
  }
  const keyObject = keyObjectFromPublicKey(publicKey)
  return crypto.verify(null, message, keyObject, signature)
}

/**
 * Encodes a 4-byte big-endian unsigned integer length prefix followed
 * by the bytes. Server §8.10, "Variable-length (strings, blobs)".
 *
 * @param {Uint8Array} bytes - The bytes to prefix.
 * @returns {Uint8Array} The length prefix concatenated with the bytes.
 */
export function lengthPrefixed (bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('bytes must be a Uint8Array')
  }
  const buf = Buffer.alloc(4 + bytes.length)
  buf.writeUInt32BE(bytes.length, 0)
  buf.set(bytes, 4)
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

/**
 * Encodes a 64-bit big-endian unsigned integer from a JS number.
 * Numbers larger than 2^53 - 1 must be passed as BigInt.
 *
 * @param {number | bigint} value - The non-negative integer.
 * @returns {Uint8Array} The 8-byte big-endian representation.
 */
export function u64BE (value) {
  let bigVal
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw new Error('value as number must be a non-negative integer at most Number.MAX_SAFE_INTEGER')
    }
    bigVal = BigInt(value)
  } else if (typeof value === 'bigint') {
    if (value < 0n || value > 0xFFFFFFFFFFFFFFFFn) {
      throw new Error('value as bigint must be a non-negative 64-bit integer')
    }
    bigVal = value
  } else {
    throw new Error('value must be a number or bigint')
  }
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(bigVal, 0)
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

/**
 * Encodes the canonical byte sequence that a bot message signature
 * covers. Server §8.10, "Context: Bot message".
 *
 * @param {object} params - The parameter object.
 * @param {string} params.roomId - The room the message is posted to.
 * @param {number | bigint} params.epoch - The MLS epoch.
 * @param {string} params.contentType - The content type string (for
 *   bot messages, always "bot").
 * @param {Uint8Array} params.ciphertext - The encrypted payload.
 * @returns {Uint8Array} The bytes to sign.
 */
export function encodeBotMessagePayload ({
  roomId, epoch, contentType, ciphertext
}) {
  if (typeof roomId !== 'string' || roomId.length === 0) {
    throw new Error('roomId must be a non-empty string')
  }
  if (typeof contentType !== 'string' || contentType.length === 0) {
    throw new Error('contentType must be a non-empty string')
  }
  if (!(ciphertext instanceof Uint8Array)) {
    throw new Error('ciphertext must be a Uint8Array')
  }
  const roomIdBytes = lengthPrefixed(Buffer.from(roomId, 'utf8'))
  const epochBytes = u64BE(epoch)
  const contentTypeBytes = lengthPrefixed(Buffer.from(contentType, 'utf8'))
  const ciphertextBytes = lengthPrefixed(ciphertext)

  const combined = Buffer.concat([roomIdBytes, epochBytes, contentTypeBytes, ciphertextBytes])
  return new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength)
}

/**
 * Encodes the canonical byte sequence that a publisher key
 * publication signature covers. Server §8.10, "Context: Publisher key
 * publication".
 *
 * @param {object} params - The parameter object.
 * @param {string} params.roomId - The room the key applies to.
 * @param {number | bigint} params.epoch - The MLS epoch.
 * @param {Uint8Array} params.publisherPublicKey - The 32-byte X25519
 *   publisher public key.
 * @returns {Uint8Array} The bytes to sign.
 */
export function encodePublisherKeyPayload ({
  roomId, epoch, publisherPublicKey
}) {
  if (typeof roomId !== 'string' || roomId.length === 0) {
    throw new Error('roomId must be a non-empty string')
  }
  if (!(publisherPublicKey instanceof Uint8Array) || publisherPublicKey.length !== 32) {
    throw new Error('publisherPublicKey must be a Uint8Array of length 32')
  }
  const roomIdBytes = lengthPrefixed(Buffer.from(roomId, 'utf8'))
  const epochBytes = u64BE(epoch)

  const combined = Buffer.concat([roomIdBytes, epochBytes, publisherPublicKey])
  return new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength)
}
