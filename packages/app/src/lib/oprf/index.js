import { ristretto255_oprf } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha512 } from '@noble/hashes/sha512.js';

/**
 * @typedef {Object} OprfState
 * @property {Uint8Array} blind Private blinding scalar produced by client blind step
 * @property {Uint8Array} usernameBytes UTF-8 encoded username bytes
 */

/**
 * @typedef {Object} BlindResult
 * @property {Uint8Array} blindedBytes 32-byte compressed Ristretto255 point for transmission
 * @property {OprfState} state State object required for unblinding in finalize
 */

/**
 * Blinds a username string for OPRF evaluation per RFC 9497 and client spec §6.19.
 * Uses Web Crypto / CSPRNG uniform scalar sampling inside @noble/curves.
 *
 * @param {string} username Plaintext handle (e.g. "alice")
 * @returns {Promise<BlindResult>} 32-byte blinded point and state handle
 */
export async function blind(username) {
  if (typeof username !== 'string') {
    throw new TypeError('username must be a string');
  }
  const usernameBytes = new TextEncoder().encode(username);
  const { blind: blindScalar, blinded } = ristretto255_oprf.oprf.blind(usernameBytes);
  return {
    blindedBytes: blinded,
    state: {
      blind: blindScalar,
      usernameBytes,
    },
  };
}

/**
 * Finalizes the OPRF flow by unblinding the server evaluated point and computing
 * the 64-byte SHA-512 username token digest per RFC 9497 §2.2 and client spec §6.19.
 *
 * @param {string|Uint8Array} username Plaintext handle or UTF-8 encoded username bytes
 * @param {Uint8Array} evaluatedBytes 32-byte compressed Ristretto255 evaluated point from server
 * @param {OprfState} [state] State object containing private blind scalar returned from blind()
 * @returns {Promise<Uint8Array>} 64-byte finalized username token digest
 */
export async function finalize(username, evaluatedBytes, state) {
  let usernameBytes;
  if (typeof username === 'string') {
    usernameBytes = new TextEncoder().encode(username);
  } else if (username instanceof Uint8Array) {
    usernameBytes = username;
  } else {
    throw new TypeError('username must be a string or Uint8Array');
  }

  if (!(evaluatedBytes instanceof Uint8Array) || evaluatedBytes.length !== 32) {
    throw new TypeError('evaluatedBytes must be a 32-byte Uint8Array');
  }

  const blindScalar = state?.blind;
  if (!(blindScalar instanceof Uint8Array)) {
    throw new TypeError('state.blind must be provided as a Uint8Array');
  }

  const token = ristretto255_oprf.oprf.finalize(usernameBytes, blindScalar, evaluatedBytes);
  return token;
}

/**
 * Derives the 32-byte display name encryption key from the username token
 * using HKDF-Expand(token, info="display-name-encryption-v1", length=32) per client spec §6.20 and §8.3.
 *
 * @param {Uint8Array} token 64-byte username token digest from finalize()
 * @returns {Promise<Uint8Array>} 32-byte AES key
 */
export async function deriveDisplayNameKey(token) {
  if (!(token instanceof Uint8Array) || token.length !== 64) {
    throw new TypeError('token must be a 64-byte Uint8Array');
  }
  const info = new TextEncoder().encode('display-name-encryption-v1');
  return hkdf(sha512, token, undefined, info, 32);
}

/**
 * Derives the 32-byte device name encryption key from the username token
 * using HKDF-Expand(token, info="device-name-encryption-v1", length=32) per client spec §6.21 and §8.3.
 *
 * @param {Uint8Array} token 64-byte username token digest from finalize()
 * @returns {Promise<Uint8Array>} 32-byte AES key
 */
export async function deriveDeviceNameKey(token) {
  if (!(token instanceof Uint8Array) || token.length !== 64) {
    throw new TypeError('token must be a 64-byte Uint8Array');
  }
  const info = new TextEncoder().encode('device-name-encryption-v1');
  return hkdf(sha512, token, undefined, info, 32);
}
