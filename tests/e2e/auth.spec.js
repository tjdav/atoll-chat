import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('Toggle Views between Login and Signup', async ({ page }) => {
    await page.goto('/');

    // Verify Login is visible by default
    await expect(page.locator('coralite-login')).toBeVisible();
    await expect(page.locator('coralite-signup')).toBeHidden();

    // Click "Sign up" toggle
    await page.getByText('Sign up', { exact: false }).click();

    // Verify Signup is visible, Login is hidden
    await expect(page.locator('coralite-signup')).toBeVisible();
    await expect(page.locator('coralite-login')).toBeHidden();

    // Click "Log in" toggle
    await page.getByText('Log in', { exact: false }).click();

    // Verify Login is visible again
    await expect(page.locator('coralite-login')).toBeVisible();
    await expect(page.locator('coralite-signup')).toBeHidden();
  });

  test('Validation: Mismatched passwords prevent signup', async ({ page }) => {
    await page.goto('/');

    // Switch to signup view
    await page.getByText('Sign up', { exact: false }).click();

    // Fill the form with mismatched passwords
    await page.locator('coralite-signup').getByLabel('Username').fill('testuser');
    await page.locator('coralite-signup').getByLabel('Password', { exact: true }).fill('password123');
    await page.locator('coralite-signup').getByLabel('Confirm Password').fill('password456');

    // Click Sign Up button
    await page.locator('coralite-signup').getByRole('button', { name: 'Sign Up' }).click();

    // Verify error alert appears
    const alert = page.locator('.alert-danger');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Passwords do not match');
  });

  test('E2E Signup/Login Flow', async ({ page }) => {
    await page.goto('/');

    // Use Alice's credentials created in global setup for login flow
    // Alternatively, we could test signup flow here, but we don't want to create
    // a new user every single test run without cleaning up if we can help it,
    // although Dendrite is ephemeral.
    
    // Switch to login view (default)
    await page.locator('coralite-login').getByLabel('Username').fill('alice');
    await page.locator('coralite-login').getByLabel('Password').fill('password123');

    // Click Log In button
    await page.locator('coralite-login').getByRole('button', { name: 'Log In' }).click();

    // Verify transition to app layout
    await expect(page.locator('coralite-app-layout')).toBeVisible({ timeout: 10000 });
    
    // Specifically verify the d-none class is removed from the app layout container if it exists
    const appLayout = page.locator('coralite-app-layout');
    await expect(appLayout).not.toHaveClass(/d-none/);
  });
});
