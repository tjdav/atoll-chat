import { test, expect } from './fixtures/base-test.js'

test.describe('ALTCHA Security Challenge and Global Error UI Verification', () => {
  test('should display ALTCHA validation error inside ALTCHA widget and allow submit on registration form', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })

    // Navigate to registration page
    await page.locator('[data-testid$="linkRegister"]').click()
    await expect(page.locator('auth-register')).toBeVisible()

    // Fill registration info with dynamic unique username
    const testUsername = `altcha_user_${Date.now()}`
    await page.locator('auth-register input[name="username"]').fill(testUsername)
    await page.locator('auth-register [data-testid$="invitationCode"]').fill('INV-SEED-1111')
    await page.locator('auth-register input[name="password"]').fill('Password123!')
    await page.locator('auth-register input[name="passwordConfirm"]').fill('Password123!')

    // Dispatch error statechange on altcha-widget to test error handling
    await page.evaluate(() => {
      const widget = document.querySelector('auth-register altcha-widget')
      if (widget) {
        widget.dispatchEvent(new CustomEvent('statechange', { detail: { state: 'error' } }))
      }
    })

    // Verify error status banner is displayed
    await expect(page.locator('auth-register [data-testid$="statusMsg"]')).toContainText('Security challenge failed')

    // Ensure the username input does NOT have custom validity set
    const usernameValidity = await page.locator('auth-register input[name="username"]').evaluate((el) => el.validationMessage)
    expect(usernameValidity).toBe('')

    // Dispatch verified statechange to proceed
    await page.evaluate(() => {
      const widget = document.querySelector('auth-register altcha-widget')
      if (widget) {
        widget.value = 'atoll-mock-bypass-token'
        widget.dispatchEvent(new CustomEvent('verified', {
          detail: { payload: 'atoll-mock-bypass-token' }
        }))
        widget.dispatchEvent(new CustomEvent('statechange', {
          detail: {
            state: 'verified',
            payload: 'atoll-mock-bypass-token'
          }
        }))
      }
    })

    // Clicking submit again now that ALTCHA is verified should proceed successfully
    await page.locator('[data-testid$="registerSubmit"]').click()

    // Confirm and dismiss Recovery Code Modal first
    await expect(page.locator('auth-register [ref$="__recoveryModal"]')).toBeVisible({ timeout: 15000 })
    await page.locator('auth-register [data-testid$="chkStored"]').check()
    await page.locator('auth-register [data-testid$="btnContinueToChat"]').click()

    // Registration should succeed and transition directly to app-layout
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 15000 })
  })

  test('should display ALTCHA validation error inside ALTCHA widget and allow submit on login form', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })

    // Fill in valid login credentials
    await page.locator('auth-login [data-testid$="username"]').fill('alice')
    await page.locator('auth-login [data-testid$="password"]').fill('Password123!')

    // Dispatch error statechange on altcha-widget to test error state handling
    await page.evaluate(() => {
      const widget = document.querySelector('auth-login altcha-widget')
      if (widget) {
        widget.dispatchEvent(new CustomEvent('statechange', { detail: { state: 'error' } }))
      }
    })

    // Verify error status banner is displayed
    await expect(page.locator('auth-login [data-testid$="statusMsg"]')).toContainText('Security challenge failed')

    // Ensure the username input does NOT have custom validity set
    const emailValidity = await page.locator('auth-login [data-testid$="username"]').evaluate((el) => el.validationMessage)
    expect(emailValidity).toBe('')

    // Dispatch verified statechange to proceed successfully
    await page.evaluate(() => {
      const widget = document.querySelector('auth-login altcha-widget')
      if (widget) {
        widget.dispatchEvent(new CustomEvent('statechange', {
          detail: {
            state: 'verified',
            payload: 'atoll-mock-bypass-token'
          }
        }))
      }
    })

    // Submit login again
    await page.locator('[data-testid$="loginSubmit"]').click()

    // Wait for app-layout step to be reached upon successful single-step login
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 15000 })
  })



  test('should display invalid-feedback when entering a password too short on registration form', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })

    // Navigate to registration page
    await page.locator('[data-testid$="linkRegister"]').click()
    await expect(page.locator('auth-register')).toBeVisible()

    // Fill short password (5 chars)
    await page.locator('auth-register input[name="username"]').fill('shortpassuser')
    await page.locator('auth-register [data-testid$="invitationCode"]').fill('INV-SEED-1111')
    await page.locator('auth-register input[name="password"]').fill('12345')
    await page.locator('auth-register input[name="passwordConfirm"]').fill('12345')

    // Submit form
    await page.locator('[data-testid$="registerSubmit"]').click()

    // Password feedback should be visible and contain character count message
    const feedback = page.locator('auth-register [data-testid$="password-feedback"]')
    await expect(feedback).toBeVisible()
    await expect(feedback).toContainText('8 characters')
  })
})
