import { decrypt } from './command-result.js'

/**
 * The HKDF info string used for settings encryption.
 */
export const SETTINGS_INFO = 'bot-settings-v1'

/**
 * Regex for valid base64url strings (padded or unpadded).
 */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+=*$/

/**
 * Parses a settings wire blob into its components.
 *
 * @param {Uint8Array} wire - The decoded wire bytes.
 * @returns {{ ephemeralPublicKey: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array }} The three components.
 * @throws {Error} When the wire is shorter than 60 bytes or not a Uint8Array.
 */
export function parseSettingsWire (wire) {
  if (!(wire instanceof Uint8Array)) {
    throw new Error('wire must be a Uint8Array')
  }
  if (wire.length < 60) {
    throw new Error('wire length must be at least 60 bytes (32-byte ephemeral public key + 12-byte nonce + 16-byte tag)')
  }

  const ephemeralPublicKey = wire.subarray(0, 32)
  const nonce = wire.subarray(32, 44)
  const ciphertext = wire.subarray(44)

  return {
    ephemeralPublicKey,
    nonce,
    ciphertext
  }
}

/**
 * Decrypts a settings value ciphertext.
 *
 * @param {object} params - The parameters object.
 * @param {string} params.encryptedBase64url - The wire bytes as base64url (padded or unpadded).
 * @param {Uint8Array} params.botCommandPrivateKey - The bot's 32-byte X25519 private scalar from the keystore (`bot_command_private`).
 * @returns {Uint8Array} The decrypted plaintext bytes.
 * @throws {Error} When input parameters are invalid or decryption fails.
 */
export function decryptSettingsValue ({ encryptedBase64url, botCommandPrivateKey }) {
  if (typeof encryptedBase64url !== 'string' || encryptedBase64url.length === 0) {
    throw new Error('encryptedBase64url must be a non-empty string')
  }
  if (!BASE64URL_PATTERN.test(encryptedBase64url)) {
    throw new Error('encryptedBase64url contains invalid base64url characters')
  }
  if (!(botCommandPrivateKey instanceof Uint8Array) || botCommandPrivateKey.length !== 32) {
    throw new Error('botCommandPrivateKey must be a Uint8Array of length 32')
  }

  const buf = Buffer.from(encryptedBase64url, 'base64url')
  const wire = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)

  const { ephemeralPublicKey } = parseSettingsWire(wire)

  const ciphertextWithNonce = wire.subarray(32)

  return decrypt({
    privateKey: botCommandPrivateKey,
    peerPublicKey: ephemeralPublicKey,
    info: SETTINGS_INFO,
    ciphertext: ciphertextWithNonce
  })
}
