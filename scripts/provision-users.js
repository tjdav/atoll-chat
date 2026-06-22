import sodium from 'libsodium-wrappers-sumo'
import PocketBase from 'pocketbase'
import { generateMasterKeys, generateSalt, deriveKeyFromPin, encryptVault } from '../src/utils/cryptoUtils.js'

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
const SHARED_PIN = '123456'

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

      // Check if user already exists
      try {
        await pb.collection('users').getFirstListItem(pb.filter('username = {:username}', { username: user.username }), {
          requestKey: null
        })
        console.log(`User ${user.username} already exists, skipping.`)
        continue
      } catch (e) {
        // User doesn't exist, proceed
      }

      const masterKeys = await generateMasterKeys(sodium)
      const pinSalt = generateSalt(sodium)
      const KEK = await deriveKeyFromPin(SHARED_PIN, pinSalt, sodium)
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
        pin_salt: sodium.to_base64(pinSalt, sodium.base64_variants.ORIGINAL),
        encrypted_master_keys: encryptedVault
      }

      await pb.collection('users').create(payload, {
        requestKey: null
      })
      console.log(`User ${user.username} created successfully.`)
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
