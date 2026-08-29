import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-permission-modal Component Tests', () => {
  test('should render permission modal with composed atoll-popup and atoll-input', async ({ page, mountComponent }) => {
    await mountComponent('atoll-permission-modal', {
      title: 'Vault Security Access',
      description: 'Enter your password to authorize master key decrypt.'
    })

    const modalHost = page.locator('#test-component-root')
    const popup = modalHost.locator('atoll-popup')
    const passwordInput = modalHost.locator('atoll-input[ref$="passwordInput"]')

    await expect(modalHost).toBeAttached()
    await expect(popup).toBeAttached()
    await expect(passwordInput).toBeAttached()

    const hasMethods = await modalHost.evaluate((el) => {
      return typeof el.prompt === 'function' && typeof el.show === 'function' && typeof el.hide === 'function'
    })
    expect(hasMethods).toBe(true)
  })

  test('should open and close via public API and trigger cancel event', async ({ page, mountComponent }) => {
    await mountComponent('atoll-permission-modal', {})

    const modalHost = page.locator('#test-component-root')

    await page.evaluate(() => {
      window.__cancelFired = false
      const el = document.getElementById('test-component-root')
      el.addEventListener('atoll-permission-cancel', () => { window.__cancelFired = true })
    })

    await modalHost.evaluate(el => { el.show({ title: 'Dynamic Security Prompt' }) })
    const popup = modalHost.locator('atoll-popup')
    await expect(popup).toHaveAttribute('open')

    await modalHost.evaluate(el => { el.hide() })
    await expect(popup).not.toHaveAttribute('open')

    const cancelFired = await page.evaluate(() => window.__cancelFired)
    expect(cancelFired).toBe(true)
  })

  test('should toggle TOTP verification input when requireTotp is enabled', async ({ page, mountComponent }) => {
    await mountComponent('atoll-permission-modal', { 'require-totp': 'true' })

    const modalHost = page.locator('#test-component-root')
    await modalHost.evaluate(el => { el.show({ requireTotp: true }) })

    const totpSection = modalHost.locator('.atoll-permission-totp')
    await expect(totpSection).not.toHaveClass(/d-none/)
  })

  test('should render comprehensive visual matrix and generate verification screenshots', async ({ page, setTheme, takeVerificationScreenshot }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await page.evaluate(() => {
      let mountPoint = document.getElementById('component-mount-point')
      if (!mountPoint) {
        mountPoint = document.createElement('div')
        mountPoint.id = 'component-mount-point'
        document.body.appendChild(mountPoint)
      }
      mountPoint.innerHTML = ''

      const matrix = document.createElement('div')
      matrix.id = 'visual-matrix'
      matrix.style.cssText = 'display: flex; flex-direction: column; gap: 32px; padding: 48px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif; max-width: 540px; margin: 0 auto;'

      const title = document.createElement('h2')
      title.style.cssText = 'margin: 0; font-size: 20px;'
      title.textContent = 'atoll-permission-modal Visual Verification'
      matrix.appendChild(title)

      const modal = document.createElement('atoll-permission-modal')
      modal.setAttribute('title', 'Vault Master Key Access')
      modal.setAttribute('description', 'Provide your master password or biometric authorization.')
      modal.setAttribute('action-label', 'Unlock')
      modal.setAttribute('open', 'true')

      matrix.appendChild(modal)
      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('permission-modal-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('permission-modal-verification-dark', matrix)
  })
})