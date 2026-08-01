import sodium from 'libsodium-wrappers-sumo'

/**
 *
 */
export function normalizeUsername (username) {
  if (!username) {
    return ''
  }
  return username.trim().toLowerCase()
}

// In-memory cache for Key A (ephemeral RAM)
let ephemeralVaultKey = null

/**
 *
 */
export function purgeVaultKey () {
  ephemeralVaultKey = null
}

/**
 *
 */
export function getVaultKey () {
  return ephemeralVaultKey
}

/**
 *
 */
export function setVaultKey (key) {
  ephemeralVaultKey = key
}

/**
 *
 */
export async function deriveAuthAndVaultKeys (rawUsername, masterPassword) {
  await sodium.ready
  const canonicalUsername = normalizeUsername(rawUsername)

  // Compute SHA-256 salts and slice to 16 bytes for Argon2id
  const authSaltInput = `atoll-auth-salt:${canonicalUsername}`
  const vaultSaltInput = `atoll-vault-salt:${canonicalUsername}`

  const authSaltHash = sodium.crypto_hash_sha256(authSaltInput)
  const vaultSaltHash = sodium.crypto_hash_sha256(vaultSaltInput)

  const saltAuth = authSaltHash.slice(0, 16)
  const saltVault = vaultSaltHash.slice(0, 16)

  /* Derive Key B (Auth Credential) - 32-byte Argon2id output -> 64-char Hex string */
  const keyBBytes = sodium.crypto_pwhash(
    32,
    masterPassword,
    saltAuth,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  )
  const keyB = sodium.to_hex(keyBBytes)

  /* Derive Key A (Vault Key) - 32-byte Argon2id output (binary Uint8Array) */
  const keyA = sodium.crypto_pwhash(
    32,
    masterPassword,
    saltVault,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  )

  // Cache Key A in RAM
  ephemeralVaultKey = keyA

  return {
    keyA,
    keyB,
    canonicalUsername
  }
}
