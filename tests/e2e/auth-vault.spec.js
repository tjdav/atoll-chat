import { test, expect } from './fixtures/base-test.js'

test.describe('Authentication and Vault', () => {
  test('should login and unlock vault successfully', async ({ page }) => {
    await loginApp('alice', 'Password123!', '123456')

    // Check for some element inside app-layout to be sure, e.g., the sidebar or chat list
    await expect(page.locator('nav-sidebar')).toBeVisible()
    await expect(page.locator('list-pane')).toBeVisible()
  })
})
