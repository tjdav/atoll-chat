import { test, expect } from '@playwright/test'

test.describe('Authentication flows', () => {

  test.beforeEach(async ({ page }) => {
    // Clear the specific atoll-user-preferences db so there's no cached session across tests
    await page.goto('/')
    await page.evaluate(async () => {
      return new Promise((resolve) => {
        const request = window.indexedDB.deleteDatabase('atoll-user-preferences')
        request.onsuccess = resolve
        request.onerror = resolve
      })
    })
  })

  test('Successful Login', async ({ page }) => {
    await page.goto('/')

    const loginCard = page.locator('.card').filter({ hasText: 'Login to Matrix' })
    await expect(loginCard).toBeVisible({ timeout: 10000 })

    // Fill the login form
    // The homeserver might be defaulted, but we ensure it points to the local test server
    await loginCard.getByPlaceholder('Homeserver URL').fill('http://localhost:6167')
    await loginCard.getByPlaceholder('Username').fill('alice')
    await loginCard.getByPlaceholder('Password').fill('password123')

    // Submit
    await loginCard.getByRole('button', { name: 'Login' }).click()

    // Verify successful login by checking for the main app view
    // (We expect atoll-app-layout to become visible or login to become hidden)
    // The sidebar inside the app layout
    const sidebar = page.locator('[ref="atoll-app-layout__layoutContainer-0"]')
    await expect(sidebar).toBeVisible({ timeout: 10000 })
  })

  test('Session persistence on reload', async ({ page }) => {
    await page.goto('/')

    const loginCard = page.locator('.card').filter({ hasText: 'Login to Matrix' })
    await expect(loginCard).toBeVisible({ timeout: 10000 })

    await loginCard.getByPlaceholder('Homeserver URL').fill('http://localhost:6167')
    await loginCard.getByPlaceholder('Username').fill('alice')
    await loginCard.getByPlaceholder('Password').fill('password123')

    // Wait for the first successful sync network response to ensure the session and Matrix client are fully initialized
    const syncPromise = page.waitForResponse(response => response.url().includes('/_matrix/client/v3/sync') && response.status() === 200, { timeout: 15000 })
    await loginCard.getByRole('button', { name: 'Login' }).click()
    await syncPromise

    // Verify successful login
    const sidebar = page.locator('[ref="atoll-app-layout__layoutContainer-0"]')
    await expect(sidebar).toBeVisible({ timeout: 10000 })

    // Await IndexedDB to physically flush the atoll_session key before we trigger a reload,
    // protecting against race conditions where the headless browser reloads before IndexedDB's
    // internal tx.oncomplete fires inside the matrix.js plugin.
    await expect.poll(async () => {
      return await page.evaluate(async () => {
        return new Promise((resolve) => {
          const request = window.indexedDB.open('atoll-user-preferences')
          request.onsuccess = (event) => {
            const db = event.target.result
            if (!db.objectStoreNames.contains('preferences')) {
              db.close()
              resolve(false)
              return
            }
            const tx = db.transaction('preferences', 'readonly')
            const store = tx.objectStore('preferences')

            tx.oncomplete = () => db.close()
            tx.onerror = () => db.close()

            const getReq = store.get('atoll_session')
            getReq.onsuccess = () => {
              resolve(!!getReq.result)
            }
            getReq.onerror = () => resolve(false)
          }
          request.onerror = () => resolve(false)
        })
      })
    }, { timeout: 15000 }).toBeTruthy()

    // Setup listener for the sync endpoint after reload to verify Matrix connects
    const reloadSyncPromise = page.waitForResponse(response => response.url().includes('/_matrix/client/v3/sync') && response.status() === 200, { timeout: 15000 })

    // Reload the page
    await page.reload()

    // Await the sync response explicitly so we know the network connection succeeded
    await reloadSyncPromise

    // Verify we remain logged in by explicitly asserting the sidebar becomes visible.
    const reloadedSidebar = page.locator('[ref="atoll-app-layout__layoutContainer-0"]')
    await expect(reloadedSidebar).toBeVisible({ timeout: 15000 })
  })

  test('Failed Login', async ({ page }) => {
    await page.goto('/')

    const loginCard = page.locator('.card').filter({ hasText: 'Login to Matrix' })
    await expect(loginCard).toBeVisible({ timeout: 10000 })

    await loginCard.getByPlaceholder('Homeserver URL').fill('http://localhost:6167')
    await loginCard.getByPlaceholder('Username').fill('nonexistentuser')
    await loginCard.getByPlaceholder('Password').fill('wrongpassword')

    await loginCard.getByRole('button', { name: 'Login' }).click()

    // Verify error message
    const errorAlert = loginCard.locator('.alert-danger')
    await expect(errorAlert).toBeVisible()
    await expect(errorAlert).toHaveText(/Login failed/i)
  })

  test('Switching between login and signup forms', async ({ page }) => {
    await page.goto('/')

    const loginCard = page.locator('.card').filter({ hasText: 'Login to Matrix' })
    const signupCard = page.locator('.card').filter({ hasText: 'Sign Up to Matrix' })

    await expect(loginCard).toBeVisible({ timeout: 10000 })
    await expect(signupCard).toBeHidden()

    // Switch to signup
    await loginCard.getByRole('link', { name: "Don't have an account? Sign up." }).click()

    await expect(signupCard).toBeVisible()
    await expect(loginCard).toBeHidden()

    // Switch back to login
    await signupCard.getByRole('link', { name: 'Already have an account? Log in.' }).click()

    await expect(loginCard).toBeVisible()
    await expect(signupCard).toBeHidden()
  })

  test('Successful Signup', async ({ page }) => {
    // Navigate with valid token
    await page.goto('/?token=ci_test_token_123')

    // Wait for page load
    const loginCard = page.locator('.card').filter({ hasText: 'Login to Matrix' })
    const signupCard = page.locator('.card').filter({ hasText: 'Sign Up to Matrix' })
    await expect(loginCard).toBeVisible({ timeout: 10000 })

    // Switch to signup form
    await loginCard.getByRole('link', { name: "Don't have an account? Sign up." }).click()

    // Fill signup form
    await signupCard.getByPlaceholder('Homeserver URL').fill('http://localhost:6167')
    const newUsername = 'newuser_' + Date.now()
    await signupCard.getByPlaceholder('Username').fill(newUsername)
    await signupCard.getByPlaceholder('Password', { exact: true }).fill('newpassword123')
    await signupCard.getByPlaceholder('Confirm Password').fill('newpassword123')

    // Submit
    await signupCard.getByRole('button', { name: 'Sign Up' }).click()

    // Verify successful registration by checking the main app view appears
    // The sidebar inside the app layout
    const sidebar = page.locator('[ref="atoll-app-layout__layoutContainer-0"]')
    await expect(sidebar).toBeVisible({ timeout: 15000 })
  })

  test('Failed Signup (Password Mismatch)', async ({ page }) => {
    await page.goto('/?token=ci_test_token_123')

    const loginCard = page.locator('.card').filter({ hasText: 'Login to Matrix' })
    const signupCard = page.locator('.card').filter({ hasText: 'Sign Up to Matrix' })

    await expect(loginCard).toBeVisible({ timeout: 10000 })

    // Switch to signup form
    await loginCard.getByRole('link', { name: "Don't have an account? Sign up." }).click()

    await signupCard.getByPlaceholder('Homeserver URL').fill('http://localhost:6167')
    await signupCard.getByPlaceholder('Username').fill('testuser_mismatch')
    await signupCard.getByPlaceholder('Password', { exact: true }).fill('password123')
    await signupCard.getByPlaceholder('Confirm Password').fill('differentpassword')

    await signupCard.getByRole('button', { name: 'Sign Up' }).click()

    // Verify error message
    const errorAlert = signupCard.locator('.alert-danger')
    await expect(errorAlert).toBeVisible()
    await expect(errorAlert).toHaveText(/Passwords do not match/i)
  })

  test('Failed Signup (Invalid Token)', async ({ page }) => {
    // Attempting signup with no token or an invalid one should fail at the server level
    await page.goto('/?token=invalid_token_xyz')

    const loginCard = page.locator('.card').filter({ hasText: 'Login to Matrix' })
    const signupCard = page.locator('.card').filter({ hasText: 'Sign Up to Matrix' })

    await expect(loginCard).toBeVisible({ timeout: 10000 })

    // Switch to signup form
    await loginCard.getByRole('link', { name: "Don't have an account? Sign up." }).click()

    await signupCard.getByPlaceholder('Homeserver URL').fill('http://localhost:6167')
    await signupCard.getByPlaceholder('Username').fill('testuser_invalid_token')
    await signupCard.getByPlaceholder('Password', { exact: true }).fill('password123')
    await signupCard.getByPlaceholder('Confirm Password').fill('password123')

    await signupCard.getByRole('button', { name: 'Sign Up' }).click()

    // Verify error message from the server indicating failure
    const errorAlert = signupCard.locator('.alert-danger')
    await expect(errorAlert).toBeVisible({ timeout: 10000 })
    await expect(errorAlert).toContainText(/Registration failed/i)
  })

})
