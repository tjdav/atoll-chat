import { test as base, expect } from '@playwright/test'
import PocketBase from 'pocketbase'
import sodium from 'libsodium-wrappers-sumo'
import { generateMasterKeys, generateSalt, deriveKeyFromPassword, encryptVault } from '../../../src/utils/cryptoUtils.js'

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

async function resetPocketBase () {
  console.log('--- Resetting PocketBase (SDK) ---')
  await sodium.ready
  const pb = new PocketBase(PB_URL)

  try {
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
  } catch (error) {
    console.error('Failed to authenticate as superuser during reset. Is PocketBase running?')
    throw error
  }

  // 1. Clear transactional collections
  const collectionsToClear = ['messages', 'rooms', 'room_members', 'media']
  for (const collectionName of collectionsToClear) {
    try {
      const records = await pb.collection(collectionName).getFullList({
        requestKey: null
      })
      for (const record of records) {
        await pb.collection(collectionName).delete(record.id, {
          requestKey: null
        })
      }
    } catch (error) {
      console.warn(`Failed to clear collection ${collectionName}:`, error.message)
    }
  }

  // 2. Restore test users to default state
  for (const user of USERS) {
    try {
      let existingUser
      try {
        existingUser = await pb.collection('users').getFirstListItem(pb.filter('username = {:username}', { username: user.username }), {
          requestKey: null
        })
      } catch (e) {
        // User doesn't exist, we will create it below
      }

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
        encrypted_master_keys: encryptedVault,
        passkey_credential_id: '',
        passkey_prf_salt: '',
        encrypted_master_keys_passkey: null
      }

      if (existingUser) {
        await pb.collection('users').update(existingUser.id, payload, {
          requestKey: null
        })
      } else {
        await pb.collection('users').create(payload, {
          requestKey: null
        })
      }
    } catch (error) {
      console.error(`Failed to restore user ${user.username}:`, error.data || error.message)
    }
  }

  console.log('--- PocketBase Reset Complete ---')
}

export const test = base.extend({
  // Automatic fixture that resets the database before every test
  dbReset: [async ({}, use) => {
    await resetPocketBase()
    await use()
  }, { auto: true }],

  page: async ({ page }, use) => {
    page.on('console', msg => {
      console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`)
    })
    page.on('pageerror', err => {
      console.log(`[BROWSER ERROR] ${err.message}`)
    })
    await use(page)
  },

  loginApp: async ({ page }, use) => {
    const doLogin = async (username, appPassword, vaultPassword) => {
      await page.goto('/')
      await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
      await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

      await page.fill('input[placeholder="Enter username or email"]', username)
      await page.fill('input[placeholder="Enter Password"]', appPassword)
      await page.click('button:has-text("Login")')

      await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

      await page.fill('input[placeholder="Enter Vault Password"]', vaultPassword)
      await page.click('button:has-text("Unlock with Password")')

      await expect(page.locator('app-layout')).toBeVisible({ timeout: 10000 })
    }
    await use(doLogin)
  },

  loginCustomPage: async ({ baseURL }, use) => {
    const doLogin = async (targetPage, username, appPassword, vaultPassword) => {
      targetPage.on('console', msg => {
        console.log(`[BROWSER][${username}] ${msg.type()}: ${msg.text()}`)
      })
      targetPage.on('pageerror', err => {
        console.log(`[BROWSER ERROR][${username}] ${err.message}`)
      })

      // Use the global baseURL if available
      await targetPage.goto(baseURL || '/')

      // Wait for Coralite to be ready on this specific page
      await targetPage.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
      await targetPage.evaluate(() => window.__coralite__.lifecycle.hydrated)

      // Login Flow
      await targetPage.fill('input[placeholder="Enter username or email"]', username)
      await targetPage.fill('input[placeholder="Enter Password"]', appPassword)
      await targetPage.click('button:has-text("Login")')

      await expect(targetPage.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

      await targetPage.fill('input[placeholder="Enter Vault Password"]', vaultPassword)
      await targetPage.click('button:has-text("Unlock with Password")')

      await expect(targetPage.locator('app-layout')).toBeVisible({ timeout: 15000 })
    }

    await use(doLogin)
  }
})

export { expect } from '@playwright/test'
