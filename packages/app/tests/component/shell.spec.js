import { test, expect } from '@playwright/test';

test.use({ video: 'on' });

async function setupAuthenticatedPage(page) {
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
}

test.describe('Messenger Shell Component Tests', () => {
  test('Desktop layout (1440x900)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupAuthenticatedPage(page);
    await page.goto('/app.html');

    const shell = page.locator('[data-testid="shell"]');
    await expect(shell).toBeVisible();
    await expect(page.locator('[data-testid="rail"]')).toBeVisible();
    await expect(page.locator('[data-testid="list-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="detail-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="bottom-nav"]')).not.toBeVisible();

    const gridCols = await shell.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(gridCols).toMatch(/^64px/);

    await page.screenshot({ path: 'test-results/shell-desktop.png', fullPage: true });
  });

  test('Tablet layout (820x1180)', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await setupAuthenticatedPage(page);
    await page.goto('/app.html');

    await expect(page.locator('[data-testid="shell"]')).toBeVisible();
    await expect(page.locator('[data-testid="rail"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="list-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="detail-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible();

    await page.screenshot({ path: 'test-results/shell-tablet.png', fullPage: true });
  });

  test('Mobile layout (390x844)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupAuthenticatedPage(page);
    await page.goto('/app.html');

    await expect(page.locator('[data-testid="shell"]')).toBeVisible();
    await expect(page.locator('[data-testid="rail"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="list-panel"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="detail-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible();

    await page.screenshot({ path: 'test-results/shell-mobile.png', fullPage: true });
  });

  test('Shell is hidden before app:ready', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atoll.session.token', 'test-session-token');
      localStorage.setItem('atoll.session.username', 'alice');
    });

    await page.route('**/api/v1/users/me', () => {});

    await page.goto('/app.html');
    await expect(page.locator('[data-testid="shell"]')).not.toBeVisible();
  });

  test('Shell reveals after app:ready', async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto('/app.html');
    await expect(page.locator('[data-testid="shell"]')).toBeVisible({ timeout: 5000 });
  });

  test('Landmarks and ARIA accessibility labels', async ({ page }) => {
    await setupAuthenticatedPage(page);
    await page.goto('/app.html');

    await expect(page.locator('rail-host')).toHaveAttribute('aria-label', 'Primary navigation');

    const listPanel = page.locator('[data-testid="list-panel"]');
    await expect(listPanel).toHaveAttribute('aria-label', 'Conversations');
    const listTag = await listPanel.evaluate((el) => el.tagName.toLowerCase());
    expect(listTag).toBe('section');

    const detailPanel = page.locator('[data-testid="detail-panel"]');
    await expect(detailPanel).toHaveAttribute('aria-label', 'Active view');
    const detailTag = await detailPanel.evaluate((el) => el.tagName.toLowerCase());
    expect(detailTag).toBe('main');

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await expect(bottomNav).toHaveAttribute('aria-label', 'Primary navigation');
    const navTag = await bottomNav.evaluate((el) => el.tagName.toLowerCase());
    expect(navTag).toBe('nav');
  });
});
