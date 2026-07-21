import sodium from 'libsodium-wrappers-sumo'
import PocketBase from 'pocketbase'

/**
 * Generates a 16-byte cryptographically secure salt using libsodium.
 */
function generateSalt (sodium) {
  return sodium.randombytes_buf(16)
}

/**
 * Derives a 32-byte Key Encryption Key (KEK) from a password and salt using Argon2id.
 */
async function deriveKeyFromPassword (password, saltUint8Array, sodium) {
  return sodium.crypto_pwhash(
    32,
    password,
    saltUint8Array,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  )
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
 * Encrypts the private keys using the derived KEK.
 */
function encryptVault (privateKeys, KEK, sodium) {
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

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || 'admin@example.com'
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || 'password123'

const USERS = [
  {
    username: 'alice',
    email: 'alice@example.com'
  },
  {
    username: 'bob',
    email: 'bob@example.com'
  },
  {
    username: 'charlie',
    email: 'charlie@example.com'
  }
]

const SHARED_PASSWORD = 'Password123!'
const SHARED_VAULT_PASSWORD = 'VaultPassword123!'

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

      // Generate keys and payload
      const masterKeys = await generateMasterKeys(sodium)
      const salt = generateSalt(sodium)
      const KEK = await deriveKeyFromPassword(SHARED_VAULT_PASSWORD, salt, sodium)
      const encryptedVault = encryptVault(masterKeys, KEK, sodium)

      const payload = {
        username: user.username,
        name: user.username.charAt(0).toUpperCase() + user.username.slice(1),
        email: user.email,
        password: SHARED_PASSWORD,
        passwordConfirm: SHARED_PASSWORD,
        emailVisibility: true,
        public_box_key: masterKeys.public_box_key,
        public_sign_key: masterKeys.public_sign_key,
        vault_salt: sodium.to_base64(salt, sodium.base64_variants.ORIGINAL),
        encrypted_master_keys: encryptedVault
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

      if (existingRecord) {
        console.log(`User ${user.username} already exists. Updating password, keys, and master vault...`)
        await pb.collection('users').update(existingRecord.id, payload, {
          requestKey: null
        })
        console.log(`User ${user.username} updated successfully.`)
      } else {
        await pb.collection('users').create(payload, {
          requestKey: null
        })
        console.log(`User ${user.username} created successfully.`)
      }
    } catch (error) {
      console.error(`Failed to create user ${user.username}:`, error.data || error.message)
    }
  }

  console.log('--- Provisioning Complete ---')
}

provision().catch((err) => {
  console.error('Provisioning failed:', err)
  process.exit(1)
})
