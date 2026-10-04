import { test, expect } from '@playwright/test'

test('index.html renders the auth gate shell', async ({ page }) => {
  await page.goto('/index.html')
  await expect(page.locator('auth-gate')).toBeVisible()
})
