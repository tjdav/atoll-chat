import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Search Bar Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render and match sizes', async ({ page }) => {
    await page.evaluate(() => {
      // Small search size
      const searchSm = document.createElement('atoll-search-bar')
      searchSm.id = 'search-sm'
      searchSm.setAttribute('size', 'sm')
      document.body.appendChild(searchSm)

      // Medium search size
      const searchMd = document.createElement('atoll-search-bar')
      searchMd.id = 'search-md'
      searchMd.setAttribute('size', 'md')
      document.body.appendChild(searchMd)

      // Large search size
      const searchLg = document.createElement('atoll-search-bar')
      searchLg.id = 'search-lg'
      searchLg.setAttribute('size', 'lg')
      document.body.appendChild(searchLg)
    })

    const smField = page.locator('#search-sm .atoll-search-bar-field')
    const mdField = page.locator('#search-md .atoll-search-bar-field')
    const lgField = page.locator('#search-lg .atoll-search-bar-field')

    await expect(smField).toHaveCSS('height', '32px')
    await expect(mdField).toHaveCSS('height', '38px')
    await expect(lgField).toHaveCSS('height', '44px')
  })

  test('should support typing, clear action, and keep focus on clear', async ({ page }) => {
    await page.evaluate(() => {
      const search = document.createElement('atoll-search-bar')
      search.id = 'search-typing'
      document.body.appendChild(search)
    })

    const searchHost = page.locator('#search-typing')
    const input = searchHost.locator('input[type="search"]')
    const clearBtn = searchHost.locator('.atoll-search-bar-clear')

    // Initial state: clear button should be hidden
    await expect(clearBtn).toBeHidden()

    // Type text
    await input.focus()
    await input.fill('Hello World')

    // Clear button should be visible now
    await expect(clearBtn).toBeVisible()

    // Click clear button
    await clearBtn.click()

    // Input should be empty, and focused
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    await expect(clearBtn).toBeHidden()
  })

  test('should support Cancel CTA behavior and dispatch cancel event', async ({ page }) => {
    await page.evaluate(() => {
      const search = document.createElement('atoll-search-bar')
      search.id = 'search-cancel'
      search.setAttribute('show-cancel', 'true')
      window.__cancelEventFired = false
      search.addEventListener('cancel', () => {
        window.__cancelEventFired = true
      })
      document.body.appendChild(search)
    })

    const searchHost = page.locator('#search-cancel')
    const input = searchHost.locator('input[type="search"]')
    const cancelBtn = searchHost.locator('.atoll-search-bar-cancel button')

    // Initial state: cancel button is hidden when no value and not focused
    await expect(cancelBtn).toBeHidden()

    // Focus input -> cancel button appears
    await input.focus()
    await expect(cancelBtn).toBeVisible()

    // Fill search
    await input.fill('Looking for something')

    // Click cancel button
    await cancelBtn.click()

    // Input should be cleared and blurred
    await expect(input).toHaveValue('')
    await expect(input).not.toBeFocused()

    // Assert that the cancel event was fired
    const cancelFired = await page.evaluate(() => window.__cancelEventFired)
    expect(cancelFired).toBe(true)
  })

  test('should handle keyboard shortcuts Enter and Escape', async ({ page }) => {
    await page.evaluate(() => {
      const search = document.createElement('atoll-search-bar')
      search.id = 'search-kb'
      window.__searchEventDetail = null
      search.addEventListener('search', (e) => {
        window.__searchEventDetail = e.detail
      })
      document.body.appendChild(search)
    })

    const searchHost = page.locator('#search-kb')
    const input = searchHost.locator('input[type="search"]')

    // Fill and press Enter
    await input.focus()
    await input.fill('Keyboard Query')
    await input.press('Enter')

    // Verify search custom event details
    const searchDetail = await page.evaluate(() => window.__searchEventDetail)
    expect(searchDetail).toEqual({ value: 'Keyboard Query' })

    // Press Escape with value -> should clear input
    await input.press('Escape')
    await expect(input).toHaveValue('')

    // Press Escape without value -> should blur input
    await input.focus()
    await input.press('Escape')
    await expect(input).not.toBeFocused()
  })

  test('should enforce accessibility in disabled state', async ({ page }) => {
    await page.evaluate(() => {
      const search = document.createElement('atoll-search-bar')
      search.id = 'search-disabled'
      search.setAttribute('disabled', 'true')
      search.setAttribute('show-cancel', 'true')
      search.setAttribute('value', 'stuck')
      document.body.appendChild(search)
    })

    const searchHost = page.locator('#search-disabled')
    const input = searchHost.locator('input[type="search"]')
    const clearBtn = searchHost.locator('.atoll-search-bar-clear')
    const cancelBtn = searchHost.locator('.atoll-search-bar-cancel button')

    // Assert disabled properties
    await expect(input).toBeDisabled()
    await expect(clearBtn).toBeDisabled()
    await expect(clearBtn).toHaveAttribute('tabindex', '-1')

    // Cancel CTA is hidden entirely because disabled is true
    await expect(cancelBtn).toBeHidden()
  })

  test('should expose imperative helper methods and bidirectional value descriptor', async ({ page }) => {
    await page.evaluate(() => {
      const search = document.createElement('atoll-search-bar')
      search.id = 'search-methods'
      document.body.appendChild(search)
    })

    const searchHost = page.locator('#search-methods')
    const input = searchHost.locator('input[type="search"]')

    // Wait for the element to be visible/rendered first
    await expect(input).toBeVisible()

    // Trigger focus via helper method
    await page.evaluate(() => {
      document.getElementById('search-methods').focus()
    })
    await expect(input).toBeFocused()

    // Trigger blur via helper method
    await page.evaluate(() => {
      document.getElementById('search-methods').blur()
    })
    await expect(input).not.toBeFocused()

    // Set value via bidirectional value descriptor
    await page.evaluate(() => {
      const el = document.getElementById('search-methods')
      el.value = 'Programmatic Set'
    })
    await expect(input).toHaveValue('Programmatic Set')

    // Get value via bidirectional value descriptor
    const val = await page.evaluate(() => {
      return document.getElementById('search-methods').value
    })
    expect(val).toBe('Programmatic Set')

    // Trigger clear via helper method
    await page.evaluate(() => {
      document.getElementById('search-methods').clear()
    })
    await expect(input).toHaveValue('')
  })

  test('should capture visual states screenshot matrix', async ({ page }) => {
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 24px; padding: 40px; background-color: var(--atoll-bg-surface-primary, #ffffff); font-family: sans-serif; color: var(--atoll-text-primary, #111);">
          <h2>Atoll Search Bar Component Visual Matrix</h2>
          
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <strong>Sizes Matrix:</strong>
            <div id="sizes-container" style="display: flex; flex-direction: column; gap: 8px;"></div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <strong>Active focus with Cancel CTA:</strong>
            <div id="active-container"></div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <strong>Disabled State:</strong>
            <div id="disabled-container"></div>
          </div>
        </div>
      `

      // Append Sizes Matrix
      const sizesContainer = document.getElementById('sizes-container')

      const searchSm = document.createElement('atoll-search-bar')
      searchSm.setAttribute('size', 'sm')
      searchSm.setAttribute('placeholder', 'Search compact...')
      sizesContainer.appendChild(searchSm)

      const searchMd = document.createElement('atoll-search-bar')
      searchMd.setAttribute('size', 'md')
      searchMd.setAttribute('placeholder', 'Search medium (default)...')
      sizesContainer.appendChild(searchMd)

      const searchLg = document.createElement('atoll-search-bar')
      searchLg.setAttribute('size', 'lg')
      searchLg.setAttribute('placeholder', 'Search large...')
      sizesContainer.appendChild(searchLg)

      // Append Active Matrix
      const activeContainer = document.getElementById('active-container')
      const activeBar = document.createElement('atoll-search-bar')
      activeBar.id = 'active-matrix-bar'
      activeBar.setAttribute('show-cancel', 'true')
      activeBar.setAttribute('placeholder', 'Type here...')
      activeContainer.appendChild(activeBar)

      // Append Disabled Matrix
      const disabledContainer = document.getElementById('disabled-container')
      const disabledBar = document.createElement('atoll-search-bar')
      disabledBar.setAttribute('disabled', 'true')
      disabledBar.setAttribute('value', 'Cannot edit me')
      disabledBar.setAttribute('show-cancel', 'true')
      disabledContainer.appendChild(disabledBar)
    })

    // Focus the medium matrix search bar to trigger animation & active state rendering
    const targetBar = page.locator('#active-matrix-bar')
    const targetInput = targetBar.locator('input[type="search"]')
    await expect(targetInput).toBeVisible()
    await targetInput.focus()
    await targetInput.fill('Active typing state')

    // Wait for the slide fade-in animation to complete
    await page.waitForTimeout(1000)

    // Take verification screenshot
    await page.screenshot({ path: 'tests/e2e/screenshots/search-bar-verification.png' })
  })
})
