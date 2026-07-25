import { test as base, expect } from '@playwright/test'
import PocketBase from 'pocketbase'
import sodium from 'libsodium-wrappers-sumo'
import http from 'http'

/**
 * Saves test recovery codes to the mock server using standard HTTP module.
 *
 * @param {string} testId - Test identifier.
 * @param {string} username - User name.
 * @param {string[]} codes - Plaintext recovery codes.
 * @returns {Promise<void>} Resolves when done.
 */
function saveTestRecoveryCodes (testId, username, codes) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      username,
      codes
    })
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8090,
      path: '/api/set-test-recovery-codes',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-test-id': testId
      }
    }, () => {
      resolve()
    })
    req.on('error', (err) => {
      console.error('HTTP request failed:', err.message)
      resolve()
    })
    req.write(data)
    req.end()
  })
}

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
 * Encrypts private keys using the random Master Key.
 */
function encryptPrivateKeysV2 (privateKeys, masterKeyBytes, sodium) {
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
 * Encrypts the Master Key using KEK.
 */
function encryptMasterKeyWithKekV2 (masterKeyBytes, KEK, sodium) {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(masterKeyBytes, nonce, KEK)
  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
  }
}

/**
 * Generates 10 recovery wraps.
 */
function generateRecoveryWrapsV2 (masterKeyBytes, sodium) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const part = () => Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => chars[b % chars.length])
    .join('')

  const wraps = []
  const plaintextCodes = []
  for (let i = 0; i < 10; i++) {
    const code = `${part()}-${part()}-${part()}`
    plaintextCodes.push(code)
    const codeHash = sodium.crypto_generichash(32, code)
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
    const ciphertext = sodium.crypto_secretbox_easy(masterKeyBytes, nonce, codeHash)
    wraps.push({
      hash: sodium.to_base64(codeHash, sodium.base64_variants.ORIGINAL),
      ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
      nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
    })
  }
  return {
    wraps,
    plaintextCodes
  }
}

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const isVerbose = Boolean(process.env.DEBUG || process.env.VERBOSE)

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

async function resetPocketBase (testId) {
  if (process.env.DEBUG || process.env.VERBOSE) {
    console.log(`--- Resetting PocketBase (SDK) for test: ${testId} ---`)
  }
  await sodium.ready
  const pb = new PocketBase(PB_URL)

  // Set up the beforeSend hook to inject the x-test-id header
  pb.beforeSend = (url, options) => {
    options.headers = {
      ...options.headers,
      'x-test-id': testId
    }
    return {
      url,
      options
    }
  }

  // clear transactional collections
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

  // restore test users to default state
  for (const user of USERS) {
    try {
      let existingUser
      try {
        existingUser = await pb.collection('users').getFirstListItem(pb.filter('username = {:username}', { username: user.username }), {
          requestKey: null
        })
      } catch {
        // User doesn't exist, we will create it below
      }

      const masterKeys = await generateMasterKeys(sodium)
      const salt = generateSalt(sodium)
      const KEK = await deriveKeyFromPassword(SHARED_VAULT_PASSWORD, salt, sodium)

      const masterKeyBytes = sodium.randombytes_buf(32)
      const passwordWrap = encryptMasterKeyWithKekV2(masterKeyBytes, KEK, sodium)
      const encryptedPrivateKeys = encryptPrivateKeysV2(masterKeys, masterKeyBytes, sodium)
      const { wraps: recoveryWraps, plaintextCodes } = generateRecoveryWrapsV2(masterKeyBytes, sodium)

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
        encrypted_master_keys: passwordWrap,
        encrypted_private_keys: encryptedPrivateKeys,
        recovery_wraps: recoveryWraps,
        passkey_credential_id: '',
        passkey_prf_salt: '',
        encrypted_master_keys_passkey: null,
        altcha: 'atoll-mock-bypass-token'
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

      /* Save recovery codes to mock server's state */
      await saveTestRecoveryCodes(testId, user.username, plaintextCodes)
    } catch (error) {
      console.error(`Failed to restore user ${user.username}:`, error.data || error.message)
    }
  }

  if (process.env.DEBUG || process.env.VERBOSE) {
    console.log(`--- PocketBase Reset Complete for test: ${testId} ---`)
  }
}

