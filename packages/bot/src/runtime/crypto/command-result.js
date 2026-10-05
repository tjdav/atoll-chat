import crypto from 'node:crypto'

/**
 * PKCS#8 DER prefix for X25519 private keys.
 */
const PKCS8_X25519_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')

/**
 * SPKI DER prefix for X25519 public keys.
 */
const SPKI_X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')

/**
 * Creates a Node.js KeyObject for an X25519 private key scalar.
 *
 * @param {Uint8Array} privateKey - The 32-byte X25519 private scalar.
 * @returns {import('node:crypto').KeyObject} The private key.
 */
export function keyObjectFromX25519Private (privateKey) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error('privateKey must be a Uint8Array of length 32')
  }
  const der = Buffer.concat([PKCS8_X25519_PREFIX, privateKey])
  return crypto.createPrivateKey({
    key: der,
    format: 'der',
    type: 'pkcs8'
  })
}

/**
 * Creates a Node.js KeyObject for an X25519 public key u-coordinate.
 *
 * @param {Uint8Array} publicKey - The 32-byte X25519 public key.
 * @returns {import('node:crypto').KeyObject} The public key.
 */
export function keyObjectFromX25519Public (publicKey) {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
    throw new Error('publicKey must be a Uint8Array of length 32')
  }
  const der = Buffer.concat([SPKI_X25519_PREFIX, publicKey])
  return crypto.createPublicKey({
    key: der,
    format: 'der',
    type: 'spki'
  })
}

/**
 * Generates a fresh X25519 keypair for a single command result.
 *
 * The private key is 32 bytes. The public key is 32 bytes. Both are
 * raw scalars/u-coordinates, not DER-wrapped. The caller discards the
 * private key after encryption.
 *
 * @returns {{ publicKey: Uint8Array, privateKey: Uint8Array }} The ephemeral keypair.
 */
export function generateEphemeralKeypair () {
  const privateKeyBytes = new Uint8Array(crypto.randomBytes(32))
  const privKo = keyObjectFromX25519Private(privateKeyBytes)
  const pubKo = crypto.createPublicKey(privKo)
  const spkiDer = pubKo.export({
    format: 'der',
    type: 'spki'
  })
  const publicKeyBytes = new Uint8Array(spkiDer.subarray(12))

  return {
    publicKey: publicKeyBytes,
    privateKey: privateKeyBytes
  }
}

/**
 * Derives the raw X25519 shared secret between a private key and a
 * peer's public key.
 *
 * The computation is symmetric: `ECDH(a_priv, b_pub)` equals
 * `ECDH(b_priv, a_pub)`. Node's diffieHellman returns the 32-byte
 * u-coordinate.
 *
 * @param {Uint8Array} privateKey - The 32-byte X25519 private scalar.
 * @param {Uint8Array} peerPublicKey - The peer's 32-byte X25519 public key.
 * @returns {Uint8Array} The 32-byte shared secret.
 */
export function deriveSharedSecret (privateKey, peerPublicKey) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error('privateKey must be a Uint8Array of length 32')
  }
  if (!(peerPublicKey instanceof Uint8Array) || peerPublicKey.length !== 32) {
    throw new Error('peerPublicKey must be a Uint8Array of length 32')
  }

  const privKo = keyObjectFromX25519Private(privateKey)
  const pubKo = keyObjectFromX25519Public(peerPublicKey)

  let sharedBuffer
  try {
    sharedBuffer = crypto.diffieHellman({
      privateKey: privKo,
      publicKey: pubKo
    })
  } catch (err) {
    throw new Error('X25519 shared secret is all zeros; peer public key is a low-order point', { cause: err })
  }

  const shared = new Uint8Array(sharedBuffer.buffer, sharedBuffer.byteOffset, sharedBuffer.byteLength)

  let allZero = true
  for (let i = 0; i < shared.length; i++) {
    if (shared[i] !== 0) {
      allZero = false
      break
    }
  }

  if (allZero) {
    throw new Error('X25519 shared secret is all zeros; peer public key is a low-order point')
  }

  return new Uint8Array(shared)
}

/**
 * Performs HKDF-Expand (RFC 5869 §2.3) for 32-byte output length.
 *
 * @param {Uint8Array} prk - The 32-byte pseudo-random key / shared secret.
 * @param {string | Uint8Array} info - The info string or bytes.
 * @returns {Uint8Array} The derived 32-byte key.
 */
function hkdfExpand32 (prk, info) {
  const infoBytes = typeof info === 'string'
    ? Buffer.from(info, 'utf8')
    : Buffer.from(info)
  const t1 = crypto
    .createHmac('sha256', prk)
    .update(Buffer.concat([infoBytes, Buffer.from([0x01])]))
    .digest()
  return new Uint8Array(t1.buffer, t1.byteOffset, t1.byteLength)
}

/**
 * Encrypts a plaintext to a peer's X25519 public key with a generic
 * info string.
 *
 * Uses X25519 ECDH -> HKDF-Expand(SHA-256, info, 32) -> AES-256-GCM with
 * no associated data. Wire format is `nonce(12) || ciphertext || tag(16)`.
 *
 * The caller supplies the ephemeral private key and its matching public
 * key. The public key is not returned; the caller already has it.
 *
 * @param {object} params - The parameter object.
 * @param {Uint8Array} params.privateKey - The sender's 32-byte X25519 private key.
 * @param {Uint8Array} params.peerPublicKey - The recipient's 32-byte X25519 public key.
 * @param {string} params.info - The HKDF info string.
 * @param {Uint8Array} params.plaintext - The bytes to encrypt.
 * @returns {Uint8Array} The wire bytes: `nonce || ciphertext || tag`.
 */
