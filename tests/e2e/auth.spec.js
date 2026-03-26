import { test, expect } from '@playwright/test'

test.describe('Authentication flows', () => {

  test('Successful Login', async ({ page }) => {
    await page.goto('/')

    // Wait until the username field is actually actionable (attached to DOM and able to receive input)
    const usernameInput = page.locator('input[placeholder="Username"]').first()
    await usernameInput.waitFor({
      state: 'attached',
      timeout: 10000
    })

    // Fill the login form
    // The homeserver might be defaulted, but we ensure it points to the local test server
    await page.locator('input[placeholder="Homeserver URL"]').first().fill('http://localhost:6167')
    await page.locator('input[placeholder="Username"]').first().fill('alice')
    await page.locator('input[placeholder="Password"]').first().fill('password123')

    // Submit
    await page.locator('button:has-text("Login")').first().click()

    // Verify successful login by checking for the main app view
    // (We expect atoll-app-layout to become visible or login to become hidden)
    const sidebar = page.locator('[ref="atoll-app-layout__layoutContainer-0"]') // The sidebar inside the app layout
    await expect(sidebar).toBeVisible({ timeout: 10000 })
  })

  test('Failed Login', async ({ page }) => {
    await page.goto('/')

    const usernameInput = page.locator('input[placeholder="Username"]').first()
    await usernameInput.waitFor({
      state: 'attached',
      timeout: 10000
    })

    await page.locator('input[placeholder="Homeserver URL"]').first().fill('http://localhost:6167')
    await page.locator('input[placeholder="Username"]').first().fill('nonexistentuser')
    await page.locator('input[placeholder="Password"]').first().fill('wrongpassword')

    await page.locator('button:has-text("Login")').first().click()

    // Verify error message
    const errorAlert = page.locator('.alert-danger').first()
    await expect(errorAlert).toBeVisible()
    await expect(errorAlert).toHaveText(/Login failed/i)
  })

  test('Switching between login and signup forms', async ({ page }) => {
    await page.goto('/')

    const loginHeader = page.locator('h2:has-text("Login to Matrix")')
    const signupHeader = page.locator('h2:has-text("Sign Up to Matrix")')

    await loginHeader.waitFor({
      state: 'attached',
      timeout: 10000
    })

    // Switch to signup
    await page.locator('a:has-text("Don\'t have an account? Sign up.")').click()

    await expect(signupHeader).toBeVisible()
    await expect(loginHeader).toBeHidden()

    // Switch back to login
    await page.locator('a:has-text("Already have an account? Log in.")').click()

    await expect(loginHeader).toBeVisible()
    await expect(signupHeader).toBeHidden()
  })

  test('Successful Signup', async ({ page }) => {
    // Navigate with valid token
    await page.goto('/?token=ci_test_token_123')

    // Wait for page load
    const loginHeader = page.locator('h2:has-text("Login to Matrix")')
    await loginHeader.waitFor({
      state: 'attached',
      timeout: 10000
    })

    // Switch to signup form
    await page.locator('a:has-text("Don\'t have an account? Sign up.")').click()

    // Fill signup form
    await page.locator('input[placeholder="Homeserver URL"]').last().fill('http://localhost:6167')
    const newUsername = 'newuser_' + Date.now()
    await page.locator('input[placeholder="Username"]').last().fill(newUsername)
    await page.locator('input[placeholder="Password"]').last().fill('newpassword123')
    await page.locator('input[placeholder="Confirm Password"]').last().fill('newpassword123')

    // Submit
    await page.locator('button:has-text("Sign Up")').last().click()

    // Verify successful registration by checking the main app view appears
    const sidebar = page.locator('[ref="atoll-app-layout__layoutContainer-0"]') // The sidebar inside the app layout
    await expect(sidebar).toBeVisible({ timeout: 15000 })
  })

  test('Failed Signup (Password Mismatch)', async ({ page }) => {
    await page.goto('/?token=ci_test_token_123')

    const loginHeader = page.locator('h2:has-text("Login to Matrix")')
    await loginHeader.waitFor({
      state: 'attached',
      timeout: 10000
    })

    // Switch to signup form
    await page.locator('a:has-text("Don\'t have an account? Sign up.")').click()

    await page.locator('input[placeholder="Homeserver URL"]').last().fill('http://localhost:6167')
    await page.locator('input[placeholder="Username"]').last().fill('testuser_mismatch')
    await page.locator('input[placeholder="Password"]').last().fill('password123')
    await page.locator('input[placeholder="Confirm Password"]').last().fill('differentpassword')

    await page.locator('button:has-text("Sign Up")').last().click()

    // Verify error message
    const errorAlert = page.locator('.alert-danger').last()
    await expect(errorAlert).toBeVisible()
    await expect(errorAlert).toHaveText(/Passwords do not match/i)
  })

  test('Failed Signup (Invalid Token)', async ({ page }) => {
    // Attempting signup with no token or an invalid one should fail at the server level
    await page.goto('/?token=invalid_token_xyz')

    const loginHeader = page.locator('h2:has-text("Login to Matrix")')
    await loginHeader.waitFor({
      state: 'attached',
      timeout: 10000
    })

    // Switch to signup form
    await page.locator('a:has-text("Don\'t have an account? Sign up.")').click()

    await page.locator('input[placeholder="Homeserver URL"]').last().fill('http://localhost:6167')
    await page.locator('input[placeholder="Username"]').last().fill('testuser_invalid_token')
    await page.locator('input[placeholder="Password"]').last().fill('password123')
    await page.locator('input[placeholder="Confirm Password"]').last().fill('password123')

    await page.locator('button:has-text("Sign Up")').last().click()

    // Verify error message from the server indicating failure
    const errorAlert = page.locator('.alert-danger').last()
    await expect(errorAlert).toBeVisible({ timeout: 10000 })
    await expect(errorAlert).toContainText(/Registration failed/i)
  })

})
