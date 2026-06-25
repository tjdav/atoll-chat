import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  // Define a new fixture called 'loginApp'
  loginApp: async ({ page }, use) => {
    // This is the function the test will receive
    const doLogin = async (username, appPassword, vaultPassword) => {
      await page.goto('/')

      // Wait for Coralite to be ready
      await page.waitForFunction(() => window.__coralite_ready__ !== undefined)
      await page.evaluate(() => window.__coralite_ready__)

      // Login
      await page.fill('input[placeholder="Enter username or email"]', username)
      await page.fill('input[placeholder="Enter Password"]', appPassword)
      await page.click('button:has-text("Login")')

      await expect(page.locator('h3:has-text("Unlock Your Vault")')).toBeVisible()

      await page.fill('input[placeholder="Enter Password"]', vaultPassword)
      await page.click('button:has-text("Unlock with Password")')

      await expect(page.locator('app-layout')).toBeVisible({ timeout: 10000 })
    }

    // Pass the function to the tests
    await use(doLogin)
  }
})

export { expect } from '@playwright/test'
