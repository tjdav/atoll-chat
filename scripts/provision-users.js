import sodium from 'libsodium-wrappers-sumo'
import PocketBase from 'pocketbase'
import { deriveAuthAndVaultKeys } from '../src/utils/keys.js'

/**
 * Generates a 16-byte cryptographically secure salt using libsodium.
 */
function generateSalt (sodium) {
  return sodium.randombytes_buf(16)
}

/**
 * Unified helper to generate both encryption and identity keypairs.
 */
async function generateMasterKeys (sodium) {
  const { publicKey: pubBox, privateKey: privBox } = sodium.crypto_box_keypair()
  const { publicKey: pubSign, privateKey: privSign } = sodium.crypto_sign_keypair()

  return {
    public_box_key: sodium.to_base64(pubBox, sodium.base64_variants.ORIGINAL),
    private_box_key: sodium.to_base64(privBox, sodium.base64_variants.ORIGINAL),
    public_sign_key: sodium.to_base64(pubSign, sodium.base64_variants.ORIGINAL),
    private_sign_key: sodium.to_base64(privSign, sodium.base64_variants.ORIGINAL)
  }
}

/**
 * Encrypts private keys using the random Master Key.
 */
function encryptPrivateKeys (privateKeys, masterKeyBytes, sodium) {
  const plaintext = JSON.stringify({
    private_box_key: privateKeys.private_box_key,
    private_sign_key: privateKeys.private_sign_key
  })
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, masterKeyBytes)
  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
  }
}

/**
 * Encrypts the Master Key using Key A (derived via Argon2id).
 */
function encryptMasterKeyWithKek (masterKeyBytes, keyABytes, sodium) {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(masterKeyBytes, nonce, keyABytes)
  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
  }
}

/**
 * Helper to generate a single formatted emergency recovery code (RC-XXXX-XXXX-XXXX-XXXX).
 */
function generateSingleRecoveryCode (sodium) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const part = () => {
    const bytes = sodium.randombytes_buf(4)
    let str = ''
    for (let i = 0; i < 4; i++) {
      str += chars[bytes[i] % chars.length]
    }
    return str
  }
  return `RC-${part()}-${part()}-${part()}-${part()}`
}

/**
 * Generates recovery wraps encrypting the Master Key with a single recovery code.
 */
function generateRecoveryWraps (masterKeyBytes, sodium) {
  const code = generateSingleRecoveryCode(sodium)
  const codeHash = sodium.crypto_generichash(32, code)
  const authProofBytes = sodium.crypto_hash_sha256(sodium.from_string('atoll-recovery-auth:' + code))
  const authProof = sodium.to_base64(authProofBytes, sodium.base64_variants.ORIGINAL)
  const verifierBytes = sodium.crypto_hash_sha256(sodium.from_string('atoll-recovery-verifier:' + authProof))
  const verifier = sodium.to_base64(verifierBytes, sodium.base64_variants.ORIGINAL)

  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(masterKeyBytes, nonce, codeHash)

  const wrap = {
    verifier,
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
  }

  return {
    wraps: [wrap],
    plaintextCodes: [code]
  }
}

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || 'admin@example.com'
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || 'password123'

const USERS = [
  {
    username: 'alice'
  },
  {
    username: 'bob'
  },
  {
    username: 'charlie'
  }
]

const SHARED_PASSWORD = 'Password123!'

