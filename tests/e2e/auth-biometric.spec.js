import { test, expect } from './fixtures/base-test.js'

test.describe('Biometric Login on Login Page', () => {
  test('should show fingerprint biometric login option on login page when enrolled and logged out', async ({ page, loginApp }) => {
    // Mock PublicKeyCredential to make biometric.isAvailable() return true
    await page.addInitScript(() => {
      window.PublicKeyCredential = function () {
      }
    })

    // Log in alice first to set up the authenticated session
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // Populate localStorage with the enrolled biometric user and credentials
    await page.evaluate(() => {
      localStorage.setItem('atoll_biometric_users', JSON.stringify([
        {
          id: 'uid-alice',
          username: 'alice',
          avatar: ''
        }
      ]))
      localStorage.setItem('atoll_biometric_credentials_uid-alice', JSON.stringify({
        ciphertext: 'Ym9ndXM=',
        nonce: 'Ym9ndXM='
      }))
    })

    // Log out to return to the login page and trigger the fresh auth-login component
    await page.locator('[data-testid$="profileBtn"]').click()
    await page.locator('[data-testid$="btnLogout"]').click()

    // Verify we are back on the login page
    await expect(page.locator('auth-login')).toBeVisible()

    // Verify the biometric header/separator is visible using suffix matching
    const bioSection = page.locator('[data-testid$="biometricSection"]')
    await expect(bioSection).toBeVisible({ timeout: 15000 })

    // Verify the "Log in as @alice" button is visible
    const bioBtn = page.locator('[data-testid="biometric-login-alice"]')
    await expect(bioBtn).toBeVisible({ timeout: 15000 })

    // Take screenshot for visual verification
    await page.screenshot({ path: 'tests/e2e/screenshots/biometric-login.png' })
  })
})
