import { test, expect } from './fixtures/base-test.js'
import PocketBase from 'pocketbase'

const PB_URL = process.env.ATOLL_POCKETBASE_URL || process.env.ATOLL_INTERNAL_POCKETBASE_URL || 'http://localhost:8091'

test.describe('Authentication and Vault', () => {
  test('should login and unlock vault successfully', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Check for some element inside app-layout to be sure, e.g., the sidebar or chat list
    await expect(page.locator('nav-sidebar')).toBeVisible()
    await expect(page.locator('list-pane')).toBeVisible()
  })

  test('should login, logout, and login again successfully', async ({ page, loginApp }) => {
    // initial login
    console.log('--- Initial Login ---')
    await loginApp('alice', 'Password123!', 'VaultPassword123!')
    await expect(page.locator('app-layout')).toBeVisible()

    // logout
    console.log('--- Logout 1 ---')
    await page.locator('[data-testid$="profileBtn"]').click()
    await page.locator('[data-testid$="btnLogout"]').click()
    await expect(page.locator('auth-login')).toBeVisible()

    // login again
    console.log('--- Second Login ---')
    await page.locator('auth-login [data-testid$="username"]').fill('alice')
    await page.locator('auth-login [data-testid$="password"]').fill('Password123!')
    await page.locator('auth-login [data-testid$="loginSubmit"]').click()

    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

    await page.locator('[data-testid$="password"]').fill('VaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()

    await expect(page.locator('app-layout')).toBeVisible()

    // Create a room to ensure there is something to sync
    console.log('--- Creating Room ---')
    await page.locator('[data-testid$="btnCreateRoom"]').click()
    await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid$="btnCreate"]').click()

    await expect(page.locator('chat-list-item')).toBeVisible()

    // logout
    console.log('--- Logout 2 ---')
    await page.locator('[data-testid$="profileBtn"]').click()
    await page.locator('[data-testid$="btnLogout"]').click()
    await expect(page.locator('auth-login')).toBeVisible()

    // login again
    console.log('--- Third Login ---')
    await page.locator('auth-login [data-testid$="username"]').fill('alice')
    await page.locator('auth-login [data-testid$="password"]').fill('Password123!')
    await page.locator('auth-login [data-testid$="loginSubmit"]').click()

    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

    await page.locator('[data-testid$="password"]').fill('VaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()

    await expect(page.locator('app-layout')).toBeVisible()

    // Check if chats are loaded (to verify sync)
    await expect(page.locator('chat-list-item')).toBeVisible()
  })

  test('should fail registration with invalid invitation code', async ({ page }) => {
    await page.goto('/')
    await page.locator('auth-login [data-testid$="linkRegister"]').click()
    await expect(page.locator('auth-register')).toBeVisible()

    await page.locator('auth-register [data-testid$="username"]').fill('newuser')
    await page.locator('auth-register [data-testid$="invitationCode"]').fill('INV-INVALID-CODE')
    await page.locator('auth-register [data-testid$="password"]').fill('Password123!456')
    await page.locator('auth-register [data-testid$="passwordConfirm"]').fill('Password123!456')
    await page.locator('auth-register [data-testid$="registerSubmit"]').click()

    // Should display error message
    await expect(page.locator('auth-register [data-testid$="statusMsg"]')).toContainText('Invalid or expired invitation code')
  })

  test('should register successfully with valid invitation code and set up vault', async ({ page }) => {
    await page.goto('/')
    await page.locator('auth-login [data-testid$="linkRegister"]').click()
    await expect(page.locator('auth-register')).toBeVisible()

    await page.locator('auth-register [data-testid$="username"]').fill('sam')
    await page.locator('auth-register [data-testid$="invitationCode"]').fill('INV-SEED-1111')
    await page.locator('auth-register [data-testid$="password"]').fill('Password123!456')
    await page.locator('auth-register [data-testid$="passwordConfirm"]').fill('Password123!456')
    await page.locator('auth-register [data-testid$="registerSubmit"]').click()

    // Should successfully proceed directly into the application layout
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 15000 })
  })

  test('should enforce username immutability post-creation', async ({ loginApp }, testInfo) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // We check via the API directly using Node-level PocketBase client
    const pb = new PocketBase(PB_URL)
    pb.beforeSend = (url, options) => {
      options.headers = options.headers || {}
      options.headers['x-test-id'] = testInfo.testId
      return {
        url,
        options
      }
    }

    // Authenticate as alice using literal test password 'Password123!'
    const authData = await pb.collection('users').authWithPassword('alice', 'Password123!')

    let threwImmutabilityError = false
    try {
      await pb.collection('users').update(authData.record.id, {
        username: 'alice_mutated'
      })
    } catch (err) {
      threwImmutabilityError = err.message.includes('immutable') || err.status === 400
    }

    expect(threwImmutabilityError).toBe(true)
  })
})
