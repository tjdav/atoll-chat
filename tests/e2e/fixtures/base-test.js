import { test as base, expect } from '@playwright/test'

export const test = base.extend({
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
      await page.waitForFunction(() => window.__coralite_ready__ !== undefined)
      await page.evaluate(() => window.__coralite_ready__)

      await page.fill('input[placeholder="Enter username or email"]', username)
      await page.fill('input[placeholder="Enter Password"]', appPassword)
      await page.click('button:has-text("Login")')

      await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

      await page.fill('input[placeholder="Enter Password"]', vaultPassword)
      await page.click('button:has-text("Unlock with Password")')

      await expect(page.locator('app-layout')).toBeVisible({ timeout: 10000 })
    }
    await use(doLogin)
  },

  loginCustomPage: async ({ baseURL }, use) => {
    const doLogin = async (targetPage, username, appPassword, vaultPassword) => {
      // Use the global baseURL if available
      await targetPage.goto(baseURL || '/')

      // Wait for Coralite to be ready on this specific page
      await targetPage.waitForFunction(() => window.__coralite_ready__ !== undefined)
      await targetPage.evaluate(() => window.__coralite_ready__)

      // Login Flow
      await targetPage.fill('input[placeholder="Enter username or email"]', username)
      await targetPage.fill('input[placeholder="Enter Password"]', appPassword)
      await targetPage.click('button:has-text("Login")')

      await expect(targetPage.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

      await targetPage.fill('input[placeholder="Enter Password"]', vaultPassword)
      await targetPage.click('button:has-text("Unlock with Password")')

      await expect(targetPage.locator('app-layout')).toBeVisible({ timeout: 15000 })
    }

    await use(doLogin)
  }
})

export { expect } from '@playwright/test'
