import { test, expect } from './fixtures/base-test.js'
import { join } from 'path'
import { copyFileSync, mkdirSync } from 'fs'

test.describe('Multi-Workspace Architecture', () => {
  test.beforeEach(async ({ context }) => {
    /* Enable workspaces mode via init script override and ensure a completely clean local state */
    await context.addInitScript(() => {
      window.__coralite_workspaces_override__ = true
      localStorage.clear()
    })
  })

  test('should present first-time onboarding zero state, perform validation, and complete login into active workspace', async ({ page }) => {
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
    const urlInput = page.locator('[data-testid$="workspaceUrlInput"]')
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

    /* Standard application layout with leftmost Workspace Switcher is now visible */
    const switcher = page.locator('[data-testid$="workspaceSwitcher"]')
    const switcherList = page.locator('[data-testid$="workspaceList"]')
    await expect(switcher).toBeVisible()
    await expect(switcherList).toBeVisible()
    await page.waitForTimeout(500)

    /* Active workspace list button should display the derived initials from hostname */
    const firstWorkspaceBtn = page.locator('.workspace-btn')
    await expect(firstWorkspaceBtn).toBeVisible()
    await expect(firstWorkspaceBtn).toHaveText('LO')
    await page.waitForTimeout(500)

    /* Verify database is correctly namespaced under IndexedDB */
    const dbName = await page.evaluate(() => window.$localDb.name)
    expect(dbName).toContain('AtollChatDB_ws_')
    await page.waitForTimeout(500)

    /* Verify the "Add Workspace" flow */
    await page.locator('[data-testid$="btnAddWorkspace"]').click()
    const modal = page.locator('[data-testid$="addWorkspaceModal"]')
    await expect(modal).toBeVisible()
    await page.waitForTimeout(500)

    /* Connect another workspace using same valid server URL but different host query to simulate another realm */
    await page.locator('[data-testid$="workspaceUrlField"]').fill('http://127.0.0.1:8090')
    await page.waitForTimeout(500)
    await page.locator('[data-testid$="btnVerifyWorkspace"]').click()
    await page.waitForTimeout(1500)

    /* Switcher list should now contain 2 workspaces */
    await expect(page.locator('.workspace-btn')).toHaveCount(2)
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
