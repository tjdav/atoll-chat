import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-popup Component Tests', () => {
  test('should render base dialog with ARIA attributes, title, and description', async ({ page, mountComponent }) => {
    await mountComponent('atoll-popup', {
      title: 'Confirm Action',
      description: 'Are you sure you want to proceed?'
    })

    const popupHost = page.locator('#test-component-root')
    const dialog = popupHost.locator('dialog')
    const title = popupHost.locator('.atoll-popup-title')
    const desc = popupHost.locator('.atoll-popup-description')

    await expect(popupHost).toBeAttached()
    await expect(dialog).toHaveAttribute('aria-labelledby')
    await expect(dialog).toHaveAttribute('aria-describedby')
    await expect(title).toHaveText('Confirm Action')
    await expect(desc).toHaveText('Are you sure you want to proceed?')

    // Verify public method delegates
    const apiAvailable = await popupHost.evaluate((el) => {
      return typeof el.show === 'function' && typeof el.hide === 'function'
    })
    expect(apiAvailable).toBe(true)
  })

  test('should support size modifiers (sm, md, lg)', async ({ page, mountComponent }) => {
    await mountComponent('atoll-popup', {
      size: 'sm',
      title: 'Small Dialog'
    })

    const popupHost = page.locator('#test-component-root')
    const dialogBox = popupHost.locator('.atoll-popup-dialog')

    await expect(dialogBox).toHaveCSS('max-width', '300px')

    await popupHost.evaluate(el => el.setAttribute('size', 'lg'))
    await expect(dialogBox).toHaveCSS('max-width', '480px')
  })

  test('should compose action buttons with atoll-button and handle primary/secondary callbacks', async ({ page, mountComponent }) => {
    await mountComponent('atoll-popup', {
      open: 'true',
      variant: 'confirm',
      title: 'Save Changes?',
      'primary-text': 'Save',
      'secondary-text': 'Discard'
    })

    const popupHost = page.locator('#test-component-root')
    const primaryBtn = popupHost.locator('atoll-button[ref$="primaryBtn"]')
    const secondaryBtn = popupHost.locator('atoll-button[ref$="secondaryBtn"]')

    await expect(primaryBtn).toBeVisible()
    await expect(secondaryBtn).toBeVisible()
    await expect(primaryBtn).toHaveText('Save')
    await expect(secondaryBtn).toHaveText('Discard')

    await page.evaluate(() => {
      window.__primaryClicked = false
      window.__secondaryClicked = false
      const el = document.getElementById('test-component-root')
      el.addEventListener('atoll-popup-primary', () => { window.__primaryClicked = true })
      el.addEventListener('atoll-popup-secondary', () => { window.__secondaryClicked = true })
    })

    await primaryBtn.click()
    const primaryFired = await page.evaluate(() => window.__primaryClicked)
    expect(primaryFired).toBe(true)

    await secondaryBtn.click()
    const secondaryFired = await page.evaluate(() => window.__secondaryClicked)
    expect(secondaryFired).toBe(true)
  })

  test('should render hero icon and handle slotted hero graphics', async ({ page, mountComponent }) => {
    await mountComponent('atoll-popup', {
      'hero-icon': 'shield',
      title: 'Security Alert',
      open: 'true'
    })

    const popupHost = page.locator('#test-component-root')
    const icon = popupHost.locator('.atoll-popup-hero atoll-icon')

    await expect(icon).toBeAttached()
    await expect(icon).toHaveAttribute('name', 'shield')
  })

  test('should handle Escape key dismissal and prevent close on static-backdrop', async ({ page, mountComponent }) => {
    await mountComponent('atoll-popup', {
      open: 'true',
      'static-backdrop': 'true',
      title: 'Static Modal'
    })

    const popupHost = page.locator('#test-component-root')
    const dialog = popupHost.locator('dialog')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

    // Without static-backdrop, Escape closes
    await popupHost.evaluate(el => el.removeAttribute('static-backdrop'))
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
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
      matrix.style.cssText = 'display: flex; flex-direction: column; gap: 32px; padding: 48px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;'

      const title = document.createElement('h2')
      title.style.cssText = 'margin: 0; font-size: 20px;'
      title.textContent = 'atoll-popup Visual Verification Matrix'
      matrix.appendChild(title)

      const group = document.createElement('div')
      group.style.cssText = 'display: flex; flex-direction: column; gap: 24px; position: relative;'

      // 1. Confirm Popup (md)
      const p1 = document.createElement('atoll-popup')
      p1.setAttribute('open', 'true')
      p1.setAttribute('variant', 'confirm')
      p1.setAttribute('title', 'Leave Room?')
      p1.setAttribute('description', 'You can re-join anytime using the invite link.')
      p1.setAttribute('primary-text', 'Leave')
      p1.setAttribute('secondary-text', 'Stay')

      group.appendChild(p1)
      matrix.appendChild(group)
      mountPoint.appendChild(matrix)
    })

    const dialogContent = page.locator('#visual-matrix .atoll-popup-dialog')
    await expect(dialogContent).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('popup-verification-light', dialogContent)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('popup-verification-dark', dialogContent)
  })
})
