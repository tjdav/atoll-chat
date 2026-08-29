import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-list-header Component Tests', () => {
  test('should render list variant by default with title and subtitle', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list-header', {
      title: 'Pinned Chats',
      subtitle: 'Important conversations'
    })

    const headerHost = page.locator('#test-component-root')
    const innerHeader = headerHost.locator('.atoll-list-header')

    await expect(headerHost).toBeVisible()
    await expect(innerHeader).toBeVisible()
    await expect(innerHeader).toHaveText(/Pinned Chats/)
    await expect(innerHeader).toHaveText(/Important conversations/)
  })

  test('should render card variant with embedded background and rounded corners', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list-header', {
      variant: 'card',
      title: 'Security & Vault'
    })

    const headerHost = page.locator('#test-component-root')
    await expect(headerHost).toHaveAttribute('variant', 'card')
    await expect(headerHost.locator('.atoll-list-header')).toHaveText(/Security & Vault/)
  })

  test('should support composed badge, dropdown indicator, and actionText button', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list-header', {
      title: 'Groups',
      badge: '12',
      dropdown: 'true',
      'action-text': 'See all'
    })

    const headerHost = page.locator('#test-component-root')
    const badge = headerHost.locator('atoll-badge')
    const dropdownIcon = headerHost.locator('.atoll-list-header-dropdown-icon atoll-icon')
    const actionBtn = headerHost.locator('atoll-button')

    await expect(badge).toBeVisible()
    await expect(badge.locator('.atoll-badge')).toHaveText('12')
    await expect(dropdownIcon).toBeVisible()
    await expect(actionBtn).toBeVisible()
    await expect(actionBtn).toHaveText(/See all/)
  })

  test('should handle slot projections correctly', async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await page.evaluate(() => {
      const mountPoint = document.getElementById('test-component-root') || document.createElement('div')
      mountPoint.id = 'test-component-root'
      if (!mountPoint.parentElement) document.body.appendChild(mountPoint)

      const el = document.createElement('atoll-list-header')
      el.setAttribute('title', 'My Section')

      const leading = document.createElement('span')
      leading.setAttribute('slot', 'leading')
      leading.id = 'test-leading-slot'
      leading.innerText = '⭐'
      el.appendChild(leading)

      const action = document.createElement('button')
      action.setAttribute('slot', 'action')
      action.id = 'test-action-slot'
      action.innerText = 'Options'
      el.appendChild(action)

      mountPoint.appendChild(el)
    })

    const leadingSlot = page.locator('#test-leading-slot')
    const actionSlot = page.locator('#test-action-slot')

    await expect(leadingSlot).toBeVisible()
    await expect(leadingSlot).toHaveText('⭐')
    await expect(actionSlot).toBeVisible()
    await expect(actionSlot).toHaveText('Options')
  })

  test('should handle accordion toggle interaction, ARIA attributes, and events', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list-header', {
      variant: 'accordion',
      title: 'Archived Conversations'
    })

    const headerHost = page.locator('#test-component-root')
    const innerHeader = headerHost.locator('.atoll-list-header')
    const chevron = headerHost.locator('.atoll-list-header-chevron atoll-icon')

    await expect(innerHeader).toHaveAttribute('role', 'button')
    await expect(innerHeader).toHaveAttribute('aria-expanded', 'false')
    await expect(chevron).toBeVisible()

    await page.evaluate(() => {
      window.__toggleEvents = []
      const el = document.getElementById('test-component-root')
      el.addEventListener('atoll-header-toggle', (e) => {
        window.__toggleEvents.push(e.detail.expanded)
      })
    })

    await innerHeader.click()
    await expect(innerHeader).toHaveAttribute('aria-expanded', 'true')
    await expect(headerHost).toHaveAttribute('expanded', '')

    await innerHeader.focus()
    await page.keyboard.press('Enter')
    await expect(innerHeader).toHaveAttribute('aria-expanded', 'false')
    await expect(headerHost).not.toHaveAttribute('expanded', '')

    await page.keyboard.press('Space')
    await expect(innerHeader).toHaveAttribute('aria-expanded', 'true')
    await expect(headerHost).toHaveAttribute('expanded', '')

    const toggleResult = await page.evaluate(() => window.__toggleEvents)
    expect(toggleResult).toEqual([true, false, true])
  })

  test('should support size modifiers (sm, md, lg)', async ({ page, mountComponent }) => {
    await mountComponent('atoll-list-header', {
      title: 'Size Test',
      size: 'sm'
    })

    const headerHost = page.locator('#test-component-root')
    const innerHeader = headerHost.locator('.atoll-list-header')

    await expect(innerHeader).toHaveCSS('min-height', '36px')

    await headerHost.evaluate(el => el.setAttribute('size', 'lg'))
    await expect(innerHeader).toHaveCSS('min-height', '52px')
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
      matrix.style.cssText = 'display: flex; flex-direction: column; gap: 24px; padding: 32px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif; max-width: 500px; margin: 0 auto;'

      const title = document.createElement('h2')
      title.style.cssText = 'margin: 0; font-size: 20px;'
      title.textContent = 'atoll-list-header Visual Verification Matrix'
      matrix.appendChild(title)

      // 1. Standard List Section with Badge and Action Text
      const h1 = document.createElement('atoll-list-header')
      h1.setAttribute('title', 'Pinned Chats')
      h1.setAttribute('badge', '3')
      h1.setAttribute('action-text', 'Edit')
      matrix.appendChild(h1)

      // 2. Dropdown Filter Header with Subtitle
      const h2 = document.createElement('atoll-list-header')
      h2.setAttribute('title', 'Recent Contacts')
      h2.setAttribute('dropdown', 'true')
      h2.setAttribute('subtitle', 'Sorted by active status')
      matrix.appendChild(h2)

      // 3. Card Header
      const card = document.createElement('div')
      card.style.cssText = 'border: 1px solid var(--atoll-border-subtle, #DFDFDF); border-radius: 12px; overflow: hidden; background: var(--atoll-bg-surface-primary, #FFFFFF);'
      const h3 = document.createElement('atoll-list-header')
      h3.setAttribute('variant', 'card')
      h3.setAttribute('title', 'Security & Vault')
      h3.setAttribute('subtitle', 'Encrypted session keys')
      card.appendChild(h3)
      matrix.appendChild(card)

      // 4. Accordion Headers (Collapsed & Expanded)
      const h4 = document.createElement('atoll-list-header')
      h4.setAttribute('variant', 'accordion')
      h4.setAttribute('title', 'Archived Conversations')
      h4.setAttribute('badge', '14')
      matrix.appendChild(h4)

      const h5 = document.createElement('atoll-list-header')
      h5.setAttribute('variant', 'accordion')
      h5.setAttribute('title', 'Expanded Section')
      h5.setAttribute('expanded', 'true')
      matrix.appendChild(h5)

      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('list-header-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('list-header-verification-dark', matrix)
  })
})
