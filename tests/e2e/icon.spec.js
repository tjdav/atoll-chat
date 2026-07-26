import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Icon Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render base icon class and the resolved IconPark SVG', async ({ page }) => {
    // Inject atoll-icon dynamically
    await page.evaluate(() => {
      const el = document.createElement('atoll-icon')
      el.id = 'test-icon-music'
      el.setAttribute('name', 'music')
      el.setAttribute('size', 'lg')
      document.body.appendChild(el)
    })

    const icon = page.locator('#test-icon-music')
    const innerWrapper = icon.locator('.atoll-icon')

    await expect(icon).toBeVisible()
    await expect(innerWrapper).toHaveClass(/atoll-icon/)
    await expect(innerWrapper).toHaveClass(/atoll-icon-lg/)

    // Check SVG tag is injected inside
    const svg = innerWrapper.locator('svg')
    await expect(svg).toBeVisible()
  })

  test('should support standard token and explicit numeric sizes', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-icon')
      el.id = 'test-icon-size'
      el.setAttribute('name', 'search')
      el.setAttribute('size', '42')
      document.body.appendChild(el)
    })

    const icon = page.locator('#test-icon-size')
    const innerWrapper = icon.locator('.atoll-icon')

    await expect(icon).toBeVisible()

    // Explicit numeric size gets set as inline style custom property
    await expect(innerWrapper).toHaveAttribute('style', /--atoll-icon-size:\s*42px/)
  })

  test('should support inline colors and secondary colors', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-icon')
      el.id = 'test-icon-color'
      el.setAttribute('name', 'settings')
      el.setAttribute('color', '#ff0000')
      el.setAttribute('secondary-color', '#00ff00')
      document.body.appendChild(el)
    })

    const icon = page.locator('#test-icon-color')
    const innerWrapper = icon.locator('.atoll-icon')

    await expect(icon).toBeVisible()

    await expect(innerWrapper).toHaveAttribute('style', /--atoll-icon-primary-color:\s*#ff0000/)
    await expect(innerWrapper).toHaveAttribute('style', /--atoll-icon-secondary-color:\s*#00ff00/)
  })

  test('should handle accessibility and aria attributes correctly', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement('atoll-icon')
      el.id = 'test-icon-accessibility'
      el.setAttribute('name', 'logout')
      document.body.appendChild(el)
    })

    const icon = page.locator('#test-icon-accessibility')

    // Default: aria-hidden="true"
    await expect(icon).toHaveAttribute('aria-hidden', 'true')
    await expect(icon).not.toHaveAttribute('role')
    await expect(icon).not.toHaveAttribute('aria-label')

    // Add aria-label
    await page.evaluate(() => {
      const el = document.getElementById('test-icon-accessibility')
      el.setAttribute('aria-label', 'Logout of Application')
    })

    await expect(icon).toHaveAttribute('role', 'img')
    await expect(icon).toHaveAttribute('aria-label', 'Logout of Application')
    await expect(icon).not.toHaveAttribute('aria-hidden')
  })
})
