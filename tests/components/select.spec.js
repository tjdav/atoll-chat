import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-select Component Tests', () => {
  test('should render native details/summary combobox and handle option selection', async ({ page, mountComponent }) => {
    await mountComponent('atoll-select', { value: 'opt1' }, `
      <li><button class="dropdown-item" data-value="opt1">Option 1</button></li>
      <li><button class="dropdown-item" data-value="opt2">Option 2</button></li>
      <li><button class="dropdown-item" data-value="opt3">Option 3</button></li>
    `)

    const selectHost = page.locator('#test-component-root')
    const toggle = selectHost.locator('.atoll-select-toggle')
    const label = selectHost.locator('.atoll-select-label')
    const details = selectHost.locator('details.atoll-select')

    await expect(selectHost).toBeVisible()
    await expect(label).toContainText('Option 1')

    // Open dropdown
    await toggle.click()
    await expect(details).toHaveAttribute('open', '')

    // Select Option 2
    const opt2 = selectHost.locator('button[data-value="opt2"]')
    await opt2.click()

    await expect(label).toContainText('Option 2')
    await expect(details).not.toHaveAttribute('open', '')

    const updatedValue = await selectHost.evaluate(el => el.value)
    expect(updatedValue).toBe('opt2')
  })

  test('should support size modifiers (sm, md, lg)', async ({ page, mountComponent }) => {
    await mountComponent('atoll-select', { size: 'sm' }, `
      <option value="1">Small Option</option>
    `)

    const selectHost = page.locator('#test-component-root')
    const toggle = selectHost.locator('.atoll-select-toggle')

    await expect(toggle).toHaveCSS('font-size', '12px')

    // Update size to lg
    await selectHost.evaluate((el) => {
      el.setAttribute('size', 'lg')
    })
    await expect(toggle).toHaveCSS('font-size', '16px')
  })

  test('should prevent opening and interactions when disabled', async ({ page, mountComponent }) => {
    await mountComponent('atoll-select', { disabled: 'true' }, `
      <option value="1">Disabled Option</option>
    `)

    const selectHost = page.locator('#test-component-root')
    const toggle = selectHost.locator('.atoll-select-toggle')
    const details = selectHost.locator('details.atoll-select')

    await expect(toggle).toHaveAttribute('aria-disabled', 'true')
    await toggle.click({ force: true })

    await expect(details).not.toHaveAttribute('open', '')
  })

  test('should support WAI-ARIA APG keyboard navigation and Escape dismissal', async ({ page, mountComponent }) => {
    await mountComponent('atoll-select', {}, `
      <li><button class="dropdown-item" data-value="alpha">Alpha</button></li>
      <li><button class="dropdown-item" data-value="beta">Beta</button></li>
      <li><button class="dropdown-item" data-value="gamma">Gamma</button></li>
    `)

    const selectHost = page.locator('#test-component-root')
    const toggle = selectHost.locator('.atoll-select-toggle')
    const details = selectHost.locator('details.atoll-select')

    await toggle.focus()
    await page.keyboard.press('ArrowDown')
    await expect(details).toHaveAttribute('open', '')

    // Escape closes and restores focus
    await page.keyboard.press('Escape')
    await expect(details).not.toHaveAttribute('open', '')
  })

  test('should support icon slots and leading-icon attribute', async ({ page, mountComponent }) => {
    await mountComponent('atoll-select', { 'leading-icon': 'settings' }, `
      <li><button class="dropdown-item" data-value="1">Settings Option</button></li>
    `)

    const selectHost = page.locator('#test-component-root')
    const leadingIcon = selectHost.locator('.atoll-select-leading atoll-icon')
    await expect(leadingIcon).toBeVisible()
    await expect(leadingIcon).toHaveAttribute('name', 'settings')
  })

  test('should synchronize hidden input and fire native input/change events', async ({ page, mountComponent }) => {
    await mountComponent('atoll-select', { name: 'select_field', value: 'v1' }, `
      <li><button class="dropdown-item" data-value="v1">Val 1</button></li>
      <li><button class="dropdown-item" data-value="v2">Val 2</button></li>
    `)

    const selectHost = page.locator('#test-component-root')
    const hiddenInput = selectHost.locator('input[type="hidden"]')

    await expect(hiddenInput).toHaveAttribute('name', 'select_field')
    await expect(hiddenInput).toHaveValue('v1')

    await page.evaluate(() => {
      window.__inputFired = false
      window.__changeFired = false
      const input = document.querySelector('#test-component-root input[type="hidden"]')
      input.addEventListener('input', () => { window.__inputFired = true })
      input.addEventListener('change', () => { window.__changeFired = true })
    })

    const toggle = selectHost.locator('.atoll-select-toggle')
    await toggle.click()
    const opt2 = selectHost.locator('button[data-value="v2"]')
    await opt2.click()

    await expect(hiddenInput).toHaveValue('v2')
    const eventsFired = await page.evaluate(() => ({
      input: window.__inputFired,
      change: window.__changeFired
    }))
    expect(eventsFired.input).toBe(true)
    expect(eventsFired.change).toBe(true)
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
      title.textContent = 'atoll-select Visual Verification Matrix'
      matrix.appendChild(title)

      const group = document.createElement('div')
      group.style.cssText = 'display: flex; flex-direction: column; gap: 32px;'

      // Small Select
      const wrap1 = document.createElement('div')
      const label1 = document.createElement('label')
      label1.style.cssText = 'font-size: 13px; font-weight: 600; margin-bottom: 8px; display: block;'
      label1.textContent = 'Small Select (sm)'
      const sel1 = document.createElement('atoll-select')
      sel1.setAttribute('size', 'sm')
      sel1.setAttribute('value', 'sm-1')
      sel1.innerHTML = `
        <li><button class="dropdown-item" data-value="sm-1">Compact Option 1</button></li>
        <li><button class="dropdown-item" data-value="sm-2">Compact Option 2</button></li>
      `
      wrap1.appendChild(label1)
      wrap1.appendChild(sel1)
      group.appendChild(wrap1)

      // Medium Select Open State (opens downward with auto-flip disabled)
      const wrap2 = document.createElement('div')
      wrap2.style.cssText = 'padding-bottom: 160px;'
      const label2 = document.createElement('label')
      label2.style.cssText = 'font-size: 13px; font-weight: 600; margin-bottom: 8px; display: block;'
      label2.textContent = 'Medium Select (Default md, Open State)'
      const sel2 = document.createElement('atoll-select')
      sel2.setAttribute('value', 'md-1')
      sel2.setAttribute('open', 'true')
      sel2.setAttribute('auto-flip', 'false')
      sel2.setAttribute('placement', 'down')
      sel2.innerHTML = `
        <li><button class="dropdown-item" data-value="md-1">Default Option 1</button></li>
        <li><button class="dropdown-item" data-value="md-2">Default Option 2</button></li>
        <li><button class="dropdown-item" data-value="md-3">Default Option 3</button></li>
      `
      wrap2.appendChild(label2)
      wrap2.appendChild(sel2)
      group.appendChild(wrap2)

      // Disabled Select
      const wrap3 = document.createElement('div')
      const label3 = document.createElement('label')
      label3.style.cssText = 'font-size: 13px; font-weight: 600; margin-bottom: 8px; display: block;'
      label3.textContent = 'Disabled Select'
      const sel3 = document.createElement('atoll-select')
      sel3.setAttribute('disabled', 'true')
      sel3.setAttribute('placeholder', 'Cannot Select')
      wrap3.appendChild(label3)
      wrap3.appendChild(sel3)
      group.appendChild(wrap3)

      matrix.appendChild(group)
      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('select-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('select-verification-dark', matrix)
  })
})
