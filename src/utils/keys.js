import sodium from 'libsodium-wrappers-sumo'

/**
 *
 */
export function normalizeUsername (username) {
  if (!username) {
    return ''
  }

  return username.normalize('NFC').trim().toLowerCase()
}

// In-memory cache for Key A (ephemeral RAM)
let ephemeralVaultKey = null

/**
 *
 */
export function purgeVaultKey () {
  if (ephemeralVaultKey) {
    if (typeof ephemeralVaultKey.fill === 'function') {
      ephemeralVaultKey.fill(0)
    }
    ephemeralVaultKey = null
  }
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

  let authSaltHash = null
  let vaultSaltHash = null
  let saltAuth = null
  let saltVault = null
  let keyBBytes = null
  let keyA = null

  try {
    authSaltHash = sodium.crypto_hash_sha256(authSaltInput)
    vaultSaltHash = sodium.crypto_hash_sha256(vaultSaltInput)

    saltAuth = authSaltHash.slice(0, 16)
    saltVault = vaultSaltHash.slice(0, 16)

    /* Derive Key B (Auth Credential) - 32-byte Argon2id output -> 64-char Hex string */
    keyBBytes = sodium.crypto_pwhash(
      32,
      masterPassword,
      saltAuth,
      sodium.crypto_pwhash_OPSLIMIT_SENSITIVE,
      sodium.crypto_pwhash_MEMLIMIT_SENSITIVE,
      sodium.crypto_pwhash_ALG_ARGON2ID13
    )
    const keyB = sodium.to_hex(keyBBytes)

    /* Derive Key A (Vault Key) - 32-byte Argon2id output (binary Uint8Array) */
    keyA = sodium.crypto_pwhash(
      32,
      masterPassword,
      saltVault,
      sodium.crypto_pwhash_OPSLIMIT_SENSITIVE,
      sodium.crypto_pwhash_MEMLIMIT_SENSITIVE,
      sodium.crypto_pwhash_ALG_ARGON2ID13
    )

    // Cache Key A in RAM
    ephemeralVaultKey = keyA

    return {
      keyA,
      keyB,
      canonicalUsername
    }
  } finally {
    // Explicitly zero out intermediate/transient buffers before returning
    if (authSaltHash && typeof authSaltHash.fill === 'function') {
      authSaltHash.fill(0)
    }
    if (vaultSaltHash && typeof vaultSaltHash.fill === 'function') {
      vaultSaltHash.fill(0)
    }
    if (saltAuth && typeof saltAuth.fill === 'function') {
      saltAuth.fill(0)
    }
    if (saltVault && typeof saltVault.fill === 'function') {
      saltVault.fill(0)
    }
    if (keyBBytes && typeof keyBBytes.fill === 'function') {
      keyBBytes.fill(0)
    }
    // We do NOT zero out keyA here because it is returned and cached in ephemeralVaultKey
  }
}
