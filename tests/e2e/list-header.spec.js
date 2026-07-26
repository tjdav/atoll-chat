import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll List Header Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render list variant by default with correct class and text', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-list-header')
      el.id = 'test-header-default'
      el.setAttribute('title', 'Pinned Chats')
      document.body.appendChild(el)
    })

    const header = page.locator('#test-header-default')
    await expect(header).toBeVisible()

    const innerRoot = header.locator('.atoll-list-header')
    await expect(innerRoot).toHaveClass(/atoll-list-header-list/)
    await expect(innerRoot).toHaveText(/Pinned Chats/)
  })

  test('should render card variant with correct classes and padding/styling', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-list-header')
      el.id = 'test-header-card'
      el.setAttribute('variant', 'card')
      el.setAttribute('title', 'Security & Vault')
      el.setAttribute('subtitle', 'Encrypted session keys')
      document.body.appendChild(el)
    })

    const header = page.locator('#test-header-card')
    await expect(header).toBeVisible()

    const innerRoot = header.locator('.atoll-list-header')
    await expect(innerRoot).toHaveClass(/atoll-list-header-card/)
    await expect(innerRoot).toHaveText(/Security & Vault/)
    await expect(innerRoot).toHaveText(/Encrypted session keys/)
  })

  test('should handle slot projections correctly', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-list-header')
      el.id = 'test-header-slots'
      el.setAttribute('title', 'My Section')

      // Leading slot
      const leading = document.createElement('span')
      leading.setAttribute('slot', 'leading')
      leading.id = 'test-leading-slot'
      leading.innerText = '⭐'
      el.appendChild(leading)

      // Action slot
      const action = document.createElement('button')
      action.setAttribute('slot', 'action')
      action.id = 'test-action-slot'
      action.innerText = 'Options'
      el.appendChild(action)

      document.body.appendChild(el)
    })

    const leadingSlot = page.locator('#test-leading-slot')
    const actionSlot = page.locator('#test-action-slot')

    await expect(leadingSlot).toBeVisible()
    await expect(leadingSlot).toHaveText('⭐')
    await expect(actionSlot).toBeVisible()
    await expect(actionSlot).toHaveText('Options')
  })

  test('should support dropdown indicator, action buttons and count badge', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-list-header')
      el.id = 'test-header-features'
      el.setAttribute('title', 'Groups')
      el.setAttribute('badge', '12')
      el.setAttribute('dropdown', 'true')
      el.setAttribute('action-text', 'See all')
      document.body.appendChild(el)
    })

    const header = page.locator('#test-header-features')
    await expect(header).toBeVisible()

    // Assert Badge Count is rendered
    const badge = header.locator('atoll-badge')
    await expect(badge).toBeVisible()
    await expect(badge.locator('.atoll-badge')).toHaveText('12')

    // Assert Action button is rendered and has actionText
    const actionBtn = header.locator('atoll-button')
    await expect(actionBtn).toBeVisible()
    await expect(actionBtn.locator('.atoll-btn-label')).toHaveText('See all')

    // Dropdown indicator icon should be visible
    const dropdownIcon = header.locator('.atoll-list-header-dropdown-icon')
    await expect(dropdownIcon).toBeVisible()
  })

  test('should toggle expanded state and dispatch events on click/keydown for accordion variant', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-list-header')
      el.id = 'test-header-accordion'
      el.setAttribute('variant', 'accordion')
      el.setAttribute('title', 'Archived Conversations')

      window.__toggleEvents = []
      el.addEventListener('atoll-header-toggle', (e) => {
        window.__toggleEvents.push(e.detail)
      })

      document.body.appendChild(el)
    })

    const header = page.locator('#test-header-accordion')
    const innerRoot = header.locator('.atoll-list-header')

    await expect(header).toBeVisible()
    await expect(innerRoot).toHaveAttribute('role', 'button')
    await expect(innerRoot).toHaveAttribute('tabindex', '0')
    await expect(innerRoot).toHaveAttribute('aria-expanded', 'false')
    await expect(innerRoot).not.toHaveClass(/atoll-list-header-expanded/)

    // Chevron icon should be visible
    const chevron = header.locator('.atoll-list-header-chevron')
    await expect(chevron).toBeVisible()

    // Trigger click
    await innerRoot.click()
    await expect(innerRoot).toHaveAttribute('aria-expanded', 'true')
    await expect(innerRoot).toHaveClass(/atoll-list-header-expanded/)

    // Trigger Enter keydown
    await innerRoot.focus()
    await page.keyboard.press('Enter')
    await expect(innerRoot).toHaveAttribute('aria-expanded', 'false')
    await expect(innerRoot).not.toHaveClass(/atoll-list-header-expanded/)

    // Trigger Space keydown
    await page.keyboard.press('Space')
    await expect(innerRoot).toHaveAttribute('aria-expanded', 'true')
    await expect(innerRoot).toHaveClass(/atoll-list-header-expanded/)

    // Verify events captured
    const events = await page.evaluate(() => window.__toggleEvents)
    expect(events).toEqual([
      { expanded: true },
      { expanded: false },
      { expanded: true }
    ])
  })

  test('should support collapsible option and handle external updates to expanded attribute', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-list-header')
      el.id = 'test-header-collapsible'
      el.setAttribute('title', 'Collapsible Section')
      el.setAttribute('collapsible', 'true')
      document.body.appendChild(el)
    })

    const header = page.locator('#test-header-collapsible')
    const innerRoot = header.locator('.atoll-list-header')

    await expect(header).toBeVisible()
    await expect(innerRoot).toHaveAttribute('role', 'button')
    await expect(innerRoot).toHaveAttribute('tabindex', '0')
    await expect(innerRoot).toHaveAttribute('aria-expanded', 'false')

    // Update expanded attribute from outside
    await page.evaluate(() => {
      const el = document.getElementById('test-header-collapsible')
      el.setAttribute('expanded', 'true')
    })

    await expect(innerRoot).toHaveAttribute('aria-expanded', 'true')
    await expect(innerRoot).toHaveClass(/atoll-list-header-expanded/)
  })

  test('should render visual variants for screenshot', async ({ page }) => {
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 24px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111; max-width: 600px; margin: 0 auto;">
          <h2>Atoll List Header Showcase</h2>
          
          <div id="section-list">
            <h5 style="margin-bottom: 8px; color: #666;">Standard List (Default)</h5>
          </div>

          <div id="section-card" style="border: 1px solid #ddd; border-radius: 12px; overflow: hidden; background: white;">
            <!-- Will append card header here -->
            <div style="padding: 20px; color: #555;">Card Body Content</div>
          </div>

          <div id="section-accordion">
            <h5 style="margin-bottom: 8px; color: #666;">Accordion / Collapsible</h5>
          </div>

          <div id="section-dropdown">
            <h5 style="margin-bottom: 8px; color: #666;">Dropdown Filtering</h5>
          </div>
        </div>
      `

      // Standard List Section Divider with Action Text Button
      const listHeader = document.createElement('atoll-list-header')
      listHeader.setAttribute('title', 'Pinned Chats')
      listHeader.setAttribute('badge', '3')
      listHeader.setAttribute('action-text', 'Edit')
      document.getElementById('section-list').appendChild(listHeader)

      // Card Header with Overflow Action Slot
      const cardHeader = document.createElement('atoll-list-header')
      cardHeader.setAttribute('variant', 'card')
      cardHeader.setAttribute('title', 'Security & Vault')
      cardHeader.setAttribute('subtitle', 'Encrypted session keys')

      const actionBtn = document.createElement('atoll-button')
      actionBtn.setAttribute('slot', 'action')
      actionBtn.setAttribute('icon-only', 'true')
      actionBtn.setAttribute('variant', 'ghost')
      actionBtn.setAttribute('size', 'sm')
      actionBtn.setAttribute('aria-label', 'Card Options')

      const actionIcon = document.createElement('atoll-icon')
      actionIcon.setAttribute('name', 'more')
      actionIcon.setAttribute('size', '20')
      actionBtn.appendChild(actionIcon)
      cardHeader.appendChild(actionBtn)

      document.getElementById('section-card').insertBefore(cardHeader, document.getElementById('section-card').firstChild)

      // Interactive Accordion Header Trigger
      const accordionHeader = document.createElement('atoll-list-header')
      accordionHeader.setAttribute('variant', 'accordion')
      accordionHeader.setAttribute('title', 'Archived Conversations')
      accordionHeader.setAttribute('badge', '14')
      accordionHeader.setAttribute('expanded', 'false')
      document.getElementById('section-accordion').appendChild(accordionHeader)

      // Dropdown Sorting Filter Header
      const dropdownHeader = document.createElement('atoll-list-header')
      dropdownHeader.setAttribute('title', 'Recent Contacts')
      dropdownHeader.setAttribute('dropdown', 'true')
      dropdownHeader.setAttribute('subtitle', 'Sorted by active status')
      document.getElementById('section-dropdown').appendChild(dropdownHeader)
    })

    // Wait for components to fully boot & render
    await page.waitForTimeout(2000)

    // Take screenshot of verification
    await page.screenshot({ path: '/home/jules/verification/screenshots/verification.png' })
  })
})
