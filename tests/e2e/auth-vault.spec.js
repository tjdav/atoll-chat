import { test, expect } from './fixtures/base-test.js'

test.describe('Authentication and Vault', () => {
  test('should login and unlock vault successfully', async ({ page }) => {
    // Navigate to the app
    await page.goto('/')

    // Log in
    await page.fill('input[placeholder="Enter username or email"]', 'alice')
    await page.fill('input[placeholder="Enter Password"]', 'Password123!')
    await page.click('button:has-text("Login")')

    // Wait for vault unlock screen
    await expect(page.locator('h5:has-text("Unlock Your Vault")')).toBeVisible()

    // Unlock vault
    await page.fill('input[placeholder="Enter Password"]', '123456')
    await page.click('button:has-text("Unlock with Password")')

    // Verify successful unlock and app layout visibility
    // app-layout should be appended to app-root when unlocked
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 10000 })

    // Check for some element inside app-layout to be sure, e.g., the sidebar or chat list
    await expect(page.locator('nav-sidebar')).toBeVisible()
    await expect(page.locator('list-pane')).toBeVisible()
  })
})
