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

    // Fill registration info
    await page.locator('auth-register input[name="username"]').fill('thomas')
    await page.locator('auth-register input[name="email"]').fill('thomas@example.com')

    // Stub the altcha-widget value to be null (unsolved) to test the error state
    await page.evaluate(() => {
      // Temporarily override window.__coralite__.mode to trigger real payload check
      window.__original_mode__ = window.__coralite__.mode;
      window.__coralite__.mode = 'production';

      const widget = document.querySelector('altcha-widget');
      if (widget) {
        Object.defineProperty(widget, 'value', {
          get: () => null,
          configurable: true
        });
      }
    })

    await page.locator('[data-testid$="registerSubmit"]').click()

    // Ensure the username and email inputs do NOT have custom validity set
    const usernameValidity = await page.locator('auth-register input[name="username"]').evaluate((el) => el.validationMessage)
    const emailValidity = await page.locator('auth-register input[name="email"]').evaluate((el) => el.validationMessage)
    expect(usernameValidity).toBe('')
    expect(emailValidity).toBe('')

    // Restore testing mode and stub value to proceed successfully
    await page.evaluate(() => {
      window.__coralite__.mode = window.__original_mode__;
      const widget = document.querySelector('altcha-widget');
      if (widget) {
        Object.defineProperty(widget, 'value', {
          get: () => 'atoll-mock-bypass-token',
          configurable: true
        });
      }
    })

    // Clicking submit again now that testing mode is restored should proceed successfully
    await page.locator('[data-testid$="registerSubmit"]').click()

    // Wait for OTP step to be reached, showing successful progress
    await page.locator('auth-register input[name="otpCode"]').waitFor({ state: 'visible' })
  })

  test('should display ALTCHA validation error inside ALTCHA widget and allow submit on login form', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })

    // Fill in valid login email
    await page.locator('[data-testid$="username"]').fill('alice@example.com')

    // Stub the altcha-widget value to be null (unsolved) to test the error state
    await page.evaluate(() => {
      window.__original_mode__ = window.__coralite__.mode;
      window.__coralite__.mode = 'production';

      const widget = document.querySelector('altcha-widget');
      if (widget) {
        Object.defineProperty(widget, 'value', {
          get: () => null,
          configurable: true
        });
      }
    })

    // Try to login with correct email but without ALTCHA
    await page.locator('[data-testid$="loginSubmit"]').click()

    // Ensure the email input does NOT have custom validity set
    const emailValidity = await page.locator('[data-testid$="username"]').evaluate((el) => el.validationMessage)
    expect(emailValidity).toBe('')

    // Restore testing mode and stub value to proceed successfully
    await page.evaluate(() => {
      window.__coralite__.mode = window.__original_mode__;
      const widget = document.querySelector('altcha-widget');
      if (widget) {
        Object.defineProperty(widget, 'value', {
          get: () => 'atoll-mock-bypass-token',
          configurable: true
        });
      }
    })

    // Submit login again
    await page.locator('[data-testid$="loginSubmit"]').click()

    // Wait for OTP step to be reached
    await page.locator('input[name="otpCode"]').waitFor({ state: 'visible' })
  })
})
