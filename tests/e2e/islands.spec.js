import { test, expect } from './fixtures/base-test.js'
import { mkdirSync } from 'fs'

test.describe('Multi-Island Architecture', () => {
  test.beforeEach(async ({ context }) => {
    /* Enable islands mode via init script override and ensure a completely clean local state */
    await context.addInitScript(() => {
      window.__coralite_workspaces_override__ = true
      localStorage.clear()
    })
  })

  test('should present first-time onboarding zero state, perform validation, and complete login into active Island', async ({ page }) => {
    await page.goto('/')

    /* Unregister any active service workers to prevent unexpected page reloads during E2E testing */
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        for (const reg of regs) {
          await reg.unregister()
        }
      }
    })

    await page.waitForFunction(() => window.__coralite__?.lifecycle?.hydrated)
    await page.waitForTimeout(500)

    /* Verify first-time onboarding Zero State welcome screen is shown */
    const urlInput = page.locator('[data-testid$="islandUrlInput"]')
    const btnConnect = page.locator('[data-testid$="btnConnect"]')
    await expect(urlInput).toBeVisible()
    await expect(btnConnect).toBeVisible()
    await page.waitForTimeout(500)

    /* Try connecting with a non-responsive URL to test health check verification */
    await urlInput.fill('http://127.0.0.1:9999')
    await page.waitForTimeout(500)
    await btnConnect.click()
    await page.waitForTimeout(500)

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

    /* Complete standard magic link OTP login flow */
    await emailField.fill('alice@example.com')
    await page.waitForTimeout(500)
    await btnSendOtp.click()
    await page.waitForTimeout(1000)

    /* Wait for OTP view to be active */
    const otpCodeField = page.locator('input[name="otpCode"]')
    await expect(otpCodeField).toBeVisible()
    await page.waitForTimeout(500)

    /* Retrieve mock server's generated OTP */
    const tId = await page.evaluate(() => window.__playwright_test_id__)
    const otpResponse = await page.request.get('http://localhost:8090/api/last-otp', {
      headers: { 'x-test-id': tId }
    })
    const { code } = await otpResponse.json()

    /* Enter code and submit */
    await otpCodeField.fill(code)
    await page.waitForTimeout(500)
    await page.locator('button:has-text("Verify")').click()
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
    await page.waitForTimeout(500)

    /* Verify the dropdown menu and the active Island is listed */
    const dropdownMenu = page.locator('[data-testid$="profileDropdownMenu"]')
    await expect(dropdownMenu).toBeVisible()

    const islandsList = page.locator('[data-testid$="islandsList"]')
    await expect(islandsList).toBeVisible()

    const firstIslandBtn = islandsList.locator('[data-testid^="workspace-btn-ws_"]')
    await expect(firstIslandBtn).toBeVisible()
    await expect(firstIslandBtn).toContainText('LO')
    await page.waitForTimeout(500)

    /* Verify database is correctly namespaced under IndexedDB */
    const dbName = await page.evaluate(() => window.$localDb.name)
    expect(dbName).toContain('AtollChatDB_ws_')
    await page.waitForTimeout(500)

    /* Verify the "Chart New Island" flow */
    const btnChartNewIsland = page.locator('[data-testid$="btnChartNewIsland"]')
    await expect(btnChartNewIsland).toBeVisible()
    await btnChartNewIsland.click()
    await page.waitForTimeout(500)

    const modal = page.locator('[data-testid$="chartIslandModal"]')
    await expect(modal).toBeVisible()
    await page.waitForTimeout(500)

    /* Connect another Island using same valid server URL but different host query to simulate another realm */
    await page.locator('[data-testid$="islandUrlField"]').fill('http://127.0.0.1:8090')
    await page.waitForTimeout(500)
    await page.locator('[data-testid$="btnVerifyIsland"]').click()
    await page.waitForTimeout(1500)

    /* Click profile button again to open the dropup list */
    await profileBtn.click()
    await page.waitForTimeout(500)

    /* Dropdown list should now contain 2 Islands */
    const islandButtons = islandsList.locator('[data-testid^="workspace-btn-ws_"]')
    await expect(islandButtons).toHaveCount(2)
    await page.waitForTimeout(500)

    /* Save screenshot for frontend verification */
    try {
      mkdirSync('/home/jules/verification/screenshots', { recursive: true })
      await page.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })
      console.log('Saved verification screenshot to /home/jules/verification/screenshots/verification.png')
    } catch (err) {
      console.error('Failed to save screenshot:', err)
    }
  })
})
