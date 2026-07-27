import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Icon Component (@solar-icons/js)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(() => {
      return window.__coralite__.lifecycle.hydrated
    })
  })

  test('should render base icon class and resolved Solar SVG without console warnings', async ({ page }) => {
    const warnings = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        warnings.push(msg.text())
      }
    })

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

    // Check Solar SVG tag is injected inside
    const svg = innerWrapper.locator('svg.solar')
    await expect(svg).toBeVisible()
    await expect(svg).toHaveClass(/solar-music/)

    expect(warnings.filter(w => w.includes('was not found'))).toHaveLength(0)
  })

  test('should render chat input icons (send, attach, emoji) successfully', async ({ page }) => {
    const warnings = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        warnings.push(msg.text())
      }
    })

    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'test-chat-icons'
      container.innerHTML = `
        <atoll-icon id="icon-send" name="send" size="20"></atoll-icon>
        <atoll-icon id="icon-attach" name="attach" size="20"></atoll-icon>
        <atoll-icon id="icon-emoji" name="emoji" size="20"></atoll-icon>
      `
      document.body.appendChild(container)
    })

    const sendSvg = page.locator('#icon-send svg.solar')
    const attachSvg = page.locator('#icon-attach svg.solar')
    const emojiSvg = page.locator('#icon-emoji svg.solar')

    await expect(sendSvg).toBeVisible()
    await expect(sendSvg).toHaveClass(/solar-send/)

    await expect(attachSvg).toBeVisible()
    await expect(attachSvg).toHaveClass(/solar-attach/)

    await expect(emojiSvg).toBeVisible()
    await expect(emojiSvg).toHaveClass(/solar-emoji/)

    expect(warnings.filter(w => w.includes('was not found'))).toHaveLength(0)
  })

  test('should render sidebar navigation icons (gallery, menu-music, menu-videos, menu-documents, menu-links) successfully', async ({ page }) => {
    const warnings = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        warnings.push(msg.text())
      }
    })

    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'test-nav-icons'
      container.innerHTML = `
        <atoll-icon id="icon-gallery" name="gallery" size="24"></atoll-icon>
        <atoll-icon id="icon-menu-music" name="menu-music" size="24"></atoll-icon>
        <atoll-icon id="icon-menu-videos" name="menu-videos" size="24"></atoll-icon>
        <atoll-icon id="icon-menu-documents" name="menu-documents" size="24"></atoll-icon>
        <atoll-icon id="icon-menu-links" name="menu-links" size="24"></atoll-icon>
      `
      document.body.appendChild(container)
    })

    const gallerySvg = page.locator('#icon-gallery svg.solar')
    const musicSvg = page.locator('#icon-menu-music svg.solar')
    const videosSvg = page.locator('#icon-menu-videos svg.solar')
    const docsSvg = page.locator('#icon-menu-documents svg.solar')
    const linksSvg = page.locator('#icon-menu-links svg.solar')

    await expect(gallerySvg).toBeVisible()
    await expect(musicSvg).toBeVisible()
    await expect(videosSvg).toBeVisible()
    await expect(docsSvg).toBeVisible()
    await expect(linksSvg).toBeVisible()

    expect(warnings.filter(w => w.includes('was not found'))).toHaveLength(0)
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
