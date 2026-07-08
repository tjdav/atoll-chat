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
    await page.click('button[title="Logout"]')
    await expect(page.locator('auth-login')).toBeVisible()

    // 3. Login again
    console.log('--- Second Login ---')
    await page.fill('input[placeholder="Enter username or email"]', 'alice')
    await page.fill('input[placeholder="Enter Password"]', 'Password123!')
    await page.click('button:has-text("Login")')

    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

    await page.fill('input[placeholder="Enter Vault Password"]', 'VaultPassword123!')
    await page.click('button:has-text("Unlock with Password")')

    // This is where it's expected to fail or hang
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    // Create a room to ensure there is something to sync
    console.log('--- Creating Room ---')
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username or email..."]', 'bob')
    // Give it a bit more time for search results to appear
    await page.waitForSelector('.search-result-item:has-text("bob")', { timeout: 10000 })
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')

    await expect(page.locator('chat-list-item')).toBeVisible({ timeout: 15000 })

    // 2. Logout
    console.log('--- Logout ---')
    await page.click('button[title="Logout"]')
    await expect(page.locator('auth-login')).toBeVisible()

    // 3. Login again
    console.log('--- Second Login ---')
    await page.fill('input[placeholder="Enter username or email"]', 'alice')
    await page.fill('input[placeholder="Enter Password"]', 'Password123!')
    await page.click('button:has-text("Login")')

    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

    await page.fill('input[placeholder="Enter Vault Password"]', 'VaultPassword123!')
    await page.click('button:has-text("Unlock with Password")')

    await expect(page.locator('app-layout')).toBeVisible({ timeout: 25000 })

    // Check if chats are loaded (to verify sync)
    await expect(page.locator('chat-list-item')).toBeVisible({ timeout: 20000 })
  })
})
