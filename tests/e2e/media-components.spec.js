import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Media Grid and Card Components', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      return window.__coralite__ && window.__coralite__.lifecycle !== undefined
    })
    await page.evaluate(async () => {
      await window.__coralite__.lifecycle.hydrated
      // Force load and register the component for E2E dynamically-inserted html tests
      document.createElement('atoll-media-grid')
      await customElements.whenDefined('atoll-media-grid')
      document.createElement('atoll-media-card')
      await customElements.whenDefined('atoll-media-card')
    })
  })

  test('renders media card with appropriate attributes, classes, and styles', async ({ page }) => {
    // Append standard 3-Column Square Grid dynamically to page to test styles, states and event dispatching
    await page.evaluate(() => {
      const container = document.createElement('div')
      container.id = 'test-media-container'
      container.innerHTML = `
        <atoll-media-grid columns="3" aspect-ratio="square" gap="xs">
          <atoll-media-card 
            id="card-img"
            src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='green'/></svg>"
            title="Vacation Photo" 
            subtitle="July 2026" 
            media-type="image">
          </atoll-media-card>
          <atoll-media-card 
            id="card-video"
            src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='blue'/></svg>"
            title="Beach Video" 
            subtitle="00:30" 
            media-type="video">
          </atoll-media-card>
          <atoll-media-card 
            id="card-gif"
            src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='red'/></svg>"
            title="Funny GIF" 
            subtitle="Looping" 
            media-type="gif">
          </atoll-media-card>
        </atoll-media-grid>
      `
      document.body.appendChild(container)
    })

    // Assert grid setup
    const grid = page.locator('atoll-media-grid')
    await expect(grid).toBeVisible()
    await expect(grid.locator('.atoll-media-grid')).toHaveClass(/atoll-media-grid-3/)
    await expect(grid.locator('.atoll-media-grid')).toHaveClass(/atoll-media-gap-xs/)

    // Assert image card setup
    const imgCard = page.locator('atoll-media-card#card-img')
    await expect(imgCard).toBeVisible()
    await expect(imgCard.locator('.atoll-media-card')).toHaveClass(/aspect-square/)
    await expect(imgCard.locator('.atoll-media-title')).toHaveText('Vacation Photo')
    await expect(imgCard.locator('.atoll-media-subtitle')).toHaveText('July 2026')
    // No album icon since media-type is image
    await expect(imgCard.locator('atoll-icon[name="copy"]')).toBeHidden()

    // Assert video card setup
    const videoCard = page.locator('atoll-media-card#card-video')
    await expect(videoCard).toBeVisible()
    await expect(videoCard.locator('atoll-icon[name="videocam"]')).toBeVisible()

    // Assert gif card setup
    const gifCard = page.locator('atoll-media-card#card-gif')
    await expect(gifCard).toBeVisible()
    await expect(gifCard.locator('.gif-pill')).toBeVisible()
    await expect(gifCard.locator('.gif-pill')).toHaveText('GIF')

    // Test selection ring change
    await imgCard.evaluate((el) => el.setAttribute('selected', 'true'))
    await expect(imgCard.locator('.atoll-media-card')).toHaveClass(/selected/)

    // Capture screenshot for visual verification
    await page.locator('#test-media-container').screenshot({ path: 'tests/e2e/screenshots/verification.png' })

    // Test atoll-media-select event dispatching
    await page.evaluate(() => {
      window.lastSelectDetail = null
      document.addEventListener('atoll-media-select', (e) => {
        window.lastSelectDetail = e.detail
      }, { once: true })
    })

    // Click inside the card specifically on the inner elements (e.g. atoll-media-card)
    await page.locator('atoll-media-card#card-img').click()

    await expect.poll(async () => {
      return await page.evaluate(() => window.lastSelectDetail)
    }).not.toBeNull()

    const detail = await page.evaluate(() => window.lastSelectDetail)
    expect(detail.title).toBe('Vacation Photo')
    expect(detail.subtitle).toBe('July 2026')
    expect(detail.mediaType).toBe('image')
  })
})
