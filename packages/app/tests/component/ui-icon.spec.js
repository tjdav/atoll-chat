import { test, expect } from '@playwright/test'

async function setupAuthenticatedPage(page) {
  page.on('console', (msg) => console.log('BROWSER LOG:', msg.type(), msg.text()))
  page.on('pageerror', (err) => console.log('BROWSER PAGE ERROR:', err))

  await page.addInitScript(() => {
    localStorage.setItem('atoll.session.token', 'test-session-token')
    localStorage.setItem('atoll.session.username', 'alice')
  })

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'u_test_123',
        username_token: 'test_token',
        encrypted_display: null,
        identity_pubkey: 'pubkey123',
        profile: null,
        profile_version: 1,
        created_at: new Date().toISOString()
      })
    })
  )

  await page.route('**/api/v1/oprf/blind', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        evaluated: 'SNMQYGSk2i4CM3QrPyvxt16TpA6QIek10OntpdZ2fDY='
      })
    })
  )
}

test.describe('ui-icon Primitive & Rail Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
  })

  test('rail button contains ui-icon element rendering Solar SVG', async ({ page }) => {
    await page.goto('/app.html')
    await page.waitForSelector('[data-coralite-ready="true"]')

    const railButtons = page.locator('.rail__button')
    await expect(railButtons).toHaveCount(6)

    for (let i = 0; i < 6; i++) {
      const button = railButtons.nth(i)
      const uiIcon = button.locator('ui-icon')
      await expect(uiIcon).toBeAttached()

      const iconSpan = uiIcon.locator('.icon')
      await expect(iconSpan).toBeAttached()

      const svg = iconSpan.locator('svg')
      await expect(svg).toBeAttached()
      await expect(svg).toHaveAttribute('xmlns', 'http://www.w3.org/2000/svg')

      const pathCount = await svg.locator('path, circle').count()
      expect(pathCount).toBeGreaterThan(0)
    }
  })

  test('ui-icon matches extension rail.icon.name declarations', async ({ page }) => {
    await page.goto('/app.html')
    await page.waitForSelector('[data-coralite-ready="true"]')

    const expectedIcons = ['chat-round-line', 'gallery', 'document-text', 'link', 'phone', 'settings']
    const railButtons = page.locator('.rail__button')
    await expect(railButtons).toHaveCount(6)

    for (let i = 0; i < expectedIcons.length; i++) {
      const uiIcon = railButtons.nth(i).locator('ui-icon')
      await expect(uiIcon).toHaveAttribute('name', expectedIcons[i])
      await expect(uiIcon).toHaveAttribute('size', 'md')
    }
  })

  test('ui-icon computes size font-size token properly', async ({ page }) => {
    await page.goto('/app.html')
    await page.waitForSelector('[data-coralite-ready="true"]')

    const firstIcon = page.locator('.rail__button ui-icon').first()
    const fontSize = await firstIcon.evaluate((el) => window.getComputedStyle(el).fontSize)
    expect(fontSize).toBe('20px')
  })

  test('ui-icon inside rail has aria-hidden=true', async ({ page }) => {
    await page.goto('/app.html')
    await page.waitForSelector('[data-coralite-ready="true"]')

    const iconWrapper = page.locator('.rail__button ui-icon .icon').first()
    await expect(iconWrapper).toHaveAttribute('aria-hidden', 'true')
  })
})
