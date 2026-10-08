import crypto from 'node:crypto'
import { generateEphemeralKeypair } from '../runtime/crypto/command-result.js'

/**
 * PKCS#8 DER prefix for Ed25519 private keys.
 */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

/**
 * SPKI DER prefix for Ed25519 public keys.
 */
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * Generates a fresh Ed25519 keypair for message signing or MLS identity.
 *
 * @returns {{ publicKey: Uint8Array, privateKey: Uint8Array }} The
 *   32-byte public key and the 32-byte private seed.
 */
export function generateEd25519Keypair () {
  const { publicKey: pubKo, privateKey: privKo } = crypto.generateKeyPairSync('ed25519')

  const pkcs8Der = privKo.export({
    format: 'der',
    type: 'pkcs8'
  })
  const privateKeyBytes = new Uint8Array(pkcs8Der.subarray(PKCS8_ED25519_PREFIX.length))

  const spkiDer = pubKo.export({
    format: 'der',
    type: 'spki'
  })
  const publicKeyBytes = new Uint8Array(spkiDer.subarray(SPKI_ED25519_PREFIX.length))

  return {
    publicKey: publicKeyBytes,
    privateKey: privateKeyBytes
  }
}

/**
 * Generates a fresh X25519 keypair for command encryption.
 *
 * @returns {{ publicKey: Uint8Array, privateKey: Uint8Array }} The
 *   32-byte public key u-coordinate and the 32-byte private scalar.
 */
export function generateX25519Keypair () {
  return generateEphemeralKeypair()
}

/**
 * Generates a fresh 32-byte storage seed.
 *
 * @returns {Uint8Array} A random 32-byte value.
 */
export function generateStorageSeed () {
  return new Uint8Array(crypto.randomBytes(32))
}

/**
 * Generates every key material the keystore requires at registration
 * time.
 *
 * Returns the public keys (for POST /bots) and the private keys (for
 * the keystore plaintext). The two Ed25519 keypairs are distinct: one
 * is the message signing key (`bot_identity`), one is the MLS identity
 * key (`identity`). They serve different purposes and must not be the
 * same key.
 *
 * @returns {{ publicKeys: { botIdentity: Uint8Array, botCommand: Uint8Array, identity: Uint8Array }, privateKeys: { botIdentity: Uint8Array, botCommand: Uint8Array, identity: Uint8Array }, storageSeed: Uint8Array }} The generated material.
 */
export function generateBotKeyMaterial () {
  const botIdentity = generateEd25519Keypair()
  const identity = generateEd25519Keypair()
  const botCommand = generateX25519Keypair()
  const storageSeed = generateStorageSeed()

  return {
    publicKeys: {
      botIdentity: botIdentity.publicKey,
      botCommand: botCommand.publicKey,
      identity: identity.publicKey
    },
    privateKeys: {
      botIdentity: botIdentity.privateKey,
      botCommand: botCommand.privateKey,
      identity: identity.privateKey
    },
    storageSeed
  }
}
