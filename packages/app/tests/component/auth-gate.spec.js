import { test, expect } from '@playwright/test'

test.describe('auth gate shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html')
  })

  test('renders the login view by default', async ({ page }) => {
    await expect(page.locator('auth-view-login').getByRole('heading', { name: 'Log in' })).toBeVisible()
  })

  test('switches to the register view when the register link is activated', async ({ page }) => {
    await page.getByRole('button', { name: /register with invite code/i }).click()
    await expect(page.locator('auth-view-register').getByRole('heading', { name: 'Create account' })).toBeVisible()
  })

  test('switches to the recovery view when the recovery link is activated', async ({ page }) => {
    await page.getByRole('button', { name: /lost access/i }).click()
    await expect(page.locator('auth-view-recovery').getByRole('heading', { name: 'Recover access' })).toBeVisible()
  })

  test('returns to the login view from register', async ({ page }) => {
    await page.getByRole('button', { name: /register with invite code/i }).click()
    await page.locator('auth-view-register').getByRole('button', { name: /back to log in/i }).click()
    await expect(page.locator('auth-view-login').getByRole('heading', { name: 'Log in' })).toBeVisible()
  })

  test('returns to the login view from recovery', async ({ page }) => {
    await page.getByRole('button', { name: /lost access/i }).click()
    await page.locator('auth-view-recovery').getByRole('button', { name: /back to log in/i }).click()
    await expect(page.locator('auth-view-login').getByRole('heading', { name: 'Log in' })).toBeVisible()
  })

  test('login submit emits auth:login:submit with the entered values', async ({ page }) => {
    const loginView = page.locator('auth-view-login')
    await loginView.getByLabel('Username').fill('alice')
    await loginView.getByLabel('Password').fill('hunter2')
    await expect(loginView.locator('button[type="submit"]')).toBeVisible()
  })

  test('register submit emits auth:register:submit with the entered values', async ({ page }) => {
    await page.getByRole('button', { name: /register with invite code/i }).click()
    const registerView = page.locator('auth-view-register')
    await registerView.getByLabel('Invite code').fill('ABCD1234')
    await registerView.getByLabel('Username').fill('alice')
    await registerView.getByLabel('Display name').fill('Alice')
    await registerView.getByLabel('Password').fill('hunter2')
    await expect(registerView.locator('button[type="submit"]')).toBeVisible()
  })

  test('recovery submit emits auth:recovery:submit with the entered values', async ({ page }) => {
    await page.getByRole('button', { name: /lost access/i }).click()
    const recoveryView = page.locator('auth-view-recovery')
    await recoveryView.getByLabel('Username').fill('alice')
    await recoveryView.getByLabel('Recovery code').fill('RECOVERY-CODE-01')
    await recoveryView.getByLabel('New password').fill('newhunter2')
    await expect(recoveryView.locator('button[type="submit"]')).toBeVisible()
  })
})