export const test = base.extend({
  // Automatic fixture that resets the database before every test
  dbReset: [async ({}, use, testInfo) => {
    await resetPocketBase(testInfo.testId)
    await use()
  }, { auto: true }],

  page: async ({ page }, use, testInfo) => {
    const testId = testInfo.testId

    // Mock sw.js to prevent background takeover, caching, and unexpected reloads in E2E tests
    await page.context().route(url => url.href.endsWith('/sw.js'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mock SW for E2E tests");'
      })
    })

    // Intercept all API calls from the default page's context
    await page.context().route(url => url.href.includes('/api/'), async (route) => {
      const request = route.request()
      if (request.url().includes('/realtime') && request.method() === 'GET') {
        await route.continue()
        return
      }

      const headers = {
        ...request.headers(),
        'x-test-id': testId
      }
      await route.continue({ headers })
    })

    // Inject testId into the browser's window scope and override EventSource
    await page.context().addInitScript((tId) => {
      window.__playwright_test_id__ = tId

      const OriginalEventSource = window.EventSource
      window.EventSource = class extends OriginalEventSource {
        constructor (url, eventSourceInitDict) {
          if (url && (url.includes('/api/realtime') || url.includes('/api/')) && !url.includes('x-test-id=')) {
            const separator = url.includes('?') ? '&' : '?'
            url = `${url}${separator}x-test-id=${tId}`
          }
          super(url, eventSourceInitDict)
        }
      }
    }, testId)

    page.on('console', msg => {
      if (isVerbose || msg.type() === 'error') {
        console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`)
      }
    })
    page.on('pageerror', err => {
      console.log(`[BROWSER ERROR] ${err.message}`)
    })
    page.on('requestfailed', request => {
      if (isVerbose) {
        console.log(`[BROWSER REQUEST FAILED] ${request.url()}: ${request.failure()?.errorText || 'failed'}`)
      }
    })

    try {
      const client = await page.context().newCDPSession(page)
      await client.send('Network.setCacheDisabled', { cacheDisabled: true })
    } catch (e) {
      console.warn('Could not disable cache via CDP:', e.message)
    }

    await use(page)
  },

  loginApp: async ({ page }, use) => {
    const doLogin = async (username, appPassword, vaultPassword) => {
      await page.goto('/')
      await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
      await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

      const emailOrUsername = username.includes('@') ? username : `${username}@example.com`
      await page.locator('auth-login [data-testid$="username"]').fill(emailOrUsername)
      await page.locator('auth-login [data-testid$="password"]').fill(appPassword)
      await page.locator('auth-login [data-testid$="loginSubmit"]').click()

      await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

      await page.locator('vault-unlock [data-testid$="password"]').fill(vaultPassword)
      await page.locator('vault-unlock [data-testid$="unlockSubmit"]').click()

      await expect(page.locator('app-layout')).toBeVisible()
    }
    await use(doLogin)
  },

  loginCustomPage: async ({ baseURL }, use, testInfo) => {
    const testId = testInfo.testId
    const doLogin = async (targetPage, username, appPassword, vaultPassword) => {
      /* Mock sw.js to prevent background takeover, caching, and unexpected reloads in E2E tests */
      await targetPage.context().route(url => url.href.endsWith('/sw.js'), async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: 'console.log("Mock SW for E2E tests");'
        })
      })

      /* Intercept all API calls from manually created contexts as well */
      await targetPage.context().route(url => url.href.includes('/api/'), async (route) => {
        const request = route.request()
        if (request.url().includes('/realtime') && request.method() === 'GET') {
          await route.continue()
          return
        }

        const headers = {
          ...request.headers(),
          'x-test-id': testId
        }
        await route.continue({ headers })
      })

      /* Inject testId into the browser's window scope and override EventSource */
      await targetPage.context().addInitScript((tId) => {
        window.__playwright_test_id__ = tId

        const OriginalEventSource = window.EventSource
        window.EventSource = class extends OriginalEventSource {
          constructor (url, eventSourceInitDict) {
            if (url && (url.includes('/api/realtime') || url.includes('/api/')) && !url.includes('x-test-id=')) {
              const separator = url.includes('?') ? '&' : '?'
              url = `${url}${separator}x-test-id=${tId}`
            }
            super(url, eventSourceInitDict)
          }
        }
      }, testId)

      targetPage.on('console', msg => {
        if (isVerbose || msg.type() === 'error') {
          console.log(`[BROWSER][${username}] ${msg.type()}: ${msg.text()}`)
        }
      })
      targetPage.on('pageerror', err => {
        console.log(`[BROWSER ERROR][${username}] ${err.message}`)
      })

      /* Use the global baseURL if available */
      await targetPage.goto(baseURL || '/')

      /* Wait for Coralite to be ready on this specific page */
      await targetPage.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle && window.__coralite__.lifecycle.hydrated)

      /* Login Flow */
      const emailOrUsername = username.includes('@') ? username : `${username}@example.com`
      await targetPage.locator('auth-login [data-testid$="username"]').fill(emailOrUsername)
      await targetPage.locator('auth-login [data-testid$="password"]').fill(appPassword)
      await targetPage.locator('auth-login [data-testid$="loginSubmit"]').click()

      await expect(targetPage.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

      await targetPage.locator('vault-unlock [data-testid$="password"]').fill(vaultPassword)
      await targetPage.locator('vault-unlock [data-testid$="unlockSubmit"]').click()

      await expect(targetPage.locator('app-layout')).toBeVisible()
    }

    await use(doLogin)
  }
})

export { expect } from '@playwright/test'