export function encrypt ({ privateKey, peerPublicKey, info, plaintext }) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error('privateKey must be a Uint8Array of length 32')
  }
  if (!(peerPublicKey instanceof Uint8Array) || peerPublicKey.length !== 32) {
    throw new Error('peerPublicKey must be a Uint8Array of length 32')
  }
  if (typeof info !== 'string' || info.length === 0) {
    throw new Error('info must be a non-empty string')
  }
  if (!(plaintext instanceof Uint8Array)) {
    throw new Error('plaintext must be a Uint8Array')
  }

  const shared = deriveSharedSecret(privateKey, peerPublicKey)
  const key = hkdfExpand32(shared, info)
  const nonce = crypto.randomBytes(12)

  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const ciphertextPart = cipher.update(plaintext)
  const finalPart = cipher.final()
  const tag = cipher.getAuthTag()

  const wire = Buffer.concat([nonce, ciphertextPart, finalPart, tag])
  return new Uint8Array(wire.buffer, wire.byteOffset, wire.byteLength)
}

/**
 * Decrypts a wire blob produced by `encrypt`.
 *
 * @param {object} params - The parameter object.
 * @param {Uint8Array} params.privateKey - The recipient's 32-byte X25519 private key.
 * @param {Uint8Array} params.peerPublicKey - The sender's 32-byte X25519 public key.
 * @param {string} params.info - The HKDF info string, matching the one used at encryption time.
 * @param {Uint8Array} params.ciphertext - The wire bytes.
 * @returns {Uint8Array} The recovered plaintext.
 * @throws {Error} When the tag does not verify, when the peer public key is a low-order point, or when the wire length is too short.
 */
export function decrypt ({ privateKey, peerPublicKey, info, ciphertext }) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error('privateKey must be a Uint8Array of length 32')
  }
  if (!(peerPublicKey instanceof Uint8Array) || peerPublicKey.length !== 32) {
    throw new Error('peerPublicKey must be a Uint8Array of length 32')
  }
  if (typeof info !== 'string' || info.length === 0) {
    throw new Error('info must be a non-empty string')
  }
  if (!(ciphertext instanceof Uint8Array)) {
    throw new Error('ciphertext must be a Uint8Array')
  }
  if (ciphertext.length < 28) {
    throw new Error('ciphertext wire length must be at least 28 bytes (12-byte nonce + 16-byte tag)')
  }

  const nonce = ciphertext.subarray(0, 12)
  const body = ciphertext.subarray(12, ciphertext.length - 16)
  const tag = ciphertext.subarray(ciphertext.length - 16)

  const shared = deriveSharedSecret(privateKey, peerPublicKey)
  const key = hkdfExpand32(shared, info)

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)

  const plaintextPart = decipher.update(body)
  const finalPart = decipher.final()

  const plaintext = Buffer.concat([plaintextPart, finalPart])
  return new Uint8Array(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)
}

/**
 * Encrypts a command result to the invoking client's ephemeral X25519
 * public key. Uses the info string `"bot-command-result-v1"`.
 *
 * Generates a fresh ephemeral keypair internally. The returned public
 * key is the bot's ephemeral X25519 public key, which the caller sends
 * to the server alongside the ciphertext so the client can derive the
 * same shared secret.
 *
 * @param {object} params - The parameter object.
 * @param {Uint8Array} params.peerPublicKey - The client's 32-byte ephemeral X25519 public key from the `bot.command_invoked` event.
 * @param {Uint8Array} params.plaintext - The JSON bytes of the result.
 * @returns {{ publicKey: Uint8Array, ciphertext: Uint8Array }} The bot's ephemeral public key and the wire bytes.
 */
export function encryptCommandResult ({ peerPublicKey, plaintext }) {
  if (!(peerPublicKey instanceof Uint8Array) || peerPublicKey.length !== 32) {
    throw new Error('peerPublicKey must be a Uint8Array of length 32')
  }
  if (!(plaintext instanceof Uint8Array)) {
    throw new Error('plaintext must be a Uint8Array')
  }

  const ephemeral = generateEphemeralKeypair()
  const ciphertext = encrypt({
    privateKey: ephemeral.privateKey,
    peerPublicKey,
    info: 'bot-command-result-v1',
    plaintext
  })

  return {
    publicKey: ephemeral.publicKey,
    ciphertext
  }
}

/**
 * Decrypts a command result. Symmetric counterpart of
 * `encryptCommandResult`. Used by the client, and by the bot's test
 * suite to verify the encryption.
 *
 * @param {object} params - The parameter object.
 * @param {Uint8Array} params.privateKey - The client's 32-byte ephemeral private key.
 * @param {Uint8Array} params.peerPublicKey - The bot's 32-byte ephemeral public key from the result.
 * @param {Uint8Array} params.ciphertext - The wire bytes.
 * @returns {Uint8Array} The recovered plaintext.
 */
export function decryptCommandResult ({ privateKey, peerPublicKey, ciphertext }) {
  return decrypt({
    privateKey,
    peerPublicKey,
    info: 'bot-command-result-v1',
    ciphertext
  })
}
