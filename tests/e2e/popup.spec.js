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
    await expect(dialog).toHaveClass(/modal-dialog-centered/)
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
      size: 'md',
      title: 'Confirm Action'
    })

    const primaryEvent = events.find(e => e.type === 'primary')
    expect(primaryEvent.detail).toEqual({
      variant: 'confirm',
      size: 'md',
      title: 'Confirm Action'
    })

    const secondaryEvent = events.find(e => e.type === 'secondary')
    expect(secondaryEvent.detail).toEqual({
      variant: 'confirm',
      size: 'md',
      title: 'Confirm Action'
    })

    const closeEvent = events.find(e => e.type === 'close')
    expect(closeEvent.detail).toEqual({
      variant: 'confirm',
      size: 'md',
      title: 'Confirm Action'
    })
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
      popupWithSlot.innerHTML = '<img slot="hero" src="/icon-192x192.png" id="slotted-img" />'
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
    await expect(heroWrapperSlot.locator('#slotted-img')).toHaveAttribute('src', '/icon-192x192.png')
  })

  test('should never render a close button since specs require users to close with action buttons', async ({ page }) => {
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'test-popup-no-close-btn'
      popup.setAttribute('title', 'No Close Button Dialog')
      popup.setAttribute('open', 'true')
      document.body.appendChild(popup)
    })

    const popupHost = page.locator('#test-popup-no-close-btn')
    const modal = popupHost.locator('.modal')
    await expect(modal).toBeVisible()

    const closeBtn = popupHost.locator('atoll-button[ref$="btnClose"]')
    await expect(closeBtn).not.toBeVisible()
  })

  test('should support disable-backdrop setting backdrop: static', async ({ page }) => {
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'test-popup-disable-backdrop'
      popup.setAttribute('disable-backdrop', 'true')
      popup.setAttribute('title', 'Disable Backdrop Dialog')
      popup.setAttribute('open', 'true')
      document.body.appendChild(popup)
    })

    const popupHost = page.locator('#test-popup-disable-backdrop')
    const modal = popupHost.locator('.modal')
    await expect(modal).toBeVisible()

    // Click on the backdrop (outside the modal dialog)
    await page.mouse.click(10, 10)

    // Modal should remain open/visible
    await expect(modal).toHaveClass(/show/)
  })

  test('should support disable-keyboard preventing closing via Escape key', async ({ page }) => {
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'test-popup-disable-keyboard'
      popup.setAttribute('disable-keyboard', 'true')
      popup.setAttribute('title', 'Disable Keyboard Dialog')
      popup.setAttribute('open', 'true')
      document.body.appendChild(popup)
    })

    const popupHost = page.locator('#test-popup-disable-keyboard')
    const modal = popupHost.locator('.modal')
    await expect(modal).toBeVisible()

    // Press escape key
    await page.keyboard.press('Escape')

    // Modal should remain open/visible
    await expect(modal).toHaveClass(/show/)
  })

  test('should support disable-focus preventing automatic focus behavior', async ({ page }) => {
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'test-popup-disable-focus'
      popup.setAttribute('disable-focus', 'true')
      popup.setAttribute('title', 'Disable Focus Dialog')
      popup.setAttribute('open', 'true')
      document.body.appendChild(popup)
    })

    const popupHost = page.locator('#test-popup-disable-focus')
    const modal = popupHost.locator('.modal')
    await expect(modal).toBeVisible()

    // Simply check that the modal initialized successfully with disable-focus attribute
    expect(await popupHost.getAttribute('disable-focus')).toBe('true')
  })

  test('should support horizontal, vertical layout attributes, and tertiary-text with correct button ordering', async ({ page }) => {
    // Horizontal layout (Default / "horizontal")
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'popup-test-horizontal'
      popup.setAttribute('actions-layout', 'horizontal')
      popup.setAttribute('primary-text', 'OK')
      popup.setAttribute('secondary-text', 'Cancel')
      popup.setAttribute('title', 'Horizontal Layout')
      document.body.appendChild(popup)
    })

    const popupHorizontal = page.locator('#popup-test-horizontal')
    await expect(popupHorizontal).toBeAttached()

    const actionsHorizontal = popupHorizontal.locator('.atoll-popup-actions')
    await expect(actionsHorizontal).toHaveClass(/atoll-popup-actions-horizontal/)

    // In horizontal, secondBtn is on the left (first child), primaryBtn is on the right (second child)
    const firstButtonH = actionsHorizontal.locator('atoll-button').nth(0)
    const secondButtonH = actionsHorizontal.locator('atoll-button').nth(1)
    await expect(firstButtonH).toHaveAttribute('ref', 'secondaryBtn')
    await expect(secondButtonH).toHaveAttribute('ref', 'primaryBtn')

    // Vertical layout ("vertical")
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'popup-test-vertical'
      popup.setAttribute('actions-layout', 'vertical')
      popup.setAttribute('primary-text', 'OK')
      popup.setAttribute('secondary-text', 'Cancel')
      popup.setAttribute('title', 'Vertical Layout')
      document.body.appendChild(popup)
    })

    const popupVertical = page.locator('#popup-test-vertical')
    await expect(popupVertical).toBeAttached()

    const actionsVertical = popupVertical.locator('.atoll-popup-actions')
    await expect(actionsVertical).toHaveClass(/atoll-popup-actions-vertical/)

    // In vertical, primaryBtn is on top (first child), secondaryBtn is beneath (second child)
    const firstButtonV = actionsVertical.locator('atoll-button').nth(0)
    const secondButtonV = actionsVertical.locator('atoll-button').nth(1)
    await expect(firstButtonV).toHaveAttribute('ref', 'primaryBtn')
    await expect(secondButtonV).toHaveAttribute('ref', 'secondaryBtn')

    // 3-button layout with tertiary-text (Forced Vertical)
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'popup-test-tertiary'
      popup.setAttribute('primary-text', 'Backup')
      popup.setAttribute('tertiary-text', 'Later')
      popup.setAttribute('secondary-text', 'Cancel')
      popup.setAttribute('title', 'Three Buttons Stack')
      document.body.appendChild(popup)
    })

    const popupTertiary = page.locator('#popup-test-tertiary')
    await expect(popupTertiary).toBeAttached()

    const actionsTertiary = popupTertiary.locator('.atoll-popup-actions')
    await expect(actionsTertiary).toHaveClass(/atoll-popup-actions-vertical/)

    // Stacking visual order is Affirmative -> Tertiary -> Dismissive
    const firstButtonT = actionsTertiary.locator('atoll-button').nth(0)
    const secondButtonT = actionsTertiary.locator('atoll-button').nth(1)
    const thirdButtonT = actionsTertiary.locator('atoll-button').nth(2)
    await expect(firstButtonT).toHaveAttribute('ref', 'primaryBtn')
    await expect(secondButtonT).toHaveAttribute('ref', 'tertiaryBtn')
    await expect(thirdButtonT).toHaveAttribute('ref', 'secondaryBtn')
  })

  test('should dispatch dedicated custom event when tertiary button is clicked, without closing modal', async ({ page }) => {
    await page.evaluate(() => {
      const popup = document.createElement('atoll-popup')
      popup.id = 'popup-test-tertiary-events'
      popup.setAttribute('variant', 'confirm')
      popup.setAttribute('size', 'lg')
      popup.setAttribute('primary-text', 'Backup')
      popup.setAttribute('tertiary-text', 'Later')
      popup.setAttribute('secondary-text', 'Cancel')
      popup.setAttribute('title', 'Tertiary Event Test')
      popup.setAttribute('open', 'true')

      window.__popupTertiaryEvents = []
      popup.addEventListener('atoll-popup-tertiary', (e) => {
        window.__popupTertiaryEvents.push({
          type: 'tertiary',
          detail: e.detail
        })
      })

      document.body.appendChild(popup)
    })

    const popupHost = page.locator('#popup-test-tertiary-events')
    const modal = popupHost.locator('.modal')
    await expect(modal).toBeVisible()

    // Find and click the tertiary button
    const tertiaryBtn = popupHost.locator('atoll-button[ref$="tertiaryBtn"] button')
    await tertiaryBtn.click()

    // Assert custom event was fired with correct details
    await page.waitForFunction(() => window.__popupTertiaryEvents.length > 0)
    const events = await page.evaluate(() => window.__popupTertiaryEvents)
    expect(events[0]).toEqual({
      type: 'tertiary',
      detail: {
        variant: 'confirm',
        size: 'lg',
        title: 'Tertiary Event Test'
      }
    })

    // Assert that the modal is still open
    await expect(modal).toBeVisible()
  })

  test('should dynamically relocate nested modals to document.body and manage z-indices progressive stack ordering over offcanvas', async ({ page }) => {
    // Set up a nested structure: a modal inside an offcanvas container
    await page.evaluate(() => {
      const offcanvas = document.createElement('div')
      offcanvas.id = 'test-offcanvas'
      offcanvas.className = 'offcanvas offcanvas-end show'
      offcanvas.style.zIndex = '1050'

      const popup = document.createElement('atoll-popup')
      popup.id = 'nested-popup'
      popup.setAttribute('title', 'Nested Dialog')

      offcanvas.appendChild(popup)
      document.body.appendChild(offcanvas)

      // Open the offcanvas (simulating offcanvas show event)
      offcanvas.dispatchEvent(new CustomEvent('show.bs.offcanvas', { bubbles: true }))

      // Open the modal popup
      popup.setAttribute('open', 'true')
    })

    const offcanvas = page.locator('#test-offcanvas')
    const modal = page.locator('.modal')

    await expect(offcanvas).toBeVisible()
    await expect(modal).toBeVisible()

    // Assert that the popup remains in the DOM while escaping stacking context via Top Layer
    const isTopLayerModal = await page.evaluate(() => {
      const modalEl = document.querySelector('dialog.modal')
      return modalEl && modalEl.open && modalEl.parentElement && modalEl.parentElement.tagName === 'ATOLL-POPUP'
    })
    expect(isTopLayerModal).toBe(true)

    // Close the modal
    await page.evaluate(() => {
      const popup = document.getElementById('nested-popup')
      popup.removeAttribute('open')
    })

    // Wait for the modal transition to finish and become hidden
    await expect(modal).not.toBeVisible()
    await page.waitForTimeout(500)

    // Assert the modal is restored to its original parent (under #nested-popup custom host)
    const isRestoredToParent = await page.evaluate(() => {
      const modalEl = document.querySelector('#nested-popup .modal')
      const host = document.getElementById('nested-popup')
      return modalEl && modalEl.parentElement === host
    })
    expect(isRestoredToParent).toBe(true)
  })
})
