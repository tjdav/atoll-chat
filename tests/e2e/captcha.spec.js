import { test, expect } from './fixtures/base-test.js'

test.describe('PoW CAPTCHA (ALTCHA) Integration', () => {
  test('should display ALTCHA widget on login page', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    const altchaWidget = page.locator('auth-login altcha-widget')
    await expect(altchaWidget).toBeAttached()
    await expect(altchaWidget).toHaveAttribute('test', 'true')
  })

  test('should display ALTCHA widget on registration page', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    // Switch to register page
    await page.locator('[data-testid$="linkRegister"]').click()

    const altchaWidget = page.locator('auth-register altcha-widget')
    await expect(altchaWidget).toBeAttached()
    await expect(altchaWidget).toHaveAttribute('test', 'true')
  })

  test('should successfully login and verify captcha using test bypass', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Check for some element inside app-layout to be sure, e.g., the sidebar or chat list
    await expect(page.locator('nav-sidebar')).toBeVisible()
    await expect(page.locator('list-pane')).toBeVisible()
  })

  test('should successfully register a new account and verify captcha using test bypass', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    // Navigate to registration
    await page.locator('[data-testid$="linkRegister"]').click()

    // Fill in registration form
    await page.locator('auth-register input[name="username"]').fill('test_user_captcha')
    await page.locator('auth-register [data-testid$="invitationCode"]').fill('INV-SEED-2222')
    await page.locator('auth-register input[name="password"]').fill('Password123!')
    await page.locator('auth-register input[name="passwordConfirm"]').fill('Password123!')

    // Submit form
    await page.locator('[data-testid$="registerSubmit"]').click()

    // Registration should succeed and proceed directly to app-layout
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 15000 })
  })
})
