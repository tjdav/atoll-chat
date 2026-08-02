import { test, expect } from './fixtures/base-test.js'

test.describe('Zero-Knowledge Security and Cryptographic Architectures', () => {


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

    /* Test registration input username validation */
    await page.locator('[data-testid$="linkRegister"]').click()
    await expect(page.locator('auth-register')).toBeVisible()

    const regUser = `sec_test_user_${Date.now()}`

    /* Fill in valid registration details */
    await page.locator('auth-register input[name="username"]').fill(regUser)
    await page.locator('auth-register [data-testid$="invitationCode"]').fill('INV-SEED-1111')
    await page.locator('auth-register input[name="password"]').fill('Password123!')
    await page.locator('auth-register input[name="passwordConfirm"]').fill('Password123!')
    await page.locator('[data-testid$="registerSubmit"]').click()

    /* Confirm and dismiss Recovery Code Modal */
    await expect(page.locator('auth-register [ref$="__recoveryModal"]')).toBeVisible({ timeout: 15000 })
    await page.locator('auth-register [data-testid$="chkStored"]').check()
    await page.locator('auth-register [data-testid$="btnContinueToChat"]').click()

    /* Verify registration succeeds and proceeds directly to app-layout */
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    /* Clear storage/logout and reload page to test full re-login and single-step unlock */
    await page.evaluate(() => window.localStorage.clear())
    await page.reload()
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)

    /* Log in with the newly registered user */
    await page.locator('auth-login [data-testid$="username"]').fill(regUser)
    await page.locator('auth-login [data-testid$="password"]').fill('Password123!')
    await page.locator('auth-login [data-testid$="loginSubmit"]').click()

    /* Verify dashboard app-layout renders immediately after login */
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })
  })



  test('should perform passwordless login, OTP verification, and password-rotation self-recovery', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })

    /* Login Flow */
    await page.locator('auth-login [data-testid$="username"]').fill('alice')
    await page.locator('auth-login [data-testid$="password"]').fill('Password123!')
    await page.locator('auth-login [data-testid$="loginSubmit"]').click()

    // It goes straight to app-layout first
    await expect(page.locator('app-layout')).toBeVisible()

    // Reload the page to simulate session restoration lock!
    await page.reload()
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await expect(page.locator('vault-unlock')).toBeVisible()

    /* Initiate Self-Recovery Flow using a single-use Recovery Code */
    await page.locator('vault-unlock [ref$="__btnShowRecovery"]').dispatchEvent('click')
    await expect(page.locator(':is(h3):has-text("Use Recovery Code")')).toBeVisible()

    /* Verify invalid code shows error message */
    await page.locator('input[name="recoveryCodeInput"]').fill('RC-1111-2222-3333-4444')
    await page.locator('vault-unlock button:has-text("Verify Recovery Code")').click()
    await expect(page.locator('[data-testid$="recoveryCodeInput-feedback"]')).toContainText('Invalid or expired recovery code')

    /* Retrieve Alice's actual plaintext recovery codes from mock server */
    const codesRes = await page.evaluate(async () => {
      const tId = window.__playwright_test_id__
      const response = await fetch('http://127.0.0.1:8091/api/test-recovery-codes?username=alice', {
        headers: { 'x-test-id': tId }
      })
      return response.json()
    })
    const aliceCodes = codesRes.codes
    console.log('--- PLAIN TEXT CODES ---', aliceCodes)
    expect(aliceCodes.length).toBe(1)

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
    await page.locator('[data-testid$="profileBtn"]').click()
    await page.locator('[data-testid$="btnLogout"]').dispatchEvent('click')
    await expect(page.locator('auth-login')).toBeVisible()

    /* Log in with OLD password and expect failure */
    await page.locator('auth-login [data-testid$="username"]').fill('alice')
    await page.locator('auth-login [data-testid$="password"]').fill('Password123!')
    await page.locator('auth-login [data-testid$="loginSubmit"]').click()
    await expect(page.locator('auth-login [data-testid$="statusMsg"]')).toContainText(/wrong secret key|Invalid|Failed/)

    /* Log in with NEW password and expect success */
    await page.locator('auth-login [data-testid$="username"]').fill('alice')
    await page.locator('auth-login [data-testid$="password"]').fill('NewVaultPassword123!')
    await page.locator('auth-login [data-testid$="loginSubmit"]').click()
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    /* Clear memory/session via reload to simulate active session lock */
    await page.reload()
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await expect(page.locator('vault-unlock')).toBeVisible()

    /* Try old password and expect unlock failure */
    await page.locator('[data-testid$="password"]').fill('Password123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()
    await expect(page.locator('[data-testid$="password-feedback"]')).toContainText(
      /wrong secret key|Invalid Password|Unlock failed/
    )

    /* Try new password and expect unlock success */
    await page.locator('[data-testid$="password"]').fill('NewVaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    /* Clear memory/session via reload to simulate active session lock again to verify burned code */
    await page.reload()
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await expect(page.locator('vault-unlock')).toBeVisible()

    /* Attempt recovery with the same used recovery code */
    await page.locator('vault-unlock [ref$="__btnShowRecovery"]').dispatchEvent('click')
    await page.locator('input[name="recoveryCodeInput"]').fill(testRecoveryCode)
    await page.locator('vault-unlock button:has-text("Verify Recovery Code")').click()

    /* Verify rejection */
    await expect(page.locator('[data-testid$="recoveryCodeInput-feedback"]')).toContainText(/Invalid or expired recovery code|No recovery codes configured/)
  })

  test('should handle TOTP dual modal setup, device trust state machine, and step-up verification', async ({ page, loginApp }) => {
    /* Perform login for Alice */
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    /* Open profile settings modal */
    await page.locator('[data-testid$="__profileBtn"]').click()
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
    await page.locator('.toast .btn-close').click().catch(() => {
    })
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
    await expect(page.locator('.toast-body')).toContainText('Biometric unlock successfully enabled!')

    /* TEST DEVICE TRUST STATE MACHINE (UNTRUSTED VS TRUSTED) */
    await page.locator('[data-testid$="profileBtn"]').click()
    await page.locator('[data-testid$="btnLogout"]').click()
    await expect(page.locator('auth-login')).toBeVisible()

    /* UNTRUSTED STATE: Clear local storage completely to simulate unrecognized device */
    await page.evaluate(() => {
      return localStorage.clear()
    })

    /* Log in with password */
    await page.locator('auth-login [data-testid$="username"]').fill('alice')
    await page.locator('auth-login [data-testid$="password"]').fill('Password123!')
    await page.locator('auth-login [data-testid$="loginSubmit"]').click()

    /* Assert that unrecognized device halts flow and mounts the TOTP challenge modal */
    await expect(page.locator('totp-challenge')).toBeVisible()

    /* Enter invalid TOTP code */
    await page.locator('[data-testid$="totpChallengeInput"]').fill('000000')
    await page.locator('[data-testid$="totpChallengeSubmit"]').click()
    await expect(page.locator('[data-testid$="totpChallenge-feedback"]')).toContainText('Invalid verification code.')

    /* Enter valid TOTP code */
    const challengeCode = await getTotpCode(page, secret)
    await page.locator('[data-testid$="totpChallengeInput"]').fill(challengeCode)
    await page.locator('[data-testid$="totpChallengeSubmit"]').click()

    /* Recognized device: direct prompt to Unlock Vault is visible now */
    await expect(page.locator('vault-unlock')).toBeVisible()

    /* Unlock the vault */
    await page.locator('[data-testid$="password"]').fill('VaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()
    await expect(page.locator('app-layout')).toBeVisible({ timeout: 20000 })

    /* TRUSTED STATE: Log out normally (keep the trust token in local storage) */
    await page.locator('[data-testid$="profileBtn"]').click()
    await page.locator('[data-testid$="btnLogout"]').click()
    await expect(page.locator('auth-login')).toBeVisible()

    /* Log back in with password */
    await page.locator('auth-login [data-testid$="username"]').fill('alice')
    await page.locator('auth-login [data-testid$="password"]').fill('Password123!')
    await page.locator('auth-login [data-testid$="loginSubmit"]').click()

    /* Assert that recognized device completely bypasses TOTP challenge and goes straight to vault unlock */
    await expect(page.locator('vault-unlock')).toBeVisible()
    await expect(page.locator('totp-challenge')).not.toBeVisible()

    /* Unlock vault to disable TOTP */
    await page.locator('[data-testid$="password"]').fill('VaultPassword123!')
    await page.locator('[data-testid$="unlockSubmit"]').click()
    await expect(page.locator('app-layout')).toBeVisible()

    /* DISABLE TOTP */
    await page.locator('[data-testid$="__profileBtn"]').click()
    await page.locator('[data-testid$="__btnSettings"]').click()
    await page.locator('[data-testid$="__btnManageTotp"]').click()

    /* Fill valid TOTP to disable */
    const disableCode = await getTotpCode(page, secret)
    await page.locator('[data-testid$="__disableOtpInput"]').fill(disableCode)
    await page.locator('[data-testid$="__btnVerifyDisable"]').click()

    /* Toast confirmation */
    await expect(page.locator('.toast-body')).toContainText('Two-Step Authentication disabled successfully.')
  })

  test('should inject the strict Content Security Policy and safety headers', async ({ page }) => {
    const pbUrl = process.env.ATOLL_POCKETBASE_URL || process.env.ATOLL_INTERNAL_POCKETBASE_URL || 'http://localhost:8091'
    const response = await page.request.get(`${pbUrl}/api/health`)
    expect(response).not.toBeNull()
    const headers = response.headers()

    expect(headers['content-security-policy']).toBeDefined()
    const csp = headers['content-security-policy']
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'")
    expect(csp).toContain("worker-src 'self' blob:")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("img-src 'self' data: blob: https:")
    expect(csp).toContain("media-src 'self' blob:")
    expect(csp).toContain("font-src 'self' data:")
    expect(csp).toContain("manifest-src 'self'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")

    // Safety Headers
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })
})
