import { test, expect } from '@playwright/test'

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

test.describe('Surface Host Component Tests', () => {
  test('Case 1 & 2: Fallback rail renders list on first load and detail panel is empty when no detail route is set', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    await expect(page).toHaveURL(/rail=core\.chat/)

    const listPanel = page.locator('[data-testid="list-panel"]')
    await expect(listPanel).toBeVisible()

    const listComponent = listPanel.locator('[data-testid="chats"]')
    await expect(listComponent).toBeVisible()

    const detailPanel = page.locator('[data-testid="detail-panel"]')
    await expect(detailPanel).toBeVisible()

    const detailPlaceholder = detailPanel.locator('[data-testid="extension-placeholder"]')
    await expect(detailPlaceholder).toHaveCount(0)

    await page.screenshot({ path: 'test-results/surface-chat.png', fullPage: true })
  })

  test('Case 3: Clicking a different rail swaps the list and maintains single child', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    const mediaButton = page.locator('button[data-rail-id="core.media"]')
    await mediaButton.click()

    await expect(page).toHaveURL(/rail=core\.media/)

    const listPanel = page.locator('[data-testid="list-panel"]')
    const children = listPanel.locator('> *')
    await expect(children).toHaveCount(1)
    await expect(listPanel.locator('[data-testid="extension-placeholder"]')).toBeVisible()
  })

  test('Case 4: Navigating to a detail route renders its component', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html?rail=core.chat&detail=chat&id=r_abc')

    const detailPanel = page.locator('[data-testid="detail-panel"]')
    const detailPlaceholder = detailPanel.locator('[data-testid="extension-placeholder"]')
    await expect(detailPlaceholder).toBeVisible()

    await page.screenshot({ path: 'test-results/surface-detail.png', fullPage: true })
  })

  test('Case 5: Detail panel clears when detail param is removed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)

    await page.goto('/app.html?rail=core.chat')
    const mediaButton = page.locator('button[data-rail-id="core.media"]')
    await mediaButton.click()
    await expect(page).toHaveURL(/rail=core\.media/)

    await page.evaluate(() => {
      window.history.pushState(null, '', '/app.html?rail=core.chat&detail=chat&id=r_abc')
      window.dispatchEvent(new Event('popstate'))
    })

    const detailPanel = page.locator('[data-testid="detail-panel"]')
    await expect(detailPanel.locator('[data-testid="extension-placeholder"]')).toBeVisible()

    await page.goBack()

    expect(page.url()).not.toContain('detail=chat')
    await expect(detailPanel.locator('> *')).toHaveCount(0)
  })

  test('Case 6: Reconciliation does not duplicate DOM children', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuthenticatedPage(page)
    await page.goto('/app.html')

    const mediaButton = page.locator('button[data-rail-id="core.media"]')
    const docsButton = page.locator('button[data-rail-id="core.documents"]')
    const chatButton = page.locator('button[data-rail-id="core.chat"]')

    await mediaButton.click()
    await docsButton.click()
    await chatButton.click()

    const listPanel = page.locator('[data-testid="list-panel"]')
    const children = listPanel.locator('> *')
    await expect(children).toHaveCount(1)
  })
})
