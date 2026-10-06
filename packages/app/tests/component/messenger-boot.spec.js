import { test, expect } from '@playwright/test';

test.use({ video: 'on' });

test.describe('Messenger Boot Component Tests', () => {
  test('app.html redirects to index.html without a session', async ({ page }) => {
    await page.goto('/app.html');
    await page.waitForURL('**/index.html');
    await expect(page.locator('auth-gate')).toBeVisible();
  });

  test('valid session and working OPRF result in ready state and takes screenshot', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atoll.session.token', 'test-session-token');
      localStorage.setItem('atoll.session.username', 'alice');
    });

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
    );

    await page.route('**/api/v1/oprf/blind', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evaluated: 'SNMQYGSk2i4CM3QrPyvxt16TpA6QIek10OntpdZ2fDY='
        })
      })
    );

    await page.goto('/app.html');
    const bootEl = page.locator('[data-testid="boot"]');
    await expect(bootEl).toHaveAttribute('data-state', 'ready');

    const storageReady = await bootEl.getAttribute('data-storage-ready');
    if (storageReady === 'true') {
      const persistent = await bootEl.getAttribute('data-storage-persistent');
      expect(['true', 'false']).toContain(persistent);
    }

    await page.screenshot({ path: 'test-results/messenger-boot.png', fullPage: true });
  });

  test('shell reveals when session is validated without waiting for storage', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => {
      localStorage.setItem('atoll.session.token', 'test-session-token');
      localStorage.setItem('atoll.session.username', 'alice');
    });

    await page.route('**/api/v1/users/me', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({
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
      });
    });

    await page.route('**/api/v1/oprf/blind', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evaluated: 'SNMQYGSk2i4CM3QrPyvxt16TpA6QIek10OntpdZ2fDY='
        })
      })
    );

    await page.goto('/app.html');
    const shellEl = page.locator('messenger-shell');
    const bootEl = page.locator('[data-testid="boot"]');

    await expect(bootEl).toHaveAttribute('data-state', 'ready');
    await expect(shellEl).toBeVisible();
  });

  test('storage failure leaves shell mounted and ready state without setting storage-ready', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => {
      localStorage.setItem('atoll.session.token', 'test-session-token');
      localStorage.setItem('atoll.session.username', 'alice');
    });

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
    );

    await page.route('**/api/v1/oprf/blind', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evaluated: 'SNMQYGSk2i4CM3QrPyvxt16TpA6QIek10OntpdZ2fDY='
        })
      })
    );

    await page.route('**/assets/sqlite/**', (route) =>
      route.fulfill({ status: 404, body: 'Not found' })
    );

    await page.goto('/app.html');
    const bootEl = page.locator('[data-testid="boot"]');
    await expect(bootEl).toHaveAttribute('data-state', 'ready');

    await page.waitForTimeout(1000);
    const storageReady = await bootEl.getAttribute('data-storage-ready');
    expect(storageReady).not.toBe('true');

    const shellEl = page.locator('messenger-shell');
    await expect(shellEl).toBeVisible();
  });

  test('valid session when OPRF endpoint fails still reaches ready state', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atoll.session.token', 'test-session-token');
      localStorage.setItem('atoll.session.username', 'alice');
    });

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
    );

    await page.route('**/api/v1/oprf/blind', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal_error', message: 'Server error' })
      })
    );

    await page.goto('/app.html');
    const bootEl = page.locator('[data-testid="boot"]');
    await expect(bootEl).toHaveAttribute('data-state', 'ready');
  });

  test('expired session (401) clears storage and redirects to index.html', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atoll.session.token', 'expired-token');
      localStorage.setItem('atoll.session.username', 'alice');
    });

    await page.route('**/api/v1/users/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthorized', message: 'Session expired' })
      })
    );

    await page.goto('/app.html');
    await page.waitForURL('**/index.html');
    await expect(page.locator('auth-gate')).toBeVisible();

    const storedToken = await page.evaluate(() => localStorage.getItem('atoll.session.token'));
    expect(storedToken).toBeNull();
  });
});