async function provision () {
  await sodium.ready
  console.log('--- Provisioning Test Users ---')

  const pb = new PocketBase(PB_URL)

  try {
    console.log(`Authenticating as superuser (${ADMIN_EMAIL})...`)
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
  } catch (error) {
    console.error('Failed to authenticate as superuser. Is PocketBase running?')
    console.error('Error:', error.message)
    process.exit(1)
  }

  for (const user of USERS) {
    try {
      console.log(`Creating user: ${user.username}...`)

      // Compute Key A and Key B using the single-pass derivation
      const { keyA: keyABytes, keyB: userPasswordKeyB } = await deriveAuthAndVaultKeys(user.username, SHARED_PASSWORD)

      // Generate master keys and encrypt VMK with Key A
      const masterKeys = await generateMasterKeys(sodium)
      const salt = generateSalt(sodium)
      const masterKeyBytes = sodium.randombytes_buf(32)
      const passwordWrap = encryptMasterKeyWithKek(masterKeyBytes, keyABytes, sodium)
      const encryptedPrivateKeys = encryptPrivateKeys(masterKeys, masterKeyBytes, sodium)
      const { wraps: recoveryWraps, plaintextCodes } = generateRecoveryWraps(masterKeyBytes, sodium)

      console.log(`Recovery code for ${user.username}:`)
      console.log(plaintextCodes.join('\n'))
      console.log('----------------------------------------')

      const payload = {
        username: user.username,
        name: user.username.charAt(0).toUpperCase() + user.username.slice(1),
        password: userPasswordKeyB,
        passwordConfirm: userPasswordKeyB,
        public_box_key: masterKeys.public_box_key,
        public_sign_key: masterKeys.public_sign_key,
        vault_salt: sodium.to_base64(salt, sodium.base64_variants.ORIGINAL),
        encrypted_master_keys: passwordWrap,
        encrypted_private_keys: encryptedPrivateKeys,
        recovery_wraps: recoveryWraps
      }

      // Check if user already exists
      let existingRecord = null
      try {
        existingRecord = await pb.collection('users').getFirstListItem(pb.filter('username = {:username}', { username: user.username }), {
          requestKey: null
        })
      } catch {
        // User doesn't exist
      }

      let userId
      if (existingRecord) {
        console.log(`Updating existing user ${user.username}...`)
        const updatePayload = {
          username: user.username,
          name: user.username.charAt(0).toUpperCase() + user.username.slice(1),
          password: userPasswordKeyB,
          passwordConfirm: userPasswordKeyB
        }
        // Only assign new keys if the user lacks cryptographic keys
        if (!existingRecord.public_box_key || !existingRecord.encrypted_private_keys) {
          Object.assign(updatePayload, {
            public_box_key: masterKeys.public_box_key,
            public_sign_key: masterKeys.public_sign_key,
            vault_salt: sodium.to_base64(salt, sodium.base64_variants.ORIGINAL),
            encrypted_master_keys: passwordWrap,
            encrypted_private_keys: encryptedPrivateKeys,
            recovery_wraps: recoveryWraps
          })
        } else {
          console.log(`Preserving existing E2EE keys for user ${user.username}.`)
        }
        await pb.collection('users').update(existingRecord.id, updatePayload, {
          requestKey: null
        })
        userId = existingRecord.id
        console.log(`User ${user.username} updated successfully.`)
      } else {
        const createdRecord = await pb.collection('users').create(payload, {
          requestKey: null
        })
        userId = createdRecord.id
        console.log(`User ${user.username} created successfully.`)
      }

      // Provision corresponding user_trust record
      let existingTrust = null
      try {
        existingTrust = await pb.collection('user_trust').getFirstListItem(pb.filter('user = {:userId}', { userId }), {
          requestKey: null
        })
      } catch {
        // Trust doesn't exist
      }

      const isOwner = user.username === 'alice'
      const trustPayload = {
        user: userId,
        tier: isOwner ? 'owner' : 'standard',
        invite_quota: isOwner ? 999999 : 0,
        invites_revoked: false
      }

      if (existingTrust) {
        console.log(`Updating existing user_trust for ${user.username}...`)
        await pb.collection('user_trust').update(existingTrust.id, trustPayload, {
          requestKey: null
        })
      } else {
        console.log(`Creating new user_trust for ${user.username}...`)
        await pb.collection('user_trust').create(trustPayload, {
          requestKey: null
        })
      }
    } catch (error) {
      console.error(`Failed to create/update user ${user.username}:`, error.data || error.message)
    }
  }

  console.log('--- Provisioning Complete ---')
}

provision().catch((err) => {
  console.error('Provisioning failed:', err)
  process.exit(1)
})
