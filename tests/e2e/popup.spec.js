import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Popup / Modal Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should support variant, size, and layout classes', async ({ page }) => {
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'test-popup-modifiers'
      popup.setAttribute('variant', 'danger')
      popup.setAttribute('size', 'lg')
      popup.setAttribute('stacked-actions', 'true')
      popup.setAttribute('title', 'Delete items?')
      popup.setAttribute('description', 'This action is irreversible.')
      document.body.appendChild(popup)
    })

    const popupHost = page.locator('#test-popup-modifiers')
    await expect(popupHost).toBeAttached()

    const dialog = popupHost.locator('.atoll-popup-dialog')
    await expect(dialog).toHaveClass(/atoll-popup-lg/)

    const actions = popupHost.locator('.atoll-popup-actions')
    await expect(actions).toHaveClass(/atoll-popup-actions-stacked/)

    const primaryBtn = popupHost.locator('atoll-button[ref$="primaryBtn"]')
    await expect(primaryBtn).toHaveAttribute('variant', 'danger')
  })

  test('should trigger custom events with correct detail payloads', async ({ page }) => {
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'test-popup-events'
      popup.setAttribute('variant', 'confirm')
      popup.setAttribute('size', 'md')
      popup.setAttribute('title', 'Confirm Action')
      popup.setAttribute('description', 'Please confirm your action.')
      popup.setAttribute('open', 'true')

      window.__popupEvents = []
      popup.addEventListener('atoll-popup-open', (e) => {
        window.__popupEvents.push({
          type: 'open',
          detail: e.detail
        })
      })
      popup.addEventListener('atoll-popup-primary', (e) => {
        window.__popupEvents.push({
          type: 'primary',
          detail: e.detail
        })
      })
      popup.addEventListener('atoll-popup-secondary', (e) => {
        window.__popupEvents.push({
          type: 'secondary',
          detail: e.detail
        })
      })
      popup.addEventListener('atoll-popup-close', (e) => {
        window.__popupEvents.push({
          type: 'close',
          detail: e.detail
        })
      })

      document.body.appendChild(popup)
    })

    const popupHost = page.locator('#test-popup-events')
    const modal = popupHost.locator('.modal')
    await expect(modal).toBeVisible()

    // Wait for open event
    await page.waitForFunction(() => window.__popupEvents.some(e => e.type === 'open'))

    const primaryBtn = popupHost.locator('atoll-button[ref$="primaryBtn"] button')
    await primaryBtn.click()

    const secondaryBtn = popupHost.locator('atoll-button[ref$="secondaryBtn"] button')
    await secondaryBtn.click()

    // Secondary button hide triggers close event
    await page.waitForFunction(() => window.__popupEvents.some(e => e.type === 'close'))

    const events = await page.evaluate(() => window.__popupEvents)

    const openEvent = events.find(e => e.type === 'open')
    expect(openEvent.detail).toEqual({
      variant: 'confirm',
      size: 'md'
    })

    const primaryEvent = events.find(e => e.type === 'primary')
    expect(primaryEvent.detail).toEqual({
      variant: 'confirm',
      size: 'md'
    })

    const secondaryEvent = events.find(e => e.type === 'secondary')
    expect(secondaryEvent.detail).toEqual({ variant: 'confirm' })

    const closeEvent = events.find(e => e.type === 'close')
    expect(closeEvent.detail).toEqual({ variant: 'confirm' })
  })

  test('should support static backdrop preventing close', async ({ page }) => {
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'test-popup-static'
      popup.setAttribute('static-backdrop', 'true')
      popup.setAttribute('title', 'Static Dialog')
      popup.setAttribute('open', 'true')
      document.body.appendChild(popup)
    })

    const popupHost = page.locator('#test-popup-static')
    const modal = popupHost.locator('.modal')
    await expect(modal).toBeVisible()

    // Click backdrop
    await page.mouse.click(10, 10)

    // Popup should still be open
    await expect(modal).toHaveClass(/show/)
  })

  test('should support heroIcon and slotted hero graphic', async ({ page }) => {
    await page.evaluate(() => {
      // With hero-icon attribute
      const popupWithIcon = document.createElement('atoll-popup')
      popupWithIcon.id = 'popup-with-icon'
      popupWithIcon.setAttribute('hero-icon', 'settings')
      popupWithIcon.setAttribute('title', 'Settings Hero')
      popupWithIcon.setAttribute('open', 'true')
      document.body.appendChild(popupWithIcon)

      // With slotted hero
      const popupWithSlot = document.createElement('atoll-popup')
      popupWithSlot.id = 'popup-with-slot'
      popupWithSlot.setAttribute('title', 'Slotted Hero')
      popupWithSlot.setAttribute('open', 'true')
      popupWithSlot.innerHTML = '<img slot="hero" src="test.png" id="slotted-img" />'
      document.body.appendChild(popupWithSlot)
    })

    const withIcon = page.locator('#popup-with-icon')
    const withSlot = page.locator('#popup-with-slot')

    await expect(withIcon.locator('.modal')).toBeVisible()
    await expect(withSlot.locator('.modal')).toBeVisible()

    const heroWrapperIcon = withIcon.locator('.atoll-popup-hero')
    await expect(heroWrapperIcon).toBeVisible()
    await expect(heroWrapperIcon.locator('atoll-icon')).toHaveAttribute('name', 'settings')

    const heroWrapperSlot = withSlot.locator('.atoll-popup-hero')
    await expect(heroWrapperSlot).toBeVisible()
    await expect(heroWrapperSlot.locator('#slotted-img')).toHaveAttribute('src', 'test.png')
  })
})
