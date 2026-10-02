import { test, expect } from '@playwright/test'

test('app.html renders the messenger shell placeholder', async ({ page }) => {
  await page.goto('/app.html')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Messenger Shell')
})

test('index.html renders the auth gate shell', async ({ page }) => {
  await page.goto('/index.html')
  await expect(page.locator('auth-gate')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})
