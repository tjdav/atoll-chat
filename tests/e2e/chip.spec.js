import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Chip Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render basic chip and class modifiers', async ({ page }) => {
    await page.evaluate(() => {
      const chip = document.createElement('atoll-chip')
      chip.id = 'test-chip-basic'
      chip.setAttribute('variant', 'primary')
      chip.setAttribute('size', 'lg')
      chip.setAttribute('selected', 'true')
      chip.textContent = 'Active Tag'
      document.body.appendChild(chip)
    })

    const chipHost = page.locator('#test-chip-basic')
    await expect(chipHost).toBeVisible()

    const innerChip = chipHost.locator('.atoll-chip')
    await expect(innerChip).toHaveClass(/atoll-chip/)
    await expect(innerChip).toHaveClass(/atoll-chip-primary/)
    await expect(innerChip).toHaveClass(/atoll-chip-lg/)
    await expect(innerChip).toHaveClass(/atoll-chip-selected/)
    await expect(innerChip).toHaveAttribute('role', 'option')
    await expect(innerChip).toHaveAttribute('aria-selected', 'true')
    await expect(innerChip).toHaveAttribute('tabindex', '0')
  })

  test('should render correct default values', async ({ page }) => {
    await page.evaluate(() => {
      const chip = document.createElement('atoll-chip')
      chip.id = 'test-chip-defaults'
      chip.textContent = 'Default'
      document.body.appendChild(chip)
    })

    const chipHost = page.locator('#test-chip-defaults')
    await expect(chipHost).toBeVisible()

    const innerChip = chipHost.locator('.atoll-chip')
    await expect(innerChip).toHaveClass(/atoll-chip-secondary/)
    await expect(innerChip).toHaveClass(/atoll-chip-md/)
    await expect(innerChip).toHaveAttribute('role', 'button')
  })

  test('should handle disabled state correctly', async ({ page }) => {
    await page.evaluate(() => {
      const chip = document.createElement('atoll-chip')
      chip.id = 'test-chip-disabled'
      chip.setAttribute('disabled', 'true')
      chip.textContent = 'Disabled'
      window.__chipClicked = false
      chip.addEventListener('click', () => {
        window.__chipClicked = true
      })
      document.body.appendChild(chip)
    })

    const chipHost = page.locator('#test-chip-disabled')
    await expect(chipHost).toBeVisible()

    const innerChip = chipHost.locator('.atoll-chip')
    await expect(innerChip).toHaveClass(/disabled/)
    await expect(innerChip).toHaveAttribute('tabindex', '-1')

    await innerChip.click({ force: true })
    const clicked = await page.evaluate(() => window.__chipClicked)
    /* Verify disabled clicks and focus behavior. */
    expect(clicked).toBe(false)
  })

  test('should sync and handle removable behavior', async ({ page }) => {
    await page.evaluate(() => {
      const chip = document.createElement('atoll-chip')
      chip.id = 'test-chip-remove'
      chip.setAttribute('removable', 'true')
      chip.setAttribute('value', 'id-123')
      chip.textContent = 'Removable'
      window.__removedPayload = null
      chip.addEventListener('atoll-chip-remove', (e) => {
        window.__removedPayload = e.detail.value
      })
      document.body.appendChild(chip)
    })

    const chipHost = page.locator('#test-chip-remove')
    await expect(chipHost).toBeVisible()

    const innerChip = chipHost.locator('.atoll-chip')
    await expect(innerChip).toHaveClass(/atoll-chip-removable/)

    const removeBtn = innerChip.locator('.atoll-chip-remove')
    await expect(removeBtn).toBeVisible()

    const removeIcon = removeBtn.locator('atoll-icon')
    await expect(removeIcon).toBeVisible()
    await expect(removeIcon).toHaveAttribute('name', 'close')

    // Click the close/remove button
    await removeBtn.click()

    const payload = await page.evaluate(() => window.__removedPayload)
    expect(payload).toBe('id-123')

    // Dynamically update value and confirm observation works
    await page.evaluate(() => {
      const chip = document.getElementById('test-chip-remove')
      chip.setAttribute('value', 'id-456')
    })

    await removeBtn.click()
    const updatedPayload = await page.evaluate(() => window.__removedPayload)
    expect(updatedPayload).toBe('id-456')
  })

  test('should assert slot projection order', async ({ page }) => {
    await page.evaluate(() => {
      const chip = document.createElement('atoll-chip')
      chip.id = 'test-chip-slots'
      chip.innerHTML = `
        <span slot="leading" id="lead-item">L</span>
        Main Label
        <span slot="trailing" id="trail-item">T</span>
      `
      document.body.appendChild(chip)
    })

    const chipHost = page.locator('#test-chip-slots')
    await expect(chipHost).toBeVisible()

    const leading = chipHost.locator('#lead-item')
    const trailing = chipHost.locator('#trail-item')
    const label = chipHost.locator('.atoll-chip-label')

    await expect(leading).toBeVisible()
    await expect(trailing).toBeVisible()
    await expect(label).toContainText('Main Label')
  })

  test('should support keyboard navigation', async ({ page }) => {
    await page.evaluate(() => {
      const chip = document.createElement('atoll-chip')
      chip.id = 'test-chip-keyboard'
      chip.setAttribute('removable', 'true')
      chip.setAttribute('value', 'keyboard-val')
      chip.textContent = 'Keyboard Test'
      window.__chipToggled = 0
      window.__chipRemoved = 0

      chip.addEventListener('click', () => {
        window.__chipToggled++
      })
      chip.addEventListener('atoll-chip-remove', () => {
        window.__chipRemoved++
      })
      document.body.appendChild(chip)
    })

    const chipHost = page.locator('#test-chip-keyboard')
    await expect(chipHost).toBeVisible()

    const innerChip = chipHost.locator('.atoll-chip')
    await innerChip.focus()

    // Test Enter key
    await innerChip.press('Enter')
    let toggledCount = await page.evaluate(() => window.__chipToggled)
    expect(toggledCount).toBe(1)

    // Test Space key
    await innerChip.press(' ')
    toggledCount = await page.evaluate(() => window.__chipToggled)
    expect(toggledCount).toBe(2)

    // Test Backspace key (triggers remove)
    await innerChip.press('Backspace')
    let removedCount = await page.evaluate(() => window.__chipRemoved)
    expect(removedCount).toBe(1)

    // Test Delete key (triggers remove)
    await innerChip.press('Delete')
    removedCount = await page.evaluate(() => window.__chipRemoved)
    expect(removedCount).toBe(2)
  })

  test('should apply sizing compact heights and touch targets', async ({ page }) => {
    await page.evaluate(() => {
      const sm = document.createElement('atoll-chip')
      sm.id = 'chip-size-sm'
      sm.setAttribute('size', 'sm')
      sm.textContent = 'Small'
      document.body.appendChild(sm)

      const md = document.createElement('atoll-chip')
      md.id = 'chip-size-md'
      md.setAttribute('size', 'md')
      md.textContent = 'Medium'
      document.body.appendChild(md)

      const lg = document.createElement('atoll-chip')
      lg.id = 'chip-size-lg'
      lg.setAttribute('size', 'lg')
      lg.textContent = 'Large'
      document.body.appendChild(lg)
    })

    const smChip = page.locator('#chip-size-sm .atoll-chip')
    const mdChip = page.locator('#chip-size-md .atoll-chip')
    const lgChip = page.locator('#chip-size-lg .atoll-chip')

    await expect(smChip).toHaveCSS('height', '28px')
    await expect(smChip).toHaveCSS('padding-left', '10px')
    await expect(smChip).toHaveCSS('padding-right', '10px')

    await expect(mdChip).toHaveCSS('height', '32px')
    await expect(mdChip).toHaveCSS('padding-left', '12px')
    await expect(mdChip).toHaveCSS('padding-right', '12px')

    await expect(lgChip).toHaveCSS('height', '38px')
    await expect(lgChip).toHaveCSS('padding-left', '16px')
    await expect(lgChip).toHaveCSS('padding-right', '16px')

    // Verify touch target expanded pseudo-elements (::before exists on sm/md)
    const smTouchTarget = await smChip.evaluate((el) => {
      const style = window.getComputedStyle(el, '::before')
      return {
        content: style.getPropertyValue('content'),
        minHeight: style.getPropertyValue('min-height'),
        width: style.getPropertyValue('width')
      }
    })
    expect(smTouchTarget.content).toBe('""')
    expect(smTouchTarget.minHeight).toBe('44px')
    expect(parseFloat(smTouchTarget.width)).toBeGreaterThanOrEqual(44)

    const mdTouchTarget = await mdChip.evaluate((el) => {
      const style = window.getComputedStyle(el, '::before')
      return {
        content: style.getPropertyValue('content'),
        minHeight: style.getPropertyValue('min-height'),
        width: style.getPropertyValue('width')
      }
    })
    expect(mdTouchTarget.content).toBe('""')
    expect(mdTouchTarget.minHeight).toBe('44px')
    expect(parseFloat(mdTouchTarget.width)).toBeGreaterThanOrEqual(44)
  })

  test('should render visual variants for screenshot', async ({ page }) => {
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 24px; padding: 40px; background-color: #f8f9fa; font-family: system-ui, -apple-system, sans-serif; color: #111;">
          <h2 style="margin: 0; font-size: 24px; font-weight: 700;">Atoll Chat Chips Architecture Verification</h2>
          
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <strong style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #666;">Standard Filter / Choice Chips (Unselected vs Selected)</strong>
            <div id="row-filters" style="display: flex; gap: 12px; align-items: center;"></div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <strong style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #666;">Action Chips (Outline/Ghost with Leading Icons)</strong>
            <div id="row-actions" style="display: flex; gap: 12px; align-items: center;"></div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <strong style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #666;">Input / Tag Chips (Removable with Slotted Avatar Images)</strong>
            <div id="row-removable" style="display: flex; gap: 12px; align-items: center;"></div>
          </div>
        </div>
      `

      const filtersDiv = document.getElementById('row-filters')
      const actionsDiv = document.getElementById('row-actions')
      const removableDiv = document.getElementById('row-removable')

      /* Filter Chips */
      const filter1 = document.createElement('atoll-chip')
      filter1.setAttribute('selected', 'false')
      filter1.textContent = 'All Chats'
      filtersDiv.appendChild(filter1)

      const filter2 = document.createElement('atoll-chip')
      filter2.setAttribute('selected', 'true')
      filter2.textContent = 'Unread'

      /* Trailing Badge on Filter */
      const badge = document.createElement('atoll-badge')
      badge.setAttribute('slot', 'trailing')
      badge.setAttribute('count', '5')
      badge.setAttribute('size', 'sm')
      badge.setAttribute('variant', 'danger')
      filter2.appendChild(badge)
      filtersDiv.appendChild(filter2)

      const filter3 = document.createElement('atoll-chip')
      filter3.setAttribute('selected', 'false')
      filter3.textContent = 'Group Chats'
      filtersDiv.appendChild(filter3)

      const filter4 = document.createElement('atoll-chip')
      filter4.setAttribute('selected', 'false')
      filter4.setAttribute('disabled', 'true')
      filter4.textContent = 'Archived'
      filtersDiv.appendChild(filter4)

      /* Action Chips */
      const actionOutline = document.createElement('atoll-chip')
      actionOutline.setAttribute('variant', 'outline')
      actionOutline.innerHTML = `
        <atoll-icon slot="leading" name="add" size="18"></atoll-icon>
        Add Filter
      `
      actionsDiv.appendChild(actionOutline)

      const actionPrimary = document.createElement('atoll-chip')
      actionPrimary.setAttribute('variant', 'primary')
      actionPrimary.innerHTML = `
        <atoll-icon slot="leading" name="settings" size="18"></atoll-icon>
        Preferences
      `
      actionsDiv.appendChild(actionPrimary)

      /* Removable Avatar Chips */
      const removableSm = document.createElement('atoll-chip')
      removableSm.setAttribute('removable', 'true')
      removableSm.setAttribute('size', 'sm')
      removableSm.setAttribute('value', 'sm-user')
      removableSm.innerHTML = `
        <img slot="leading" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><rect width='20' height='20' fill='%23FF9999'/><circle cx='10' cy='10' r='6' fill='%23CC0000'/></svg>" alt="">
        Alex Morgan
      `
      removableDiv.appendChild(removableSm)

      const removableMd = document.createElement('atoll-chip')
      removableMd.setAttribute('removable', 'true')
      removableMd.setAttribute('size', 'md')
      removableMd.setAttribute('value', 'md-user')
      removableMd.innerHTML = `
        <img slot="leading" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><rect width='24' height='24' fill='%2399FF99'/><circle cx='12' cy='12' r='8' fill='%2300CC00'/></svg>" alt="">
        Brown Bear
      `
      removableDiv.appendChild(removableMd)

      const removableLg = document.createElement('atoll-chip')
      removableLg.setAttribute('removable', 'true')
      removableLg.setAttribute('size', 'lg')
      removableLg.setAttribute('value', 'lg-user')
      removableLg.innerHTML = `
        <img slot="leading" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><rect width='28' height='28' fill='%239999FF'/><circle cx='14' cy='14' r='10' fill='%230000CC'/></svg>" alt="">
        Cony Bunny
      `
      removableDiv.appendChild(removableLg)
    })

    // Wait for elements to be fully rendered
    await page.waitForTimeout(2000)

    // Take screenshot
    await page.screenshot({ path: 'tests/e2e/screenshots/chip-verification.png' })
  })
})
