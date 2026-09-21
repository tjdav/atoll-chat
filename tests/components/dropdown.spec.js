import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-dropdown Component Tests', () => {
  test('should render dropdown toggle and slotted menu items', async ({ page, mountComponent }) => {
    await mountComponent('atoll-dropdown', { label: 'Actions' }, `
      <li><a class="atoll-dropdown-item" href="#">Profile</a></li>
      <li><a class="atoll-dropdown-item" href="#">Settings</a></li>
      <li><hr class="atoll-dropdown-divider"></li>
      <li><a class="atoll-dropdown-item" href="#">Sign out</a></li>
    `)

    const dropdownHost = page.locator('#test-component-root')
    const toggle = dropdownHost.locator('[data-testid="dropdown-toggle"]')
    const menu = dropdownHost.locator('[data-testid="dropdown-menu"]')
    const details = dropdownHost.locator('details')

    await expect(dropdownHost).toBeVisible()
    await expect(toggle).toContainText('Actions')
    await expect(menu.locator('.atoll-dropdown-item')).toHaveCount(3)

    // Initially closed
    await expect(details).not.toHaveAttribute('open', '')

    // Open on toggle click
    await toggle.click()
    await expect(details).toHaveAttribute('open', '')
    await expect(menu).toBeVisible()
  })

  test('should support size and placement modifiers', async ({ page, mountComponent }) => {
    await mountComponent('atoll-dropdown', { size: 'sm', placement: 'up', label: 'Save' }, `
      <li><a class="atoll-dropdown-item" href="#">Save draft</a></li>
    `)

    const dropdownHost = page.locator('#test-component-root')
    const toggle = dropdownHost.locator('[data-testid="dropdown-toggle"]')
    const menu = dropdownHost.locator('[data-testid="dropdown-menu"]')

    await expect(toggle).toHaveClass(/atoll-btn-sm/)
    await expect(menu).toHaveClass(/atoll-drop-up/)

    // Dynamically change attributes
    await dropdownHost.evaluate((el) => {
      el.setAttribute('size', 'lg')
      el.setAttribute('placement', 'end')
    })

    await expect(toggle).toHaveClass(/atoll-btn-lg/)
    await expect(menu).toHaveClass(/atoll-drop-end/)
  })

  test('should close menu when an item inside is clicked', async ({ page, mountComponent }) => {
    await mountComponent('atoll-dropdown', { label: 'Options', open: 'true' }, `
      <li><button class="atoll-dropdown-item" id="opt1">Option 1</button></li>
      <li><button class="atoll-dropdown-item" id="opt2">Option 2</button></li>
    `)

    const dropdownHost = page.locator('#test-component-root')
    const details = dropdownHost.locator('details')
    const opt1 = dropdownHost.locator('#opt1')

    await expect(details).toHaveAttribute('open', '')

    await opt1.click()
    await expect(details).not.toHaveAttribute('open', '')
  })

  test('should close menu on outside click and Escape key press', async ({ page, mountComponent }) => {
    await mountComponent('atoll-dropdown', { label: 'Menu', open: 'true' }, `
      <li><a class="atoll-dropdown-item" href="#">Item 1</a></li>
    `)

    const dropdownHost = page.locator('#test-component-root')
    const toggle = dropdownHost.locator('[data-testid="dropdown-toggle"]')
    const details = dropdownHost.locator('details')

    await expect(details).toHaveAttribute('open', '')

    // Escape closes and restores focus
    await page.keyboard.press('Escape')
    await expect(details).not.toHaveAttribute('open', '')
    await expect(toggle).toBeFocused()

    // Open again
    await toggle.click()
    await expect(details).toHaveAttribute('open', '')

    // Outside click closes menu
    await page.mouse.click(10, 10)
    await expect(details).not.toHaveAttribute('open', '')
  })

  test('should prevent interaction and remain closed when disabled', async ({ page, mountComponent }) => {
    await mountComponent('atoll-dropdown', { disabled: 'true', label: 'Disabled Menu' }, `
      <li><a class="atoll-dropdown-item" href="#">Item 1</a></li>
    `)

    const dropdownHost = page.locator('#test-component-root')
    const toggle = dropdownHost.locator('[data-testid="dropdown-toggle"]')
    const details = dropdownHost.locator('details')

    await toggle.click({ force: true })
    await expect(details).not.toHaveAttribute('open', '')
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
      matrix.style.cssText = 'display: flex; flex-direction: column; gap: 32px; padding: 48px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111); font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto;'

      const title = document.createElement('h2')
      title.style.cssText = 'margin: 0; font-size: 20px;'
      title.textContent = 'atoll-dropdown Visual Verification Matrix'
      matrix.appendChild(title)

      const group = document.createElement('div')
      group.style.cssText = 'display: flex; flex-direction: column; gap: 32px;'

      // Small Primary Dropdown
      const wrap1 = document.createElement('div')
      const label1 = document.createElement('label')
      label1.style.cssText = 'font-size: 13px; font-weight: 600; margin-bottom: 8px; display: block;'
      label1.textContent = 'Small Primary Dropdown (sm)'
      const drop1 = document.createElement('atoll-dropdown')
      drop1.setAttribute('size', 'sm')
      drop1.setAttribute('variant', 'primary')
      drop1.setAttribute('label', 'Small Primary')
      drop1.innerHTML = `
        <li><a class="atoll-dropdown-item" href="#">Action 1</a></li>
        <li><a class="atoll-dropdown-item" href="#">Action 2</a></li>
      `
      wrap1.appendChild(label1)
      wrap1.appendChild(drop1)
      group.appendChild(wrap1)

      // Medium Success Open State (Placement Down)
      const wrap2 = document.createElement('div')
      wrap2.style.cssText = 'padding-bottom: 160px;'
      const label2 = document.createElement('label')
      label2.style.cssText = 'font-size: 13px; font-weight: 600; margin-bottom: 8px; display: block;'
      label2.textContent = 'Medium Success Dropdown (Open State)'
      const drop2 = document.createElement('atoll-dropdown')
      drop2.setAttribute('variant', 'success')
      drop2.setAttribute('label', 'Success Open')
      drop2.setAttribute('open', 'true')
      drop2.innerHTML = `
        <li><a class="atoll-dropdown-item" href="#">Save Draft</a></li>
        <li><a class="atoll-dropdown-item" href="#">Publish</a></li>
        <li><hr class="atoll-dropdown-divider"></li>
        <li><a class="atoll-dropdown-item" href="#">Archive</a></li>
      `
      wrap2.appendChild(label2)
      wrap2.appendChild(drop2)
      group.appendChild(wrap2)

      // Danger Dropup Placement
      const wrap3 = document.createElement('div')
      wrap3.style.cssText = 'padding-top: 140px;'
      const label3 = document.createElement('label')
      label3.style.cssText = 'font-size: 13px; font-weight: 600; margin-bottom: 8px; display: block;'
      label3.textContent = 'Danger Dropup (Placement Up, Open State)'
      const drop3 = document.createElement('atoll-dropdown')
      drop3.setAttribute('variant', 'danger')
      drop3.setAttribute('placement', 'up')
      drop3.setAttribute('label', 'Danger Dropup')
      drop3.setAttribute('open', 'true')
      drop3.innerHTML = `
        <li><a class="atoll-dropdown-item" href="#">Delete Post</a></li>
        <li><a class="atoll-dropdown-item" href="#">Purge Data</a></li>
      `
      wrap3.appendChild(label3)
      wrap3.appendChild(drop3)
      group.appendChild(wrap3)

      // Disabled State
      const wrap4 = document.createElement('div')
      const label4 = document.createElement('label')
      label4.style.cssText = 'font-size: 13px; font-weight: 600; margin-bottom: 8px; display: block;'
      label4.textContent = 'Disabled Dropdown'
      const drop4 = document.createElement('atoll-dropdown')
      drop4.setAttribute('disabled', 'true')
      drop4.setAttribute('label', 'Disabled Options')
      wrap4.appendChild(label4)
      wrap4.appendChild(drop4)
      group.appendChild(wrap4)

      matrix.appendChild(group)
      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('dropdown-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('dropdown-verification-dark', matrix)
  })
})
