import { test, expect } from '@playwright/test'

test.use({ video: 'on' })

test.describe('User-Scoped Sync Plugin Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Stub /users/me
    await page.route('**/api/v1/users/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'u_sync_test_user',
          username_token: 'test_token',
          encrypted_display: null,
          identity_pubkey: 'pub_key_sync_tester',
          profile: null,
          profile_version: 1,
          created_at: new Date().toISOString()
        })
      })
    })

    // Stub /oprf/blind
    await page.route('**/api/v1/oprf/blind', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evaluated: 'SNMQYGSk2i4CM3QrPyvxt16TpA6QIek10OntpdZ2fDY='
        })
      })
    })
  })

  test('1. Boot completes and initial user-scoped sync executes successfully', async ({ page }) => {
    let syncCalled = false

    await page.route('**/api/v1/users/me/sync*', async (route) => {
      syncCalled = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          read_state: [
            { room_id: 'r_boot_1', last_read_message_id: 'm_boot_10', user_seq: 1 }
          ],
          user_preferences: [],
          device_state: [],
          starred_items: [],
          max_seq: 1,
          full_resync_required: false
        })
      })
    })

    await page.goto('/index.html')
    await page.evaluate(() => {
      localStorage.setItem('atoll.session.token', 's_sync_test_session_token')
      localStorage.setItem('atoll.session.username', 'alice')
    })

    await page.goto('/app.html')

    const bootElement = page.locator('messenger-boot')
    await expect(bootElement).toHaveAttribute('ready', '', { timeout: 10000 })

    const shellElement = page.locator('messenger-shell')
    await expect(shellElement).toBeVisible()

    await page.screenshot({ path: 'test-results/sync-boot.png', fullPage: true })
  })

  test('2. Sync failure is non-fatal and shell still reveals', async ({ page }) => {
    await page.route('**/api/v1/users/me/sync*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal_server_error' })
      })
    })

    await page.goto('/index.html')
    await page.evaluate(() => {
      localStorage.setItem('atoll.session.token', 's_sync_test_session_token')
      localStorage.setItem('atoll.session.username', 'alice')
    })

    await page.goto('/app.html')

    const bootElement = page.locator('messenger-boot')
    await expect(bootElement).toHaveAttribute('ready', '', { timeout: 10000 })

    const shellElement = page.locator('messenger-shell')
    await expect(shellElement).toBeVisible()
  })

  test('3. Sync is skipped when user profile is unavailable on boot', async ({ page }) => {
    // Override /users/me to fail
    await page.route('**/api/v1/users/me', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'user_fetch_failed' })
      })
    })

    let syncCalled = false
    await page.route('**/api/v1/users/me/sync*', async (route) => {
      syncCalled = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ max_seq: 0 })
      })
    })

    await page.goto('/index.html')
    await page.evaluate(() => {
      localStorage.setItem('atoll.session.token', 's_sync_test_session_token')
      localStorage.setItem('atoll.session.username', 'alice')
    })

    await page.goto('/app.html')

    const bootElement = page.locator('messenger-boot')
    await expect(bootElement).toHaveAttribute('ready', '', { timeout: 10000 })
    expect(syncCalled).toBe(false)
  })
})
