import { test, expect } from './fixtures/base-test.js'

test.describe('Zero-Knowledge Security and Cryptographic Architectures', () => {
  /* Set longer timeout because vault crypto derivations can be slow */
  test.setTimeout(90000)

  /* WebAuthn simulation setup for passkeys */
  test.beforeEach(async ({ page }) => {
    try {
      const session = await page.context().newCDPSession(page)
      await session.send('WebAuthn.enable')
      await session.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          extensions: ['prf']
        }
      })
    } catch (e) {
      console.warn('WebAuthn CDP session failed (might be non-chromium browser):', e.message)
    }
  })

  /**
   * Retrieves the current TOTP code for a secret in the Node.js context using otplib.
   *
   * @param {object} page - Playwright page.
   * @param {string} secret - Base32 secret key.
   * @returns {Promise<string>} Correct TOTP code.
   */
  async function getTotpCode (page, secret) {
    const otplib = await import('otplib')
    return await otplib.generate({
      secret,
      crypto: new otplib.NobleCryptoPlugin(),
      base32: new otplib.ScureBase32Plugin()
    })
  }

  test('should handle registration, vault onboarding, copy/download proceed-lock, and login', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })

    /* Test registration input email validation */
    await page.locator('[data-testid$="linkRegister"]').click()
    await expect(page.locator('auth-register')).toBeVisible()

    /* Try to submit with blank or invalid email first */
    await page.locator('auth-register input[name="username"]').fill('testuser')
    await page.locator('auth-register input[name="email"]').fill('invalid-email')

    /* Submit should fail due to email type validation */
    const emailInput = page.locator('auth-register input[name="email"]')
    const isInvalid = await emailInput.evaluate((el) => {
      return !el.checkValidity()
    })
    expect(isInvalid).toBe(true)

    /* Fill in valid registration details */
    await page.locator('auth-register input[name="email"]').fill('testuser@example.com')
    await page.locator('[data-testid$="registerSubmit"]').click()

    /* Wait for the manual OTP input to become visible */
    await page.locator('auth-register input[name="otpCode"]').waitFor({ state: 'visible' })

    /* Retrieve manual 8-digit OTP from mock server */
    const otpRes = await page.evaluate(async () => {
      const tId = window.__playwright_test_id__
      const response = await fetch('http://127.0.0.1:8090/api/last-otp', {
        headers: { 'x-test-id': tId }
      })
      return response.json()
    })

    await page.locator('auth-register input[name="otpCode"]').fill(otpRes.code)
    await page.locator('auth-register button:has-text("Verify & Log In")').click()

    /* Wait for Vault Setup screen to appear */
    await expect(page.locator('vault-setup')).toBeVisible()

    /* Configure Vault Password */
    await page.locator('vault-setup input[name="password"]').fill('VaultPassword123!')
    await page.locator('vault-setup input[name="passwordConfirm"]').fill('VaultPassword123!')
    await page.locator('vault-setup button:has-text("Generate Vault Keys")').click()

    /* Arrive at Step 2 of Vault Setup (Recovery Codes) */
    const proceedBtn = page.locator('[data-testid$="vaultSetupProceed"]')
    await expect(proceedBtn).toBeDisabled()

    /* Click Copy button to simulate copying the recovery codes */
    await page.locator('vault-setup button:has-text("Copy to Clipboard")').click()

    /* Assert that Proceed button is now strictly enabled */
    await expect(proceedBtn).toBeEnabled()

    /* Click Proceed and verify successful navigation to dashboard layout */
    await proceedBtn.click()
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })
  })

  test('should handle login email format validation', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })

    const emailInput = page.locator('[data-testid$="username"]')
    await emailInput.fill('invalidemail')

    const isInvalid = await emailInput.evaluate((el) => {
      return !el.checkValidity()
    })
    expect(isInvalid).toBe(true)
  })

  test('should perform passwordless login, OTP verification, and password-rotation self-recovery', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })

    /* Passwordless Login Flow */
    await page.locator('[data-testid$="username"]').fill('alice@example.com')
    await page.locator('[data-testid$="loginSubmit"]').click()

    await page.locator('input[name="otpCode"]').waitFor({ state: 'visible' })
    let otpRes = await page.evaluate(async () => {
      const tId = window.__playwright_test_id__
      const response = await fetch('http://127.0.0.1:8090/api/last-otp', {
        headers: { 'x-test-id': tId }
      })
      return response.json()
    })
    await page.locator('input[name="otpCode"]').fill(otpRes.code)
    await page.locator('button:has-text("Verify")').click()

    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

    /* Initiate Self-Recovery Flow using a single-use Recovery Code */
    await page.locator('button:has-text("Use Recovery Code")').click()
    await expect(page.locator(':is(h3):has-text("Use Recovery Code")')).toBeVisible()

    /* Verify invalid code shows error message */
    await page.locator('input[name="recoveryCodeInput"]').fill('1111-2222-3333')
    await page.locator('vault-unlock button:has-text("Verify Recovery Code")').click()
    await expect(page.locator('[data-testid$="__statusMsg"]')).toContainText('Invalid or expired recovery code')

    /* Retrieve Alice's actual plaintext recovery codes from mock server */
    const codesRes = await page.evaluate(async () => {
      const tId = window.__playwright_test_id__
      const response = await fetch('http://127.0.0.1:8090/api/test-recovery-codes?username=alice', {
        headers: { 'x-test-id': tId }
      })
      return response.json()
    })
    const aliceCodes = codesRes.codes
    expect(aliceCodes.length).toBe(10)

    const testRecoveryCode = aliceCodes[0]

    /* Fill actual recovery code */
    await page.locator('input[name="recoveryCodeInput"]').fill(testRecoveryCode)
    await page.locator('vault-unlock button:has-text("Verify Recovery Code")').click()

    /* Expect password rotation prompt */
    await expect(page.locator(':is(h3):has-text("Set New Vault Password")')).toBeVisible()

    /* Fill new password */
    await page.locator('input[name="newPassword"]').fill('NewVaultPassword123!')
    await page.locator('input[name="newPasswordConfirm"]').fill('NewVaultPassword123!')
    await page.locator('button:has-text("Save & Unlock Vault")').click()

    /* Arrive successfully inside app dashboard */
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    /* LOG OUT and test if new password works and old password fails */
    await page.locator('[data-testid$="btnLogout"]').click()
    await expect(page.locator('auth-login')).toBeVisible()

    /* Log in with Magic Link / OTP */
    await page.locator('[data-testid$="username"]').fill('alice@example.com')
    await page.locator('[data-testid$="loginSubmit"]').click()
    await page.locator('input[name="otpCode"]').waitFor({ state: 'visible' })

    otpRes = await page.evaluate(async () => {
      const tId = window.__playwright_test_id__
      const response = await fetch('http://127.0.0.1:8090/api/last-otp', {
        headers: { 'x-test-id': tId }
      })
      return response.json()
    })
    await page.locator('input[name="otpCode"]').fill(otpRes.code)
    await page.locator('button:has-text("Verify")').click()

    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

    /* Try old password and expect unlock failure */
    await page.locator('[data-testid$="password"]').fill('VaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()

    await expect(page.locator('[data-testid$="__statusMsg"]')).toContainText(
      /wrong secret key|Invalid Password|Unlock failed/
    )

    /* Try new password and expect unlock success */
    await page.locator('[data-testid$="password"]').fill('NewVaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    /* LOG OUT and verify that the used recovery code is permanently burned */
    await page.locator('[data-testid$="btnLogout"]').click()
    await expect(page.locator('auth-login')).toBeVisible()

    /* Log in with Magic Link / OTP */
    await page.locator('[data-testid$="username"]').fill('alice@example.com')
    await page.locator('[data-testid$="loginSubmit"]').click()
    await page.locator('input[name="otpCode"]').waitFor({ state: 'visible' })

    otpRes = await page.evaluate(async () => {
      const tId = window.__playwright_test_id__
      const response = await fetch('http://127.0.0.1:8090/api/last-otp', {
        headers: { 'x-test-id': tId }
      })
      return response.json()
    })
    await page.locator('input[name="otpCode"]').fill(otpRes.code)
    await page.locator('button:has-text("Verify")').click()

    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

    /* Attempt recovery with the same used recovery code */
    await page.locator('button:has-text("Use Recovery Code")').click()
    await page.locator('input[name="recoveryCodeInput"]').fill(testRecoveryCode)
    await page.locator('vault-unlock button:has-text("Verify Recovery Code")').click()

    /* Verify rejection */
    await expect(page.locator('[data-testid$="__statusMsg"]')).toContainText('Invalid or expired recovery code')
  })

  test('should handle TOTP dual modal setup, device trust state machine, and step-up verification', async ({ page, loginApp }) => {
    /* Perform login for Alice */
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    /* Open profile settings modal */
    await page.locator('[data-testid$="__btnSettings"]').click()

    /* Trigger 2FA setup */
    await page.locator('[data-testid$="__btnManageTotp"]').click()

    /* Retrieve secret from modal text content */
    await page.locator('[data-testid$="__secretText"]').waitFor({ state: 'visible' })
    const secret = await page.locator('[data-testid$="__secretText"]').textContent()
    expect(secret).toBeTruthy()

    /* Generate and input current TOTP code */
    const totpCode = await getTotpCode(page, secret)
    await page.locator('[data-testid$="__otpInput"]').fill(totpCode)
    await page.locator('[data-testid$="__btnVerifyEnable"]').click()

    /* Confirm enrollment success toast and button text update */
    await expect(page.locator('.toast-body')).toContainText('Two-Step Authentication enabled successfully!')
    await expect(page.locator('[data-testid$="__btnManageTotp"]')).toContainText('Disable 2FA')

    /* Mock WebAuthn credentials API for passkey step-up registration */
    await page.evaluate(() => {
      navigator.credentials.create = async () => {
        return {
          rawId: new Uint8Array([1, 2, 3, 4]).buffer,
          getClientExtensionResults: () => ({
            prf: {
              enabled: true,
              results: {
                first: new Uint8Array(32).buffer
              }
            }
          })
        }
      }
    })

    /* TEST STEP-UP SECURITY WITH SENSITIVE ACTIONS */
    await page.locator('[data-testid$="__btnManagePasskey"]').click()

    /* Step-up modal is immediately mounted and halts UI. Verify TOTP step-up section is visible and required */
    const totpStepUpInput = page.locator('[data-testid$="__totpStepUpInput"]')
    await expect(totpStepUpInput).toBeVisible()
    const isTotpRequired = await totpStepUpInput.evaluate((el) => {
      return el.hasAttribute('required')
    })
    expect(isTotpRequired).toBe(true)

    /* Input Vault Password and an invalid TOTP code */
    await page.locator('[data-testid$="__vaultPasswordInput"]').fill('VaultPassword123!')
    await totpStepUpInput.fill('000000')
    await page.locator('[data-testid$="__btnVerifyPassword"]').click()
    await expect(page.locator('[data-testid$="__verifyError"]')).toContainText('Invalid 2-step verification code.')

    /* Input Vault Password and valid TOTP code */
    const freshStepUpCode = await getTotpCode(page, secret)
    await totpStepUpInput.fill(freshStepUpCode)
    await page.locator('[data-testid$="__btnVerifyPassword"]').click()

    /* Confirm passkey addition succeeded */
    await expect(page.locator('.toast-body')).toContainText('Passkey successfully added!')

    /* TEST DEVICE TRUST STATE MACHINE (UNTRUSTED VS TRUSTED) */
    await page.locator('[data-testid$="btnLogout"]').click()
    await expect(page.locator('auth-login')).toBeVisible()

    /* UNTRUSTED STATE: Clear local storage completely to simulate unrecognized device */
    await page.evaluate(() => {
      return localStorage.clear()
    })

    /* Log in with Magic Link / OTP */
    await page.locator('[data-testid$="username"]').fill('alice@example.com')
    await page.locator('[data-testid$="loginSubmit"]').click()
    await page.locator('input[name="otpCode"]').waitFor({ state: 'visible' })

    let otpRes = await page.evaluate(async () => {
      const tId = window.__playwright_test_id__
      const response = await fetch('http://127.0.0.1:8090/api/last-otp', {
        headers: { 'x-test-id': tId }
      })
      return response.json()
    })
    await page.locator('input[name="otpCode"]').fill(otpRes.code)
    await page.locator('button:has-text("Verify")').click()

    /* Assert that unrecognized device halts flow and mounts the TOTP challenge modal */
    await expect(page.locator('totp-challenge')).toBeVisible()

    /* Enter invalid TOTP code */
    await page.locator('[data-testid$="totpChallengeInput"]').fill('000000')
    await page.locator('[data-testid$="totpChallengeSubmit"]').click()
    await expect(page.locator('[data-testid$="__statusMsg"]')).toContainText('Invalid verification code.')

    /* Enter valid TOTP code */
    const challengeCode = await getTotpCode(page, secret)
    await page.locator('[data-testid$="totpChallengeInput"]').fill(challengeCode)
    await page.locator('[data-testid$="totpChallengeSubmit"]').click()

    /* Recognized device: direct prompt to Unlock Vault is visible now */
    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

    /* Unlock the vault */
    await page.locator('[data-testid$="password"]').fill('VaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    /* TRUSTED STATE: Log out normally (keep the trust token in local storage) */
    await page.locator('[data-testid$="btnLogout"]').click()
    await expect(page.locator('auth-login')).toBeVisible()

    /* Log back in with OTP */
    await page.locator('[data-testid$="username"]').fill('alice@example.com')
    await page.locator('[data-testid$="loginSubmit"]').click()
    await page.locator('input[name="otpCode"]').waitFor({ state: 'visible' })

    otpRes = await page.evaluate(async () => {
      const tId = window.__playwright_test_id__
      const response = await fetch('http://127.0.0.1:8090/api/last-otp', {
        headers: { 'x-test-id': tId }
      })
      return response.json()
    })
    await page.locator('input[name="otpCode"]').fill(otpRes.code)
    await page.locator('button:has-text("Verify")').click()

    /* Assert that recognized device completely bypasses TOTP challenge and goes straight to vault unlock */
    await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()
    await expect(page.locator('totp-challenge')).not.toBeVisible()

    /* Unlock vault to disable TOTP */
    await page.locator('[data-testid$="password"]').fill('VaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()
    await expect(page.locator('app-layout')).toBeVisible()

    /* DISABLE TOTP */
    await page.locator('[data-testid$="__btnSettings"]').click()
    await page.locator('[data-testid$="__btnManageTotp"]').click()

    /* Fill valid TOTP to disable */
    const disableCode = await getTotpCode(page, secret)
    await page.locator('[data-testid$="__disableOtpInput"]').fill(disableCode)
    await page.locator('[data-testid$="__btnVerifyDisable"]').click()

    /* Toast confirmation */
    await expect(page.locator('.toast-body')).toContainText('Two-Step Authentication disabled successfully.')
  })
})
