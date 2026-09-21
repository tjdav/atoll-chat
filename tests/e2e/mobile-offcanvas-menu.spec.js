import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Mobile Offcanvas Menu Responsive Breakpoints', () => {
  test.beforeEach(async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await expect(page).toHaveURL(/\/\?view=chats$/)
  })

  test('should have full screen width < 576px (mobile/phone viewport) when active', async ({ page }) => {
    // Set viewport below 576px
    await page.setViewportSize({
      width: 450,
      height: 800
    })
    await page.waitForTimeout(500)

    // Open a chat room to enter chat-active state
    await page.getByTestId('btnCreateRoom').click()
    await page.locator('create-room-modal').getByTestId('searchInput').fill('bob')
    await page.getByTestId('search-result-bob').click()
    await page.getByTestId('btnCreate').click()
    await expect(page.locator('atoll-chat-view')).toBeVisible()

    // Open mobile navigation offcanvas over the chat pane
    await page.evaluate(() => {
      window.$bus.emit('ui:open_mobile_nav')
    })

    const mobileNav = page.getByTestId('mobileNav')
    await expect(mobileNav).toBeVisible()

    // Measure actual bounding box or computed style width of mobileNav
    const width = await mobileNav.evaluate((el) => el.getBoundingClientRect().width)
    expect(width).toBeCloseTo(450, 1) // Should be full screen width
  })

  test('should have limited/same width as room settings offcanvas >= 576px and < 768px (tablet viewport) when active', async ({ page }) => {
    // Set viewport between 576px and 768px
    await page.setViewportSize({
      width: 650,
      height: 800
    })
    await page.waitForTimeout(500)

    // Open a chat room to enter chat-active state
    await page.getByTestId('btnCreateRoom').click()
    await page.locator('create-room-modal').getByTestId('searchInput').fill('bob')
    await page.getByTestId('search-result-bob').click()
    await page.getByTestId('btnCreate').click()
    await expect(page.locator('atoll-chat-view')).toBeVisible()

    // Open mobile navigation offcanvas over the chat pane
    await page.evaluate(() => {
      window.$bus.emit('ui:open_mobile_nav')
    })

    const mobileNav = page.getByTestId('mobileNav')
    await expect(mobileNav).toBeVisible()

    // Under 768px but above 576px, width should be min(calc(100vw - 60px), 410px) => min(650 - 60, 410) = 410px
    const width = await mobileNav.evaluate((el) => el.getBoundingClientRect().width)
    expect(width).toBeCloseTo(410, 1)
  })
})
