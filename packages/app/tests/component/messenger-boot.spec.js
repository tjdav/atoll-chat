import { test, expect } from '@playwright/test'

test.use({ video: 'on' })

test.describe('Messenger Boot Component Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Clear storage before each test
    await page.addInitScript(() => {
      try {
        localStorage.clear()
      } catch {
        // ignore
      }
    })
  })

  test('valid session token verifies identity and emits app:ready', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atoll.session.token', 'test-session-token')
      localStorage.setItem('atoll.session.username', 'alice')
    })

    let meCalled = false
    await page.route('**/api/v1/users/me', (route) => {
      meCalled = true
      return route.fulfill({
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
    })

    let oprfCalled = false
    await page.route('**/api/v1/oprf/blind', (route) => {
      oprfCalled = true
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evaluated: 'SNMQYGSk2i4CM3QrPyvxt16TpA6QIek10OntpdZ2fDY='
        })
      })
    })

    await page.goto('/app.html')

    const bootComponent = page.locator('messenger-boot')
    await expect(bootComponent).toHaveAttribute('ready', '', { timeout: 5000 })

    expect(meCalled).toBe(true)
    expect(oprfCalled).toBe(true)
  })

  test('missing session token redirects to index.html', async ({ page }) => {
    await page.goto('/app.html')

    // Should redirect to index.html because no session token is stored
    await page.waitForURL('**/index.html')
    await expect(page.locator('auth-gate')).toBeVisible()
  })

  test('network error during boot displays error alert', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atoll.session.token', 'test-session-token')
      localStorage.setItem('atoll.session.username', 'alice')
    })

    await page.route('**/api/v1/users/me', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal_error', message: 'Server error' })
      })
    )

    await page.goto('/app.html')

    const bootComponent = page.locator('messenger-boot')
    await expect(bootComponent).toHaveAttribute('error', 'Server error')
    await expect(bootComponent.locator('.error')).toBeVisible()
    await expect(bootComponent.locator('.error')).toHaveText('Server error')
  })

  test('OPRF error during boot continues gracefully if user profile was fetched', async ({ page }) => {
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
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal_error', message: 'Server error' })
      })
    )

    await page.goto('/app.html')
    const bootComponent = page.locator('messenger-boot')
    await expect(bootComponent).toHaveAttribute('ready', '')
  })

  test('expired session (401) clears storage and redirects to index.html', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atoll.session.token', 'expired-token')
      localStorage.setItem('atoll.session.username', 'alice')
    })

    await page.route('**/api/v1/users/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthorized', message: 'Session expired' })
      })
    )

    await page.goto('/app.html')
    await page.waitForURL('**/index.html')
    await expect(page.locator('auth-gate')).toBeVisible()

    const storedToken = await page.evaluate(() => localStorage.getItem('atoll.session.token'))
    expect(storedToken).toBeNull()
  })
})
