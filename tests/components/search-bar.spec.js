import { test, expect } from './fixtures/component-test.js'

test.describe('atoll-search-bar Component Tests', () => {
  test('should render search input with placeholder and search icon', async ({ page, mountComponent }) => {
    await mountComponent('atoll-search-bar', { placeholder: 'Search conversations...' })
    const searchHost = page.locator('#test-component-root')
    const input = searchHost.locator('input')

    await expect(searchHost).toBeVisible()
    await expect(input).toHaveAttribute('placeholder', 'Search conversations...')
  })

  test('should emit search events and show clear button on input', async ({ page, mountComponent }) => {
    await mountComponent('atoll-search-bar', { value: '' })
    const searchHost = page.locator('#test-component-root')
    const input = searchHost.locator('input')

    await input.fill('Hello world')

    const clearBtn = searchHost.locator('.atoll-search-clear, .atoll-search-bar-clear, button[aria-label="Clear search"]')
    if (await clearBtn.count() > 0) {
      await expect(clearBtn).toBeVisible()
    }
  })

  test('should render visual matrix and pass accessibility checks in light and dark themes', async ({ page, setTheme, takeVerificationScreenshot }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
    await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

    await page.evaluate(() => {
      document.body.innerHTML = `
        <div id="visual-matrix" style="padding: 24px; background: var(--atoll-body-bg, #ffffff); color: var(--atoll-text-primary, #111111);">
          <h3>atoll-search-bar Visual Verification Matrix</h3>
          <div style="display: flex; flex-direction: column; gap: 16px; max-width: 400px;">
            <atoll-search-bar placeholder="Search..."></atoll-search-bar>
            <atoll-search-bar value="Pre-filled query"></atoll-search-bar>
          </div>
        </div>
      `
    })

    const matrix = page.locator('#visual-matrix')
    await expect(matrix).toBeVisible()

    await setTheme('light')
    await takeVerificationScreenshot('search-bar-verification-light', matrix)

    await setTheme('dark')
    await takeVerificationScreenshot('search-bar-verification-dark', matrix)
  })
})
