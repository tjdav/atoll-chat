import { test, expect } from '@playwright/test'
import { extensions } from '../../src/extensions/index.js'

test.use({ video: 'on' })

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

test.describe('Rail Host Component Tests', () => {
  test('Case 1 & 2: Desktop rail rendering, items count, order, and labels', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    const rail = page.locator('[data-testid="rail"]')
    await expect(rail).toBeVisible()

    const railExtensions = extensions
      .filter((e) => e.rail)
      .sort((a, b) => a.rail.order - b.rail.order)

    expect(railExtensions).toHaveLength(6)

    const expectedIds = ['core.chat', 'core.media', 'core.documents', 'core.links', 'core.calls', 'core.settings']
    const actualIds = railExtensions.map((e) => e.id)
    expect(actualIds).toEqual(expectedIds)

    const buttons = page.locator('button[data-rail-id]')
    await expect(buttons).toHaveCount(6)

    for (let i = 0; i < railExtensions.length; i++) {
      const ext = railExtensions[i]
      const btn = buttons.nth(i)
      await expect(btn).toHaveAttribute('data-rail-id', ext.id)
      await expect(btn).toHaveAttribute('aria-label', ext.label)
      const expectedCurrent = ext.id === 'core.chat' ? 'page' : 'false'
      await expect(btn).toHaveAttribute('aria-current', expectedCurrent)
    }

    await page.screenshot({ path: 'test-results/rail-desktop.png', fullPage: true })
  })

  test('Case 3: Clicking navigates to ?rail=<id> and highlights item', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    const mediaButton = page.locator('button[data-rail-id="core.media"]')
    await expect(mediaButton).toBeVisible()
    await mediaButton.click()

    await expect(page).toHaveURL(/rail=core\.media/)
    await expect(mediaButton).toHaveAttribute('aria-current', 'page')

    const buttons = page.locator('button[data-rail-id]')
    const count = await buttons.count()
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i)
      const id = await btn.getAttribute('data-rail-id')
      if (id === 'core.media') {
        await expect(btn).toHaveAttribute('aria-current', 'page')
      } else {
        await expect(btn).toHaveAttribute('aria-current', 'false')
      }
    }

    await page.screenshot({ path: 'test-results/rail-desktop-media.png', fullPage: true })
  })

  test('Case 4: Back navigates back in history', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    const mediaButton = page.locator('button[data-rail-id="core.media"]')
    await mediaButton.click()
    await expect(page).toHaveURL(/rail=core\.media/)

    await page.goBack()

    expect(page.url()).not.toContain('rail=core.media')
    const buttons = page.locator('button[data-rail-id]')
    const count = await buttons.count()
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i)
      const id = await btn.getAttribute('data-rail-id')
      const expectedCurrent = id === 'core.chat' ? 'page' : 'false'
      await expect(btn).toHaveAttribute('aria-current', expectedCurrent)
    }
  })

  test('Case 6: Hidden on mobile (390x844)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    const rail = page.locator('[data-testid="rail"]')
    await expect(rail).not.toBeVisible()
  })

  test('Case 7: Hidden on tablet (820x1180)', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    const rail = page.locator('[data-testid="rail"]')
    await expect(rail).not.toBeVisible()
  })
})
