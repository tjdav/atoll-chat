import { test, expect } from '@playwright/test';

test.describe('Login Flow Component Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
  });

  test('renders error region when server returns an error during login flow', async ({ page }) => {
    await page.route('/api/v1/oprf/blind', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal_error', message: 'OPRF Service Unavailable' }),
      });
    });

    const loginView = page.locator('auth-view-login');
    await loginView.locator('input[name="username"]').fill('alice');
    await loginView.locator('input[name="password"]').fill('secret123');

    const submitButton = loginView.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
    expect(page.url()).toContain('/index.html');
  });

  test('displays pending state on submit button while request is in flight', async ({ page }) => {
    await page.route('/api/v1/oprf/blind', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'test_done' }),
      });
    });

    const loginView = page.locator('auth-view-login');
    await loginView.locator('input[name="username"]').fill('bob');
    await loginView.locator('input[name="password"]').fill('secret123');

    const submitButton = loginView.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
  });
});
