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
 * Derives Auth and Vault Keys using Argon2id.
 * Uses compile-time environment evaluation for production tree-shaking.
 */
export async function deriveAuthAndVaultKeys (rawUsername, masterPassword, options = {}) {
  await sodium.ready
  const canonicalUsername = normalizeUsername(rawUsername)

  // Compute Master Salt
  const masterSaltInput = `atoll-master-salt:${canonicalUsername}`

  let masterSaltHash = null
  let saltMaster = null
  let masterSeed = null
  let keyA = null
  let keyBBytes = null

  try {
    masterSaltHash = sodium.crypto_hash_sha256(masterSaltInput)
    saltMaster = masterSaltHash.slice(0, 16)

    const isTest = import.meta.env.MODE === 'testing'
    const opslimit = options.opslimit ?? (isTest ? 1 : 3)
    const memlimit = options.memlimit ?? (isTest ? 8388608 : 134217728)

    // Single-Pass Derivation (64 bytes)
    masterSeed = sodium.crypto_pwhash(
      64,
      masterPassword,
      saltMaster,
      opslimit,
      memlimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13
    )

    // Split 64-byte seed into Key_A (Vault) and Key_B (Auth)
    keyA = masterSeed.slice(0, 32)
    keyBBytes = masterSeed.slice(32, 64)
    const keyB = sodium.to_hex(keyBBytes)

    // Cache Key A in RAM
    ephemeralVaultKey = keyA

    return {
      keyA,
      keyB,
      canonicalUsername
    }
  } finally {
    // Explicitly zero out intermediate/transient buffers before returning
    if (masterSaltHash && typeof masterSaltHash.fill === 'function') {
      masterSaltHash.fill(0)
    }
    if (saltMaster && typeof saltMaster.fill === 'function') {
      saltMaster.fill(0)
    }
    if (masterSeed && typeof masterSeed.fill === 'function') {
      masterSeed.fill(0)
    }
    if (keyBBytes && typeof keyBBytes.fill === 'function') {
      keyBBytes.fill(0)
    }
  }
}
