import { test, expect } from './fixtures/base-test.js'

test.describe('Multi-Island Architecture', () => {
  test('should present first-time onboarding zero state, perform validation, and complete login into active Island', async ({ browser, baseURL }) => {
    const islandContext = await browser.newContext()
    const page = await islandContext.newPage()

    /* Enable spaces/islands mode dynamically for E2E tests using Coralite testing mocks contract */
    await page.addInitScript(() => {
      window.__coralite__ = window.__coralite__ || {}
      window.__coralite__.mocks = window.__coralite__.mocks || {}
      window.__coralite__.mocks.config = { enableWorkspaces: true }
    })
    await page.goto(baseURL || '/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    /* Island onboarding zero state should be displayed */
    const onboarding = page.locator('island-onboarding')
    await expect(onboarding).toBeVisible()

    const urlInput = page.locator('[data-testid$="islandUrlInput"]')
    const btnConnect = page.locator('[data-testid$="btnConnect"]')
    await expect(urlInput).toBeVisible()
    await expect(btnConnect).toBeVisible()

    /* Try submitting with invalid or offline URL first */
    await urlInput.fill('http://localhost:8000')
    await page.waitForTimeout(500)
    await btnConnect.click()
    await page.waitForTimeout(1000)

    /* Error feedback should be displayed */
    const onboardingError = page.locator('[data-testid$="onboardingError"]')
    await expect(onboardingError).toContainText('Failed to connect')
    await page.waitForTimeout(500)

    /* Connect using standard active mock PB URL */
    await urlInput.fill('http://localhost:8090')
    await page.waitForTimeout(500)
    await btnConnect.click()
    await page.waitForTimeout(1000)

    /* Connection succeeds, transitions to login/auth view of the connected instance */
    const emailField = page.locator('[data-testid$="username"]')
    const btnSendOtp = page.locator('[data-testid$="loginSubmit"]')
    await expect(emailField).toBeVisible()
    await expect(btnSendOtp).toBeVisible()
    await page.waitForTimeout(500)

    /* Ensure nav-sidebar is completely hidden before authentication/decryption */
    const sidebarBeforeAuth = page.locator('[data-testid$="navSidebar"]')
    await expect(sidebarBeforeAuth).not.toBeVisible()

    /* Verify the unauthenticated island switcher is visible at the bottom of the card */
    const islandSelectBtn = page.locator('[data-testid$="islandSelectBtn"]')
    await expect(islandSelectBtn).toBeVisible()
    await expect(islandSelectBtn).toContainText('Current Island: localhost')

    /* Complete standard login flow */
    await emailField.fill('alice@example.com')
    await page.locator('auth-login [data-testid$="password"]').fill('Password123!')
    await page.waitForTimeout(500)
    await btnSendOtp.click()
    await page.waitForTimeout(1000)

    /* Wait for onboarding vault page setup or unlock */
    const passwordField = page.locator('[data-testid$="password"]')
    await expect(passwordField).toBeVisible()
    await page.waitForTimeout(500)
    await passwordField.fill('VaultPassword123!')
    await page.waitForTimeout(500)
    await page.locator('[data-testid$="unlockSubmit"]').click()
    await page.waitForTimeout(2000)

    /* Standard application layout with leftmost primary sidebar is now visible */
    const sidebar = page.locator('[data-testid$="navSidebar"]')
    await expect(sidebar).toBeVisible()
    await page.waitForTimeout(500)

    /* Click the Profile Avatar dropup trigger to open dropdown menu */
    const profileBtn = page.locator('[data-testid$="profileBtn"]')
    await expect(profileBtn).toBeVisible()
    await profileBtn.click()

    /* Verify 'Change Island' action is absent, and switcher actions reside inside dropup menu */
    const dropdownMenu = page.locator('[data-testid$="profileDropdownMenu"]')
    await expect(dropdownMenu).toBeVisible()
    const activeWorkspaceItem = page.locator('[data-testid^="workspace-btn-ws_"]')
    await expect(activeWorkspaceItem).toBeVisible()
    await expect(activeWorkspaceItem).toContainText('localhost')

    await page.evaluate(() => {
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch (e) {}
    })

    await islandContext.close()
  })
})
