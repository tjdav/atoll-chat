import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-checkbox Component Tests', () => {
  test('should render checkbox with default attributes, accessibility roles, and composed icon', async ({ page, mountComponent }) => {
    await mountComponent('atoll-checkbox', {})

    const checkboxHost = page.locator('#test-component-root')
    const wrapper = checkboxHost.locator('.atoll-checkbox')
    const nativeInput = checkboxHost.locator('input[type="checkbox"]')
    const icon = checkboxHost.locator('atoll-icon')

    await expect(checkboxHost).toBeVisible()
    await expect(checkboxHost).toHaveAttribute('role', 'checkbox')
    await expect(checkboxHost).toHaveAttribute('aria-checked', 'false')
    await expect(checkboxHost).toHaveAttribute('tabindex', '0')

    await expect(wrapper).toBeVisible()
    await expect(nativeInput).toBeAttached()
    await expect(nativeInput).not.toBeChecked()

    await expect(icon).toBeVisible()
    await expect(icon).toHaveAttribute('name', 'check')
    await expect(icon).toHaveAttribute('size', '22')
    await expect(icon).toHaveAttribute('active', 'false')
  })

  test('should toggle checked state on click and dispatch change and input events', async ({ page, mountComponent }) => {
    await mountComponent('atoll-checkbox', {})

    const checkboxHost = page.locator('#test-component-root')
    const wrapper = checkboxHost.locator('.atoll-checkbox')

    await page.evaluate(() => {
      window.__events = []
      const el = document.getElementById('test-component-root')
      el.addEventListener('change', (e) => window.__events.push({ type: 'change', checked: e.detail.checked }))
      el.addEventListener('input', (e) => window.__events.push({ type: 'input', checked: e.detail.checked }))
    })

    await wrapper.click()
    await expect(checkboxHost).toHaveAttribute('aria-checked', 'true')
    await expect(checkboxHost).toHaveAttribute('checked', '')

    const events = await page.evaluate(() => window.__events)
    expect(events).toEqual([
      { type: 'change', checked: true },
      { type: 'input', checked: true }
    ])

    await wrapper.click()
    await expect(checkboxHost).toHaveAttribute('aria-checked', 'false')
    await expect(checkboxHost).not.toHaveAttribute('checked', '')
  })

  test('should toggle checked state on keyboard interaction (Space and Enter)', async ({ page, mountComponent }) => {
    await mountComponent('atoll-checkbox', {})

    const checkboxHost = page.locator('#test-component-root')
    await checkboxHost.focus()

    await page.keyboard.press('Space')
    await expect(checkboxHost).toHaveAttribute('aria-checked', 'true')

    await page.keyboard.press('Enter')
    await expect(checkboxHost).toHaveAttribute('aria-checked', 'false')
  })

  test('should handle disabled state and prevent toggle interactions', async ({ page, mountComponent }) => {
    await mountComponent('atoll-checkbox', {
      disabled: 'true'
    })

    const checkboxHost = page.locator('#test-component-root')
    const wrapper = checkboxHost.locator('.atoll-checkbox')

    await expect(checkboxHost).toHaveAttribute('tabindex', '-1')

    await wrapper.click({ force: true })
    await expect(checkboxHost).toHaveAttribute('aria-checked', 'false')
  })

  test('should support programmatic property mutations and methods (checked, disabled, toggle)', async ({ page, mountComponent }) => {
    await mountComponent('atoll-checkbox', {})

    const checkboxHost = page.locator('#test-component-root')

    await page.evaluate(() => {
      window.__events = []
      const el = document.getElementById('test-component-root')
      el.addEventListener('change', (e) => window.__events.push({ type: 'change', checked: e.detail.checked }))
      el.addEventListener('input', (e) => window.__events.push({ type: 'input', checked: e.detail.checked }))
    })

    // Programmatic checked assignment does NOT dispatch events
    await checkboxHost.evaluate(el => { el.checked = true })
    await expect(checkboxHost).toHaveAttribute('aria-checked', 'true')
    let events = await page.evaluate(() => window.__events)
    expect(events).toEqual([])

    // Explicit .toggle() DOES dispatch events
    await checkboxHost.evaluate(el => el.toggle())
    await expect(checkboxHost).toHaveAttribute('aria-checked', 'false')
    events = await page.evaluate(() => window.__events)
    expect(events).toEqual([
      { type: 'change', checked: false },
      { type: 'input', checked: false }
    ])

    // Programmatic disabled property setter
    await checkboxHost.evaluate(el => { el.disabled = true })
    await expect(checkboxHost).toHaveAttribute('tabindex', '-1')
    await expect(checkboxHost).toHaveAttribute('disabled', '')
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
      title.textContent = 'atoll-checkbox Visual Verification Matrix'
      matrix.appendChild(title)

      // Section 1: Standard States (Unchecked, Checked, Hover Focus)
      const standardRow = document.createElement('div')
      standardRow.style.cssText = 'display: flex; align-items: center; gap: 24px;'

      const cb1 = document.createElement('atoll-checkbox')
      cb1.setAttribute('label', 'Unchecked Checkbox')

      const cb2 = document.createElement('atoll-checkbox')
      cb2.setAttribute('checked', 'true')
      cb2.setAttribute('label', 'Checked Checkbox')

      standardRow.appendChild(cb1)
      standardRow.appendChild(cb2)
      matrix.appendChild(standardRow)

      // Section 2: Custom Sizes and Icons
      const customRow = document.createElement('div')
      customRow.style.cssText = 'display: flex; align-items: center; gap: 24px;'

      const cb3 = document.createElement('atoll-checkbox')
      cb3.setAttribute('size', '28')
      cb3.setAttribute('checked', 'true')

      const cb4 = document.createElement('atoll-checkbox')
      cb4.setAttribute('size', '32')
      cb4.setAttribute('name', 'pin')
      cb4.setAttribute('checked', 'true')

      customRow.appendChild(cb3)
      customRow.appendChild(cb4)
      matrix.appendChild(customRow)

      // Section 3: Disabled States
      const disabledRow = document.createElement('div')
      disabledRow.style.cssText = 'display: flex; align-items: center; gap: 24px;'

      const cb5 = document.createElement('atoll-checkbox')
      cb5.setAttribute('disabled', 'true')

      const cb6 = document.createElement('atoll-checkbox')
      cb6.setAttribute('checked', 'true')
      cb6.setAttribute('disabled', 'true')

      disabledRow.appendChild(cb5)
      disabledRow.appendChild(cb6)
      matrix.appendChild(disabledRow)

      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('checkbox-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('checkbox-verification-dark', matrix)
  })
})
