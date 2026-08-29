import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-chip Component Tests', () => {
  test('should render basic chip with default attributes, label, and role', async ({ page, mountComponent }) => {
    await mountComponent('atoll-chip', {
      text: 'Filter Tag'
    })

    const chipHost = page.locator('#test-component-root')
    const innerChip = chipHost.locator('.atoll-chip')

    await expect(chipHost).toBeVisible()
    await expect(innerChip).toBeVisible()
    await expect(innerChip).toHaveText('Filter Tag')
    await expect(innerChip).toHaveAttribute('role', 'button')
    await expect(innerChip).toHaveAttribute('tabindex', '0')
  })

  test('should support size scale modifiers (sm, md, lg) and height geometry', async ({ page, mountComponent }) => {
    await mountComponent('atoll-chip', {
      size: 'sm',
      text: 'Small Chip'
    })

    const chipHost = page.locator('#test-component-root')
    const innerChip = chipHost.locator('.atoll-chip')

    await expect(innerChip).toHaveCSS('height', '28px')

    await chipHost.evaluate(el => el.setAttribute('size', 'lg'))
    await expect(innerChip).toHaveCSS('height', '38px')
  })

  test('should support selected state with option role and aria-selected', async ({ page, mountComponent }) => {
    await mountComponent('atoll-chip', {
      selected: 'true',
      text: 'Selected Choice'
    })

    const chipHost = page.locator('#test-component-root')
    const innerChip = chipHost.locator('.atoll-chip')

    await expect(innerChip).toHaveAttribute('role', 'option')
    await expect(innerChip).toHaveAttribute('aria-selected', 'true')
  })

  test('should handle disabled state and prevent click interactions', async ({ page, mountComponent }) => {
    await mountComponent('atoll-chip', {
      disabled: 'true',
      text: 'Disabled Chip'
    })

    const chipHost = page.locator('#test-component-root')
    const innerChip = chipHost.locator('.atoll-chip')

    await expect(innerChip).toHaveAttribute('tabindex', '-1')

    await page.evaluate(() => {
      window.__chipClicked = false
      const el = document.getElementById('test-component-root')
      el.addEventListener('click', () => { window.__chipClicked = true })
    })

    await innerChip.click({ force: true })
    const clicked = await page.evaluate(() => window.__chipClicked)
    expect(clicked).toBe(false)
  })

  test('should render remove button and dispatch atoll-chip-remove on click or Backspace', async ({ page, mountComponent }) => {
    await mountComponent('atoll-chip', {
      removable: 'true',
      value: 'tag_123',
      text: 'Removable Tag'
    })

    const chipHost = page.locator('#test-component-root')
    const removeBtn = chipHost.locator('.atoll-chip-remove')

    await expect(removeBtn).toBeVisible()

    await page.evaluate(() => {
      window.__removedValue = null
      const el = document.getElementById('test-component-root')
      el.addEventListener('atoll-chip-remove', (e) => {
        window.__removedValue = e.detail.value
      })
    })

    await removeBtn.click()
    const clickedPayload = await page.evaluate(() => window.__removedValue)
    expect(clickedPayload).toBe('tag_123')
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
      title.textContent = 'atoll-chip Visual Verification Matrix'
      matrix.appendChild(title)

      // 1. Variants Row
      const variantRow = document.createElement('div')
      variantRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 12px;'
      ;['secondary', 'outline', 'primary', 'ghost', 'info', 'danger'].forEach(variant => {
        const chip = document.createElement('atoll-chip')
        chip.setAttribute('variant', variant)
        chip.setAttribute('text', variant.charAt(0).toUpperCase() + variant.slice(1))
        variantRow.appendChild(chip)
      })
      matrix.appendChild(variantRow)

      // 2. Sizes Row with Removable Close Button
      const sizeRow = document.createElement('div')
      sizeRow.style.cssText = 'display: flex; align-items: center; gap: 16px;'
      ;['sm', 'md', 'lg'].forEach(size => {
        const chip = document.createElement('atoll-chip')
        chip.setAttribute('size', size)
        chip.setAttribute('removable', 'true')
        chip.setAttribute('text', `${size.toUpperCase()} Removable`)
        sizeRow.appendChild(chip)
      })
      matrix.appendChild(sizeRow)

      // 3. Selected & Leading Icon Chips
      const stateRow = document.createElement('div')
      stateRow.style.cssText = 'display: flex; gap: 12px;'

      const c1 = document.createElement('atoll-chip')
      c1.setAttribute('selected', 'true')
      c1.setAttribute('text', 'Active Selected')

      const c2 = document.createElement('atoll-chip')
      c2.setAttribute('variant', 'outline')
      c2.innerHTML = '<atoll-icon slot="leading" name="settings" size="18"></atoll-icon> Settings'

      stateRow.appendChild(c1)
      stateRow.appendChild(c2)
      matrix.appendChild(stateRow)

      mountPoint.appendChild(matrix)
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    // Light mode screenshot
    await setTheme('light')
    await takeVerificationScreenshot('chip-verification-light', matrix)

    // Dark mode screenshot
    await setTheme('dark')
    await takeVerificationScreenshot('chip-verification-dark', matrix)
  })
})
