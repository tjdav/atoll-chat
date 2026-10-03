import { test, expect } from '@playwright/test'

test.use({ video: 'on' })

test.describe('Register Form Wiring & ALTCHA Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html')
    // Navigate from login view to register view
    await page.click('button:has-text("Register with invite code →")')
  })

  test('ALTCHA widget is present', async ({ page }) => {
    const altchaWidget = page.locator('altcha-widget')
    await expect(altchaWidget).toBeVisible()
    await expect(altchaWidget).toHaveAttribute('challengeurl', '/api/v1/auth/register/challenge')
  })

  test('Switching back to login does not fire the flow', async ({ page }) => {
    let oprfCalled = false
    await page.route('/api/v1/oprf/blind', async (route) => {
      oprfCalled = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.click('button:has-text("← Back to log in")')

    expect(oprfCalled).toBe(false)
    await expect(page.locator('button:has-text("Register with invite code →")')).toBeVisible()
  })

  test('Form submission with values attempts registration and shows error on failure', async ({ page }) => {
    await page.route('/api/v1/oprf/blind', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_request' })
      })
    })

    const registerView = page.locator('auth-view-register')
    await registerView.locator('input[name="inviteCode"]').fill('INVITE12')
    await registerView.locator('input[name="username"]').fill('alice')
    await registerView.locator('input[name="displayName"]').fill('Alice Smith')
    await registerView.locator('input[name="password"]').fill('Password123!')

    await registerView.locator('button[type="submit"]').click()

    const errorRegion = registerView.locator('p[role="alert"]')
    await expect(errorRegion).toBeVisible()
    await expect(errorRegion).not.toBeEmpty()

    expect(page.url()).toContain('/index.html')
  })

  test('Network error renders the right message', async ({ page }) => {
    await page.route('/api/v1/oprf/blind', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal_server_error' })
      })
    })

    const registerView = page.locator('auth-view-register')
    await registerView.locator('input[name="inviteCode"]').fill('INVITE12')
    await registerView.locator('input[name="username"]').fill('alice')
    await registerView.locator('input[name="displayName"]').fill('Alice Smith')
    await registerView.locator('input[name="password"]').fill('Password123!')

    await registerView.locator('button[type="submit"]').click()

    const errorRegion = registerView.locator('p[role="alert"]')
    await expect(errorRegion).toBeVisible()
    await expect(errorRegion).toContainText('server')
  })

  test('Pending state toggles the button label', async ({ page }) => {
    await page.route('/api/v1/oprf/blind', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal_server_error' })
      })
    })

    const registerView = page.locator('auth-view-register')
    await registerView.locator('input[name="inviteCode"]').fill('INVITE12')
    await registerView.locator('input[name="username"]').fill('alice')
    await registerView.locator('input[name="displayName"]').fill('Alice Smith')
    await registerView.locator('input[name="password"]').fill('Password123!')

    const submitBtn = registerView.locator('button[type="submit"]')
    await submitBtn.click()

    await expect(submitBtn).toHaveText('Creating account…')
    await expect(submitBtn).toBeDisabled()

    await expect(submitBtn).toHaveText('Create account')
    await expect(submitBtn).toBeEnabled()
  })

  test('auth:register:submit still fires with the altcha field', async ({ page }) => {
    await page.route('/api/v1/oprf/blind', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_request' })
      })
    })

    await page.evaluate(() => {
      window.__registerEvents = []
      window.addEventListener('auth:register:submit', (e) => {
        window.__registerEvents.push(e.detail)
      })
    })

    const registerView = page.locator('auth-view-register')
    await registerView.locator('input[name="inviteCode"]').fill('INVITE12')
    await registerView.locator('input[name="username"]').fill('alice')
    await registerView.locator('input[name="displayName"]').fill('Alice Smith')
    await registerView.locator('input[name="password"]').fill('Password123!')

    await registerView.locator('button[type="submit"]').click()

    const events = await page.evaluate(() => window.__registerEvents)
    expect(events.length).toBe(1)
    expect(events[0]).toHaveProperty('inviteCode', 'INVITE12')
    expect(events[0]).toHaveProperty('username', 'alice')
    expect(events[0]).toHaveProperty('displayName', 'Alice Smith')
    expect(events[0]).toHaveProperty('password', 'Password123!')
    expect(events[0]).toHaveProperty('altcha')
  })
})
