import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Checkbox Component Architecture', () => {
  test.beforeEach(async ({ page, context }) => {
    // Seed localStorage with mock instance ID to prevent background conflict reloads
    await context.addInitScript(() => {
      window.localStorage.setItem('atoll_active_instance_id', 'mock_test_instance_123')
    })
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
    await page.evaluate(() => {
      let sandbox = document.getElementById('test-sandbox')

      if (sandbox) {
        sandbox.innerHTML = ''
      } else {
        sandbox = document.createElement('div')
        sandbox.id = 'test-sandbox'
        sandbox.style.position = 'fixed'
        sandbox.style.top = '0'
        sandbox.style.left = '0'
        sandbox.style.right = '0'
        sandbox.style.bottom = '0'
        sandbox.style.backgroundColor = '#f8f9fa'
        sandbox.style.zIndex = '9999999'
        sandbox.style.overflowY = 'auto'
        document.body.appendChild(sandbox)
      }
    })
  })

  test('should render checkbox with default attributes and states', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const checkbox = document.createElement('atoll-checkbox')
      checkbox.id = 'test-checkbox-default'
      sandbox.appendChild(checkbox)

      await customElements.whenDefined('atoll-checkbox')
    })

    const cb = page.locator('#test-checkbox-default')
    await expect(cb).toBeVisible()

    // Assert initial accessibility roles/attributes and default attributes
    await expect(cb).toHaveAttribute('role', 'checkbox')
    await expect(cb).toHaveAttribute('aria-checked', 'false')
    await expect(cb).toHaveAttribute('tabindex', '0')

    const wrapper = cb.locator('.atoll-checkbox')
    await expect(wrapper).toBeVisible()
    await expect(wrapper).not.toHaveClass(/checked/)
    await expect(wrapper).not.toHaveClass(/disabled/)

    // Check inner native input fields
    const nativeInput = cb.locator('input[type="checkbox"]')
    await expect(nativeInput).toBeAttached()
    await expect(nativeInput).not.toBeChecked()
    await expect(nativeInput).not.toBeDisabled()
    await expect(nativeInput).toHaveAttribute('aria-label', 'Toggle selection')

    // Check custom icon renders with default size 22
    const icon = cb.locator('atoll-icon')
    await expect(icon).toBeVisible()
    await expect(icon).toHaveAttribute('name', 'check')
    await expect(icon).toHaveAttribute('size', '22')
    await expect(icon).toHaveAttribute('active', 'false')
  })

  test('should support custom attribute overrides', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const checkbox = document.createElement('atoll-checkbox')
      checkbox.id = 'test-checkbox-custom'
      checkbox.setAttribute('size', '30')
      checkbox.setAttribute('name', 'settings')
      checkbox.setAttribute('label', 'Custom Setting Check')
      checkbox.setAttribute('checked', 'true')
      checkbox.setAttribute('disabled', 'true')
      sandbox.appendChild(checkbox)

      await customElements.whenDefined('atoll-checkbox')
    })

    const cb = page.locator('#test-checkbox-custom')
    await expect(cb).toBeVisible()

    // ARIA / Interactive state matching
    await expect(cb).toHaveAttribute('aria-checked', 'true')
    await expect(cb).toHaveAttribute('tabindex', '-1')

    const wrapper = cb.locator('.atoll-checkbox')
    await expect(wrapper).toHaveClass(/checked/)
    await expect(wrapper).toHaveClass(/disabled/)

    const nativeInput = cb.locator('input[type="checkbox"]')
    await expect(nativeInput).toBeChecked()
    await expect(nativeInput).toBeDisabled()
    await expect(nativeInput).toHaveAttribute('aria-label', 'Custom Setting Check')

    const icon = cb.locator('atoll-icon')
    await expect(icon).toHaveAttribute('name', 'settings')
    await expect(icon).toHaveAttribute('size', '30')
    await expect(icon).toHaveAttribute('active', 'true')
  })

  test('should support click interactions to toggle state and dispatch events', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const checkbox = document.createElement('atoll-checkbox')
      checkbox.id = 'test-checkbox-interactive'
      sandbox.appendChild(checkbox)

      window.checkboxEvents = []
      checkbox.addEventListener('change', (e) => {
        window.checkboxEvents.push({
          type: 'change',
          checked: e.detail.checked
        })
      })
      checkbox.addEventListener('input', (e) => {
        window.checkboxEvents.push({
          type: 'input',
          checked: e.detail.checked
        })
      })

      await customElements.whenDefined('atoll-checkbox')
    })

    const cb = page.locator('#test-checkbox-interactive')
    const wrapper = cb.locator('.atoll-checkbox')

    // Initial assertions
    await expect(cb).toHaveAttribute('aria-checked', 'false')
    await expect(wrapper).not.toHaveClass(/checked/)

    // Trigger click on wrapper
    await wrapper.click()

    // Assert state toggled to checked
    await expect(cb).toHaveAttribute('aria-checked', 'true')
    await expect(wrapper).toHaveClass(/checked/)

    let events = await page.evaluate(() => window.checkboxEvents)
    expect(events).toContainEqual({
      type: 'change',
      checked: true
    })
    expect(events).toContainEqual({
      type: 'input',
      checked: true
    })

    // Trigger click again to toggle off
    await wrapper.click()

    // Assert state toggled back to unchecked
    await expect(cb).toHaveAttribute('aria-checked', 'false')
    await expect(wrapper).not.toHaveClass(/checked/)

    events = await page.evaluate(() => window.checkboxEvents)
    expect(events).toContainEqual({
      type: 'change',
      checked: false
    })
    expect(events).toContainEqual({
      type: 'input',
      checked: false
    })
  })

  test('should support keyboard interactions (Enter & Space)', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const checkbox = document.createElement('atoll-checkbox')
      checkbox.id = 'test-checkbox-kbd'
      sandbox.appendChild(checkbox)

      await customElements.whenDefined('atoll-checkbox')
    })

    const cb = page.locator('#test-checkbox-kbd')
    const wrapper = cb.locator('.atoll-checkbox')

    // Trigger keydown Space via dispatchEvent
    await cb.dispatchEvent('keydown', { key: ' ' })
    await expect(cb).toHaveAttribute('aria-checked', 'true')
    await expect(wrapper).toHaveClass(/checked/)

    // Trigger keydown Enter via dispatchEvent
    await cb.dispatchEvent('keydown', { key: 'Enter' })
    await expect(cb).toHaveAttribute('aria-checked', 'false')
    await expect(wrapper).not.toHaveClass(/checked/)
  })

  test('should respect disabled status and block toggle interactions', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const checkbox = document.createElement('atoll-checkbox')
      checkbox.id = 'test-checkbox-disabled-int'
      checkbox.setAttribute('disabled', 'true')
      sandbox.appendChild(checkbox)

      window.disabledCheckboxEvents = []
      checkbox.addEventListener('change', (e) => {
        window.disabledCheckboxEvents.push(e.detail.checked)
      })

      await customElements.whenDefined('atoll-checkbox')
    })

    const cb = page.locator('#test-checkbox-disabled-int')
    const wrapper = cb.locator('.atoll-checkbox')

    await expect(cb).toHaveAttribute('tabindex', '-1')
    await expect(wrapper).toHaveClass(/disabled/)

    // Try clicking wrapper
    await wrapper.click({ force: true })

    // Check state has not changed
    await expect(cb).toHaveAttribute('aria-checked', 'false')
    await expect(wrapper).not.toHaveClass(/checked/)

    const events = await page.evaluate(() => window.disabledCheckboxEvents)
    expect(events.length).toBe(0)
  })

  test('should support programmatic getters and setters on the element instance', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const checkbox = document.createElement('atoll-checkbox')
      checkbox.id = 'test-checkbox-programmatic'
      sandbox.appendChild(checkbox)

      await customElements.whenDefined('atoll-checkbox')
    })

    const cb = page.locator('#test-checkbox-programmatic')

    // Test programmatic checked setter/getter
    let isChecked = await page.evaluate(() => {
      const el = document.getElementById('test-checkbox-programmatic')
      el.checked = true
      return el.checked
    })
    expect(isChecked).toBe(true)
    await expect(cb).toHaveAttribute('aria-checked', 'true')

    isChecked = await page.evaluate(() => {
      const el = document.getElementById('test-checkbox-programmatic')
      el.checked = false
      return el.checked
    })
    expect(isChecked).toBe(false)
    await expect(cb).toHaveAttribute('aria-checked', 'false')

    // Test programmatic disabled setter/getter
    let isDisabled = await page.evaluate(() => {
      const el = document.getElementById('test-checkbox-programmatic')
      el.disabled = true
      return el.disabled
    })
    expect(isDisabled).toBe(true)
    await expect(cb).toHaveAttribute('tabindex', '-1')

    isDisabled = await page.evaluate(() => {
      const el = document.getElementById('test-checkbox-programmatic')
      el.disabled = false
      return el.disabled
    })
    expect(isDisabled).toBe(false)
    await expect(cb).toHaveAttribute('tabindex', '0')
  })

  test('should support attribute observation changes reactively', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')
      const checkbox = document.createElement('atoll-checkbox')
      checkbox.id = 'test-checkbox-obs'
      sandbox.appendChild(checkbox)

      await customElements.whenDefined('atoll-checkbox')
    })

    const cb = page.locator('#test-checkbox-obs')
    const wrapper = cb.locator('.atoll-checkbox')

    // Set 'checked' attribute
    await page.evaluate(() => {
      document.getElementById('test-checkbox-obs').setAttribute('checked', 'true')
    })
    await expect(cb).toHaveAttribute('aria-checked', 'true')
    await expect(wrapper).toHaveClass(/checked/)

    // Remove 'checked' attribute
    await page.evaluate(() => {
      document.getElementById('test-checkbox-obs').removeAttribute('checked')
    })
    await expect(cb).toHaveAttribute('aria-checked', 'false')
    await expect(wrapper).not.toHaveClass(/checked/)

    // Set 'disabled' attribute
    await page.evaluate(() => {
      document.getElementById('test-checkbox-obs').setAttribute('disabled', 'true')
    })
    await expect(cb).toHaveAttribute('tabindex', '-1')

    // Remove 'disabled' attribute
    await page.evaluate(() => {
      document.getElementById('test-checkbox-obs').removeAttribute('disabled')
    })
    await expect(cb).toHaveAttribute('tabindex', '0')
  })

  test('should render visual matrix of checkbox states for screenshot', async ({ page }) => {
    await page.evaluate(async () => {
      const sandbox = document.getElementById('test-sandbox')

      // Pre-load component dependencies
      document.createElement('atoll-checkbox')
      document.createElement('atoll-icon')

      await customElements.whenDefined('atoll-checkbox')
      await customElements.whenDefined('atoll-icon')

      sandbox.innerHTML = `
        <div id="visual-matrix" style="display: flex; flex-direction: column; gap: 24px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111; max-width: 480px; margin: 0 auto; border-radius: 8px; border: 1px solid #ddd;">
          <h2 style="font-size: 24px; font-weight: 700; margin-bottom: 4px; border-bottom: 2px solid #06C755; padding-bottom: 8px;">Atoll Checkbox State Matrix</h2>
          
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <atoll-checkbox id="matrix-unchecked"></atoll-checkbox>
              <label for="matrix-unchecked" style="font-size: 16px; font-weight: 500; cursor: pointer;">Unchecked (Default)</label>
            </div>

            <div style="display: flex; align-items: center; gap: 12px;">
              <atoll-checkbox id="matrix-checked" checked="true"></atoll-checkbox>
              <label for="matrix-checked" style="font-size: 16px; font-weight: 500; cursor: pointer;">Checked</label>
            </div>

            <div style="display: flex; align-items: center; gap: 12px;">
              <atoll-checkbox id="matrix-disabled-unchecked" disabled="true"></atoll-checkbox>
              <label for="matrix-disabled-unchecked" style="font-size: 16px; font-weight: 500; color: #aaa;">Disabled Unchecked</label>
            </div>

            <div style="display: flex; align-items: center; gap: 12px;">
              <atoll-checkbox id="matrix-disabled-checked" checked="true" disabled="true"></atoll-checkbox>
              <label for="matrix-disabled-checked" style="font-size: 16px; font-weight: 500; color: #aaa;">Disabled Checked</label>
            </div>

            <div style="display: flex; align-items: center; gap: 12px;">
              <atoll-checkbox id="matrix-custom" name="settings" size="32" checked="true"></atoll-checkbox>
              <label for="matrix-custom" style="font-size: 16px; font-weight: 500;">Custom Icon (settings) & Size (32px)</label>
            </div>
          </div>
        </div>
      `
    })

    await page.setViewportSize({
      width: 1000,
      height: 800
    })

    // Wait for elements to be fully hydrated
    await page.waitForTimeout(1000)

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Capture visual screenshot of full matrix container
    await matrix.screenshot({ path: 'tests/e2e/screenshots/checkbox_matrix.png' })
  })
})
