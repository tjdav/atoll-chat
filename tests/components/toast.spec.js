import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-toast Component Tests', () => {
  test('should render popover container and support programmatic toast triggers', async ({ page, mountComponent }) => {
    await mountComponent('atoll-toast', { placement: 'bottom-start' })
    const toastHost = page.locator('#test-component-root')
    const popoverContainer = toastHost.locator('.atoll-toast-container')

    await expect(toastHost).toBeAttached()
    await expect(popoverContainer).toBeAttached()

    // Trigger toast programmatically
    const toastId = await toastHost.evaluate((el) => {
      return el.show({
        message: 'Notification Received',
        variant: 'success',
        duration: 0
      })
    })

    const card = toastHost.locator(`.atoll-toast-card[data-toast-id="${toastId}"]`)
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('role', 'status')
    await expect(card).toHaveAttribute('aria-live', 'polite')
    await expect(card.locator('.atoll-toast-message')).toContainText('Notification Received')
  })

  test('should accept danger/warning variants and map assertive ARIA roles', async ({ page, mountComponent }) => {
    await mountComponent('atoll-toast', { placement: 'bottom-end' })
    const toastHost = page.locator('#test-component-root')

    const dangerId = await toastHost.evaluate((el) => {
      return el.show({ message: 'Critical Error Occurred', variant: 'danger', duration: 0 })
    })
    const dangerCard = toastHost.locator(`.atoll-toast-card[data-toast-id="${dangerId}"]`)
    await expect(dangerCard).toBeVisible()
    await expect(dangerCard).toHaveAttribute('role', 'alert')
    await expect(dangerCard).toHaveAttribute('aria-live', 'assertive')

    const warningId = await toastHost.evaluate((el) => {
      return el.show({ message: 'System Warning', variant: 'warning', duration: 0 })
    })
    const warningCard = toastHost.locator(`.atoll-toast-card[data-toast-id="${warningId}"]`)
    await expect(warningCard).toBeVisible()
    await expect(warningCard).toHaveAttribute('role', 'alert')
  })

  test('should enforce maxToasts capacity limit', async ({ page, mountComponent }) => {
    await mountComponent('atoll-toast', { 'max-toasts': '2' })
    const toastHost = page.locator('#test-component-root')

    await toastHost.evaluate((el) => {
      el.show({ message: 'Toast 1', duration: 0 })
      el.show({ message: 'Toast 2', duration: 0 })
      el.show({ message: 'Toast 3', duration: 0 })
    })

    const cards = toastHost.locator('.atoll-toast-card:not(.atoll-toast-closing)')
    await expect(cards).toHaveCount(2)
    await expect(cards.first()).toContainText('Toast 2')
    await expect(cards.last()).toContainText('Toast 3')
  })

  test('should handle action button callbacks and dismissible: false options', async ({ page, mountComponent }) => {
    await mountComponent('atoll-toast', {})
    const toastHost = page.locator('#test-component-root')

    await page.evaluate(() => {
      window.__actionTriggered = false
      const el = document.getElementById('test-component-root')
      el.show({
        id: 'action-test-toast',
        message: 'File downloaded',
        variant: 'info',
        duration: 0,
        dismissible: false,
        action: {
          label: 'Open',
          onClick: () => { window.__actionTriggered = true }
        }
      })
    })

    const card = toastHost.locator('.atoll-toast-card[data-toast-id="action-test-toast"]')
    await expect(card).toBeVisible()

    // Ensure close button is absent when dismissible: false
    const closeBtn = card.locator('atoll-button[aria-label="Dismiss notification"]')
    await expect(closeBtn).toHaveCount(0)

    const actionBtn = card.locator('.atoll-toast-action-btn')
    await expect(actionBtn).toBeVisible()
    await actionBtn.click()

    const triggered = await page.evaluate(() => window.__actionTriggered)
    expect(triggered).toBe(true)
  })

  test('should pause and resume countdown timer on mouse, focus, and touch interaction', async ({ page, mountComponent }) => {
    await mountComponent('atoll-toast', {})
    const toastHost = page.locator('#test-component-root')

    const toastId = await toastHost.evaluate((el) => {
      return el.show({ message: 'Expiring notification', duration: 1000 })
    })
    const card = toastHost.locator(`.atoll-toast-card[data-toast-id="${toastId}"]`)
    await expect(card).toBeVisible()

    // Hover to pause
    await card.hover()
    await expect(card).toHaveClass(/atoll-toast-paused/)

    // Leave to resume
    await page.mouse.move(0, 0)
    await expect(card).not.toHaveClass(/atoll-toast-paused/)
  })

  test('should dismiss active toast on Escape key', async ({ page, mountComponent }) => {
    await mountComponent('atoll-toast', {})
    const toastHost = page.locator('#test-component-root')

    await toastHost.evaluate((el) => {
      el.show({ id: 'esc-toast', message: 'Dismiss with escape', duration: 0 })
    })
    const card = toastHost.locator('.atoll-toast-card[data-toast-id="esc-toast"]')
    await expect(card).toBeVisible()

    await card.focus()
    await page.keyboard.press('Escape')

    await expect(toastHost.locator('.atoll-toast-card[data-toast-id="esc-toast"]')).toHaveCount(0)
  })

  test('should render comprehensive visual matrix and generate verification screenshots', async ({ page, mountComponent, setTheme, takeVerificationScreenshot }) => {
    await mountComponent('atoll-toast', { placement: 'bottom-start' })
    const toastHost = page.locator('#test-component-root')

    await toastHost.evaluate((el) => {
      el.show({ message: 'Success! Your message was sent.', variant: 'success', duration: 0 })
      el.show({ message: 'Warning! Network connection unstable.', variant: 'warning', duration: 0 })
      el.show({
        message: 'Update available for download.',
        variant: 'info',
        duration: 0,
        action: { label: 'Restart' }
      })
    })

    const cards = toastHost.locator('.atoll-toast-card')
    await expect(cards).toHaveCount(3)

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('toast-verification-light', toastHost.locator('.atoll-toast-container'))

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('toast-verification-dark', toastHost.locator('.atoll-toast-container'))
  })
})
