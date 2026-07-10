import { test, expect } from './fixtures/base-test.js'

test.describe('Authentication and Vault', () => {
  test('should login and unlock vault successfully', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Check for some element inside app-layout to be sure, e.g., the sidebar or chat list
    await expect(page.locator('nav-sidebar')).toBeVisible()
    await expect(page.locator('list-pane')).toBeVisible()
  })

  test('should login, logout, and login again successfully', async ({ page, loginApp }) => {
    test.setTimeout(60000)

    // 1. Initial Login
    console.log('--- Initial Login ---')
    await loginApp('alice', 'Password123!', 'VaultPassword123!')
    await expect(page.locator('app-layout')).toBeVisible()

    // 2. Logout
    console.log('--- Logout ---')
    await page.locator('[data-testid$="btnLogout"]').click()
    await expect(page.locator('auth-login')).toBeVisible()

    // 3. Login again
    console.log('--- Second Login ---')
    await page.locator('[data-testid$="username"]').fill('alice')
    await page.locator('[data-testid$="password"]').fill('Password123!')
    await page.locator('[data-testid$="loginSubmit"]').click()

    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

    await page.locator('[data-testid$="password"]').fill('VaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()

    // This is where it's expected to fail or hang
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    // Create a room to ensure there is something to sync
    console.log('--- Creating Room ---')
    await page.locator('[data-testid$="btnCreateRoom"]').click()
    await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid$="btnCreate"]').click()

    await expect(page.locator('chat-list-item')).toBeVisible({ timeout: 15000 })

    // 2. Logout
    console.log('--- Logout ---')
    await page.locator('[data-testid$="btnLogout"]').click()
    await expect(page.locator('auth-login')).toBeVisible()

    // 3. Login again
    console.log('--- Second Login ---')
    await page.locator('[data-testid$="username"]').fill('alice')
    await page.locator('[data-testid$="password"]').fill('Password123!')
    await page.locator('[data-testid$="loginSubmit"]').click()

    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

    await page.locator('[data-testid$="password"]').fill('VaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()

    await expect(page.locator('app-layout')).toBeVisible({ timeout: 25000 })

    // Check if chats are loaded (to verify sync)
    await expect(page.locator('chat-list-item')).toBeVisible({ timeout: 20000 })
  })
})
