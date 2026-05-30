/**
 * Generates a 16-byte cryptographically secure salt using libsodium.
 *
 * @param {Object} sodium - The initialized libsodium-wrappers instance.
 * @returns {Uint8Array} A 16-byte salt.
 */
export function generateSalt (sodium) {
  return sodium.randombytes_buf(16)
}

/**
 * Derives a 32-byte Key Encryption Key (KEK) from a PIN and salt using Argon2id.
 *
 * @param {string} pin - The user's PIN.
 * @param {Uint8Array} saltUint8Array - The 16-byte salt.
 * @param {Object} sodium - The initialized libsodium-wrappers instance.
 * @returns {Promise<Uint8Array>} A promise that resolves to the 32-byte derived KEK.
 */
export async function deriveKeyFromPin (pin, saltUint8Array, sodium) {
  return sodium.crypto_pwhash(
    32,
    pin,
    saltUint8Array,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  )
}

/**
 * Derives a 32-byte Key Encryption Key (KEK) from a passkey using the WebAuthn PRF extension.
 *
 * @param {Uint8Array} credentialId - The ID of the credential to use.
 * @param {Uint8Array} challengeBuffer - A random challenge buffer (usually 32 bytes).
 * @param {Uint8Array} saltBuffer - A 32-byte salt buffer for the PRF extension.
 * @returns {Promise<Uint8Array>} A promise that resolves to the 32-byte derived KEK.
 * @throws {Error} If the WebAuthn PRF extension is not supported or fails.
 */
export async function deriveKeyFromPasskey (credentialId, challengeBuffer, saltBuffer) {
  if (!window.PublicKeyCredential) {
    throw new Error('WebAuthn PRF extension is not supported on this device or browser.')
  }

  /** @type {any} */
  const challenge = challengeBuffer
  /** @type {any} */
  const id = credentialId
  /** @type {any} */
  const first = saltBuffer

  /** @type {any} */
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{
        type: 'public-key',
        id
      }],
      userVerification: 'required',
      extensions: {
        prf: {
          eval: {
            first
          }
        }
      }
    }
  })

  const extensionResults = assertion.getClientExtensionResults()
  if (!extensionResults.prf || !extensionResults.prf.results || !extensionResults.prf.results.first) {
    throw new Error('WebAuthn PRF extension is not supported on this device or browser.')
  }
  const prfResults = extensionResults.prf.results.first
  /** @type {ArrayBuffer} */
  const resultsBuffer = prfResults

  return new Uint8Array(resultsBuffer)
}

/**
 * Generates an X25519 keypair for encryption.
 *
 * @param {Object} sodium - The initialized libsodium-wrappers instance.
 * @returns {Object} An object containing { publicKey, privateKey } as base64 strings.
 */
export function generateEncryptionKeys (sodium) {
  if (!sodium || typeof sodium.crypto_box_keypair !== 'function') {
    throw new Error('Libsodium instance is missing or not fully initialized.')
  }

  const { publicKey, privateKey } = sodium.crypto_box_keypair()

  return {
    publicKey: sodium.to_base64(publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.to_base64(privateKey, sodium.base64_variants.ORIGINAL)
  }
}

/**
 * Generates an Ed25519 keypair for signing/identity.
 *
 * @param {Object} sodium - The initialized libsodium-wrappers instance.
 * @returns {Object} An object containing { publicKey, privateKey } as base64 strings.
 */
export function generateIdentityKeys (sodium) {
  if (!sodium || typeof sodium.crypto_sign_keypair !== 'function') {
    throw new Error('Libsodium instance is missing or not fully initialized.')
  }

  const { publicKey, privateKey } = sodium.crypto_sign_keypair()

  return {
    publicKey: sodium.to_base64(publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.to_base64(privateKey, sodium.base64_variants.ORIGINAL)
  }
}

/**
 * Unified helper to generate both encryption and identity keypairs.
 * Maps keys to the specific snake_case names required for the Atoll Vault/Database.
 *
 * @param {Object} sodium - The initialized libsodium-wrappers instance.
 * @returns {Promise<Object>} A promise resolving to an object with snake_case keys.
 */
export async function generateMasterKeys (sodium) {
  const encryptionKeys = generateEncryptionKeys(sodium)
  const identityKeys = generateIdentityKeys(sodium)

  return {
    public_box_key: encryptionKeys.publicKey,
    private_box_key: encryptionKeys.privateKey,
    public_sign_key: identityKeys.publicKey,
    private_sign_key: identityKeys.privateKey
  }
}

/**
 * Encrypts the private keys using the derived KEK.
 *
 * @param {Object} privateKeys - Object containing { private_box_key, private_sign_key } as base64 strings.
 * @param {Uint8Array} KEK - The 32-byte derived Key Encryption Key.
 * @param {Object} sodium - The initialized libsodium-wrappers instance.
 * @returns {Object} An object containing { ciphertext, nonce } as base64 strings.
 */
export function encryptVault (privateKeys, KEK, sodium) {
  const vaultPlaintext = JSON.stringify({
    private_box_key: privateKeys.private_box_key,
    private_sign_key: privateKeys.private_sign_key
  })

  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(vaultPlaintext, nonce, KEK)

  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
  }
}

/**
 * Decrypts the private keys from the vault using the derived KEK.
 *
 * @param {string} ciphertextBase64 - The base64-encoded ciphertext.
 * @param {string} nonceBase64 - The base64-encoded nonce.
 * @param {Uint8Array} KEK - The 32-byte derived Key Encryption Key.
 * @param {Object} sodium - The initialized libsodium-wrappers instance.
 * @returns {Object} The decrypted private keys: { private_box_key, private_sign_key }.
 * @throws {Error} If decryption fails.
 */
export function decryptVault (ciphertextBase64, nonceBase64, KEK, sodium) {
  const ciphertext = sodium.from_base64(ciphertextBase64, sodium.base64_variants.ORIGINAL)
  const nonce = sodium.from_base64(nonceBase64, sodium.base64_variants.ORIGINAL)

  const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, nonce, KEK)

  if (!decrypted) {
    throw new Error('Failed to decrypt vault. Invalid PIN or corrupt data.')
  }

  const vaultPlaintext = sodium.to_string(decrypted)
  return JSON.parse(vaultPlaintext)
}
