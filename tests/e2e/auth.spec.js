import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('Toggle Views between Login and Signup', async ({ page }) => {
    await page.goto('/')

    // Verify Login is visible by default
    await expect(page.getByRole('heading', { name: 'Login to Matrix' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign Up to Matrix' })).toBeHidden()

    // Click "Sign up" toggle
    await page.getByRole('link', { name: "Don't have an account? Sign up." }).click()

    // Verify Signup is visible, Login is hidden
    await expect(page.getByRole('heading', { name: 'Sign Up to Matrix' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Login to Matrix' })).toBeHidden()

    // Click "Log in" toggle
    await page.getByRole('link', { name: 'Already have an account? Log in.' }).click()

    // Verify Login is visible again
    await expect(page.getByRole('heading', { name: 'Login to Matrix' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign Up to Matrix' })).toBeHidden()
  })

  test('Validation: Mismatched passwords prevent signup', async ({ page }) => {
    await page.goto('/')

    // Switch to signup view
    await page.getByRole('link', { name: "Don't have an account? Sign up." }).click()

    // We must ensure the element is visible because the DOM has two inputs named Username
    const signupForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Sign Up' }) })

    // Fill the form with mismatched passwords
    await signupForm.getByLabel('Homeserver URL').fill('http://localhost:6167')
    await signupForm.getByLabel('Username').fill('testuser')
    await signupForm.getByLabel('Password', { exact: true }).fill('password123')
    await signupForm.getByLabel('Confirm Password').fill('password456')

    // Click Sign Up button
    await signupForm.getByRole('button', { name: 'Sign Up' }).click()

    // Verify error alert appears
    const alert = page.locator('.alert-danger').filter({ hasText: 'Passwords do not match' })
    await expect(alert).toBeVisible()
  })

  test('E2E Signup/Login Flow', async ({ page }) => {
    await page.goto('/')

    // Use Alice's credentials created in global setup for login flow
    // Alternatively, we could test signup flow here, but we don't want to create
    // a new user every single test run without cleaning up if we can help it,

    // Switch to login view (default)
    const loginForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Login' }) })

    await loginForm.getByLabel('Homeserver URL').fill('http://localhost:6167')
    await loginForm.getByLabel('Username').fill('alice')
    await loginForm.getByLabel('Password').fill('password123')

    // Click Log In button
    await loginForm.getByRole('button', { name: 'Login' }).click()

    // Verify transition to app layout
    // Instead of atoll-app-layout which is removed, check for a visible heading/sidebar
    await expect(page.getByRole('link', { name: 'Chats' })).toBeVisible({ timeout: 10000 })
  })
})
