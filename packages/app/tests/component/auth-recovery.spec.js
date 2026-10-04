import { test, expect } from '@playwright/test';
import en from '../../src/lib/i18n/locales/en.js';
import fr from '../../src/lib/i18n/locales/fr.js';
import de from '../../src/lib/i18n/locales/de.js';

test.use({ video: 'on' });

test.describe('Account Recovery Form Component', () => {
  test('Recovery view renders with all four fields and back link', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('html[data-coralite-ready]');

    // Click recovery link on login view
    await page.click('button:has-text("Lost access? Use recovery →")');

    const recoveryCard = page.locator('auth-view-recovery');
    await expect(recoveryCard).toBeVisible();

    // Verify title
    await expect(recoveryCard.locator('h1')).toHaveText(en.auth_recovery_title);

    // Verify labels
    await expect(recoveryCard.locator('label').nth(0)).toContainText(en.auth_recovery_username_label);
    await expect(recoveryCard.locator('label').nth(1)).toContainText(en.auth_recovery_recovery_code_label);
    await expect(recoveryCard.locator('label').nth(2)).toContainText(en.auth_recovery_display_name_label);
    await expect(recoveryCard.locator('label').nth(3)).toContainText(en.auth_recovery_new_password_label);

    // Verify back link
    await expect(recoveryCard.locator('button.link')).toHaveText(en.auth_recovery_back_link);

    await page.screenshot({ path: 'test-results/auth-recovery.png' });
  });

  test('Submit shows pending state when API call is delayed', async ({ page }) => {
    // Intercept OPRF blind request with 500ms delay
    await page.route('**/api/v1/oprf/blind', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ evaluated: 'A'.repeat(88) })
      });
    });

    await page.goto('/index.html');
    await page.waitForSelector('html[data-coralite-ready]');

    await page.click('button:has-text("Lost access? Use recovery →")');
    const recoveryCard = page.locator('auth-view-recovery');

    // Fill form
    await recoveryCard.locator('input[name="username"]').fill('alice');
    await recoveryCard.locator('input[name="recoveryCode"]').fill('REC1-AAAA');
    await recoveryCard.locator('input[name="displayName"]').fill('Alice');
    await recoveryCard.locator('input[name="newPassword"]').fill('newPassword123!');

    // Submit
    const submitBtn = recoveryCard.locator('button.primary');
    await submitBtn.click();

    // Verify pending button label and disabled state
    await expect(submitBtn).toHaveText(en.auth_recovery_submit_pending);
    await expect(submitBtn).toBeDisabled();
  });

  test('Invalid recovery code displays error message', async ({ page }) => {

    await page.route('**/api/v1/oprf/blind', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ evaluated: 'A'.repeat(88) })
      });
    });

    await page.route('**/api/v1/auth/recover/start', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'recovery_failed', message: 'Recovery code not found' })
      });
    });

    await page.goto('/index.html');
    await page.waitForSelector('html[data-coralite-ready]');

    await page.click('button:has-text("Lost access? Use recovery →")');
    const recoveryCard = page.locator('auth-view-recovery');

    await recoveryCard.locator('input[name="username"]').fill('alice');
    await recoveryCard.locator('input[name="recoveryCode"]').fill('BAD-CODE');
    await recoveryCard.locator('input[name="displayName"]').fill('Alice');
    await recoveryCard.locator('input[name="newPassword"]').fill('newPassword123!');

    await recoveryCard.locator('button.primary').click();

    // Verify error message region becomes visible with error string
    const errorRegion = recoveryCard.locator('p[role="alert"]');
    await expect(errorRegion).toBeVisible();
    await expect(errorRegion).not.toBeEmpty();
    // Confirm page did not navigate
    await expect(page).toHaveURL(/\/index\.html$/);
  });

  test('French locale rendering', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atoll.preference.locale', 'fr');
    });

    await page.goto('/index.html');
    await page.waitForSelector('html[data-coralite-ready]');

    await page.click('button:has-text("Accès perdu ? Utiliser la récupération →")');
    const recoveryCard = page.locator('auth-view-recovery');

    await expect(recoveryCard.locator('h1')).toHaveText(fr.auth_recovery_title);
    await expect(recoveryCard.locator('label').nth(0)).toContainText(fr.auth_recovery_username_label);
    await expect(recoveryCard.locator('label').nth(1)).toContainText(fr.auth_recovery_recovery_code_label);
    await expect(recoveryCard.locator('label').nth(2)).toContainText(fr.auth_recovery_display_name_label);
    await expect(recoveryCard.locator('label').nth(3)).toContainText(fr.auth_recovery_new_password_label);
    await expect(recoveryCard.locator('button.link')).toHaveText(fr.auth_recovery_back_link);
  });

  test('German locale rendering', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atoll.preference.locale', 'de');
    });

    await page.goto('/index.html');
    await page.waitForSelector('html[data-coralite-ready]');

    await page.click('button:has-text("Zugriff verloren? Wiederherstellung nutzen →")');
    const recoveryCard = page.locator('auth-view-recovery');

    await expect(recoveryCard.locator('h1')).toHaveText(de.auth_recovery_title);
    await expect(recoveryCard.locator('label').nth(0)).toContainText(de.auth_recovery_username_label);
    await expect(recoveryCard.locator('label').nth(1)).toContainText(de.auth_recovery_recovery_code_label);
    await expect(recoveryCard.locator('label').nth(2)).toContainText(de.auth_recovery_display_name_label);
    await expect(recoveryCard.locator('label').nth(3)).toContainText(de.auth_recovery_new_password_label);
    await expect(recoveryCard.locator('button.link')).toHaveText(de.auth_recovery_back_link);
  });
});
