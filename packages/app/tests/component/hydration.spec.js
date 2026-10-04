import { test, expect } from '@playwright/test'
import en from '../../src/lib/i18n/locales/en.js'
import fr from '../../src/lib/i18n/locales/fr.js'

test.use({ video: 'on' })

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('Component Hydration Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { window.localStorage.clear() } catch { /* ignore */ }
    })
  })

  test('1. Login view hydrates', async ({ page }) => {
    await page.goto('/index.html')
    await page.waitForSelector('html[data-coralite-ready]')

    const loginView = page.locator('auth-view-login')
    await expect(loginView.locator('h1')).toHaveText(en['auth_login_title'])
    await expect(loginView.locator('button[type="submit"]')).toHaveText(en['auth_login_submit_button'])

    await page.screenshot({ path: 'test-results/hydration-login.png', fullPage: true })
  })

  test('2. Register view hydrates', async ({ page }) => {
    await page.goto('/index.html')
    await page.waitForSelector('html[data-coralite-ready]')

    await page.getByRole('button', { name: new RegExp(escapeRegex(en['auth_login_register_link'].replace('→', '').trim()), 'i') }).click()

    const registerView = page.locator('auth-view-register')
    await expect(registerView.locator('h1')).toHaveText(en['auth_register_title'])
    await expect(registerView.getByLabel(en['auth_register_invite_code_label'])).toBeVisible()
    await expect(registerView.getByLabel(en['auth_register_username_label'])).toBeVisible()
    await expect(registerView.getByLabel(en['auth_register_display_name_label'])).toBeVisible()
    await expect(registerView.getByLabel(en['auth_register_password_label'])).toBeVisible()
  })

  test('3. Register confirm view hydrates', async ({ page }) => {
    await page.goto('/index.html')
    await page.waitForSelector('html[data-coralite-ready]')

    await page.evaluate(() => {
      const gate = document.querySelector('auth-gate')
      if (gate) {
        gate.dispatchEvent(new CustomEvent('auth:register:success', { detail: { userId: 'u_test123' }, bubbles: true }))
      }
    })

    const confirmView = page.locator('auth-view-confirm')
    await expect(confirmView.locator('h1')).toHaveText(en['auth_confirm_title'])
  })

  test('4. Recovery view hydrates', async ({ page }) => {
    await page.goto('/index.html')
    await page.waitForSelector('html[data-coralite-ready]')

    await page.getByRole('button', { name: new RegExp(escapeRegex(en['auth_login_recovery_link'].replace('→', '').trim()), 'i') }).click()

    const recoveryView = page.locator('auth-view-recovery')
    await expect(recoveryView.locator('h1')).toHaveText(en['auth_recovery_title'])
  })

  test('5. Boot view hydrates', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atoll.session.token', 'test-session-token')
      localStorage.setItem('atoll.session.username', 'alice')
    })

    await page.route('**/api/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'u_test_123',
          username_token: 'test_token',
          encrypted_display: null,
          identity_pubkey: 'pubkey123',
          profile: null,
          profile_version: 1,
          created_at: new Date().toISOString()
        })
      })
    )

    await page.route('**/api/v1/oprf/blind', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evaluated: 'SNMQYGSk2i4CM3QrPyvxt16TpA6QIek10OntpdZ2fDY='
        })
      })
    )

    await page.goto('/app.html')
    await page.waitForSelector('html[data-coralite-ready]')

    const bootEl = page.locator('messenger-boot [data-testid="boot"]')
    await expect(bootEl).toHaveAttribute('data-state', 'ready')
  })

  test('6. Runtime locale switch updates the DOM', async ({ page }) => {
    await page.goto('/index.html')
    await page.waitForSelector('html[data-coralite-ready]')

    // Test runtime locale switch by setting preference and reloading without beforeEach wiping storage
    await page.addInitScript(() => {
      try { window.localStorage.setItem('atoll.preference.locale', 'fr') } catch { /* ignore */ }
    })
    await page.reload()
    await page.waitForSelector('html[data-coralite-ready]')

    const loginView = page.locator('auth-view-login')
    await expect(loginView.locator('h1')).toHaveText(fr['auth_login_title'])

    await page.screenshot({ path: 'test-results/hydration-fr.png', fullPage: true })
  })
})
