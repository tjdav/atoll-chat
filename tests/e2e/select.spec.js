import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Select Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render visual variants, sizes and forward test-id', async ({ page }) => {
    await page.evaluate(() => {
      const select = document.createElement('atoll-select')
      select.id = 'test-select-init'
      select.setAttribute('variant', 'primary')
      select.setAttribute('size', 'lg')
      select.setAttribute('test-id', 'my-atoll-select')
      select.innerHTML = `
        <li><button class="dropdown-item" data-value="1">Option 1</button></li>
        <li><button class="dropdown-item" data-value="2">Option 2</button></li>
      `
      document.body.appendChild(select)
    })

    const selectHost = page.locator('#test-select-init')
    await expect(selectHost).toBeVisible()

    // Inner toggle button class verification
    const toggleBtn = selectHost.locator('button.atoll-select-toggle')
    await expect(toggleBtn).toBeVisible()
    await expect(toggleBtn).toHaveClass(/btn-primary/)
    await expect(toggleBtn).toHaveAttribute('data-testid', 'my-atoll-select')

    // Container class verification
    const container = selectHost.locator('.atoll-select')
    await expect(container).toHaveClass(/atoll-select-lg/)
  })

  test('should support option selection, update UI, state, active classes, and dispatch custom atoll-change event', async ({ page }) => {
    await page.evaluate(() => {
      const select = document.createElement('atoll-select')
      select.id = 'test-select-selection'
      select.setAttribute('value', '1')
      select.innerHTML = `
        <li><button class="dropdown-item" data-value="1">Option One</button></li>
        <li><button class="dropdown-item" data-value="2">Option Two</button></li>
      `
      window.__lastChange = null
      select.addEventListener('atoll-change', (e) => {
        window.__lastChange = e.detail
      })
      document.body.appendChild(select)
    })

    const selectHost = page.locator('#test-select-selection')
    const toggleBtn = selectHost.locator('button.atoll-select-toggle')
    const label = selectHost.locator('.atoll-select-label')

    // On load, value=1 is selected, so selectedLabel should be "Option One"
    await expect(label).toHaveText('Option One')

    // Open dropdown menu
    await toggleBtn.click()

    const menu = selectHost.locator('.atoll-select-menu')
    await expect(menu).toHaveClass(/show/)

    // Option 1 should be active
    const opt1 = menu.locator('button[data-value="1"]')
    const opt2 = menu.locator('button[data-value="2"]')
    await expect(opt1).toHaveClass(/active/)
    await expect(opt1).toHaveAttribute('aria-selected', 'true')
    await expect(opt2).not.toHaveClass(/active/)

    // Click Option 2
    await opt2.click()

    // UI Label should update to Option Two
    await expect(label).toHaveText('Option Two')

    // Event should be dispatched
    const eventDetail = await page.evaluate(() => window.__lastChange)
    expect(eventDetail).toEqual({
      value: '2',
      label: 'Option Two'
    })

    // Value state should be updated
    const currentValue = await selectHost.evaluate((el) => el.value)
    expect(currentValue).toBe('2')

    // Menu should close
    await expect(menu).not.toHaveClass(/show/)
  })

  test('should support programmatic API for value and disabled', async ({ page }) => {
    await page.evaluate(() => {
      const select = document.createElement('atoll-select')
      select.id = 'test-select-api'
      select.innerHTML = `
        <li><button class="dropdown-item" data-value="a">A</button></li>
        <li><button class="dropdown-item" data-value="b">B</button></li>
      `
      document.body.appendChild(select)
    })

    const selectHost = page.locator('#test-select-api')
    const label = selectHost.locator('.atoll-select-label')
    const toggleBtn = selectHost.locator('button.atoll-select-toggle')

    // Check placeholder
    await expect(label).toHaveText('Select an option...')

    // Programmatically set value
    await page.evaluate(() => {
      const select = document.getElementById('test-select-api')
      select.value = 'b'
    })

    await expect(label).toHaveText('B')

    const val = await selectHost.evaluate((el) => el.value)
    expect(val).toBe('b')

    // Programmatically disable
    await page.evaluate(() => {
      const select = document.getElementById('test-select-api')
      select.disabled = true
    })

    await expect(toggleBtn).toBeDisabled()

    const isDisabled = await selectHost.evaluate((el) => el.disabled)
    expect(isDisabled).toBe(true)

    // Programmatically enable
    await page.evaluate(() => {
      const select = document.getElementById('test-select-api')
      select.disabled = false
    })

    await expect(toggleBtn).not.toBeDisabled()
  })

  test('should support clean slots and programmatically set leading icons with zero wrapper nodes when empty', async ({ page }) => {
    await page.evaluate(() => {
      // Create select without leading and with default trailing caret
      const selectDefault = document.createElement('atoll-select')
      selectDefault.id = 'select-empty-slots'
      document.body.appendChild(selectDefault)

      // Create select with leadingIcon attribute
      const selectIcon = document.createElement('atoll-select')
      selectIcon.id = 'select-with-icon'
      selectIcon.setAttribute('leading-icon', 'settings')
      document.body.appendChild(selectIcon)
    })

    const defaultHost = page.locator('#select-empty-slots')
    // Verification: Leading element wrapper should not be in the DOM
    const leadingWrapperDefault = defaultHost.locator('.atoll-select-leading')
    await expect(leadingWrapperDefault).toBeHidden()

    // Default trailing chevron icon should be rendered
    const trailingWrapperDefault = defaultHost.locator('.atoll-select-trailing')
    await expect(trailingWrapperDefault).toBeVisible()
    const caretIcon = trailingWrapperDefault.locator('atoll-icon')
    await expect(caretIcon).toHaveAttribute('name', 'chevron-down')

    // Verification: with leadingIcon settings
    const iconHost = page.locator('#select-with-icon')
    const leadingWrapperIcon = iconHost.locator('.atoll-select-leading')
    await expect(leadingWrapperIcon).toBeVisible()
    const leadingIcon = leadingWrapperIcon.locator('atoll-icon')
    await expect(leadingIcon).toHaveAttribute('name', 'settings')
  })

  test('should render variants for visual screenshot', async ({ page }) => {
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px; padding: 40px; background-color: #f8f9fa; font-family: sans-serif; color: #111;">
          <h2>Atoll Chat Select Component Architecture</h2>
          
          <div id="section-variants" style="display: flex; gap: 20px; align-items: center;">
            <strong>Select Sizes:</strong>
          </div>

          <div id="section-slots" style="display: flex; gap: 20px; align-items: center;">
            <strong>With Slots:</strong>
          </div>
        </div>
      `

      // Programmatically create and append Selects
      const selectSm = document.createElement('atoll-select')
      selectSm.setAttribute('size', 'sm')
      selectSm.setAttribute('value', 'vol-low')
      selectSm.innerHTML = `
        <li><button class="dropdown-item" data-value="vol-low">Low Volume</button></li>
        <li><button class="dropdown-item" data-value="vol-mid">Medium Volume</button></li>
      `
      document.getElementById('section-variants').appendChild(selectSm)

      const selectMd = document.createElement('atoll-select')
      selectMd.setAttribute('size', 'md')
      selectMd.setAttribute('value', 'mic-1')
      selectMd.innerHTML = `
        <li><button class="dropdown-item" data-value="mic-1">Microphone 1</button></li>
        <li><button class="dropdown-item" data-value="mic-2">Microphone 2</button></li>
      `
      document.getElementById('section-variants').appendChild(selectMd)

      const selectLg = document.createElement('atoll-select')
      selectLg.setAttribute('size', 'lg')
      selectLg.setAttribute('value', 'cam-1')
      selectLg.innerHTML = `
        <li><button class="dropdown-item" data-value="cam-1">Camera Ultra HD</button></li>
        <li><button class="dropdown-item" data-value="cam-2">Camera HD</button></li>
      `
      document.getElementById('section-variants').appendChild(selectLg)

      // Select with leading icon
      const selectWithSlot = document.createElement('atoll-select')
      selectWithSlot.setAttribute('leading-icon', 'globe')
      selectWithSlot.setAttribute('value', 'en')
      selectWithSlot.innerHTML = `
        <li><button class="dropdown-item" data-value="en">English (US)</button></li>
        <li><button class="dropdown-item" data-value="jp">日本語 (JP)</button></li>
      `
      document.getElementById('section-slots').appendChild(selectWithSlot)
    })

    // Wait for rendering
    await page.waitForTimeout(2000)

    // Take screenshot
    await page.screenshot({ path: 'tests/e2e/screenshots/select-verification.png' })
  })
})
