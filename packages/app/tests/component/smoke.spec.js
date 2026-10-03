import { test, expect } from '@playwright/test'

test('app.html redirects to index.html when no session exists', async ({ page }) => {
  await page.goto('/app.html')
  await page.waitForURL('**/index.html')
  await expect(page.locator('auth-gate')).toBeVisible()
})

test('index.html renders the auth gate shell', async ({ page }) => {
  await page.goto('/index.html')
  await expect(page.locator('auth-gate')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})
