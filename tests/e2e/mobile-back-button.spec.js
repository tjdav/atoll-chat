import { test, expect } from './fixtures/base-test.js'

test.use({
  viewport: {
    width: 375,
    height: 667
  },
  hasTouch: true,
  video: 'on',
  screenshot: 'on'
})

test.describe('Mobile Back Button Navigation', () => {
  test.beforeEach(async ({ loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')
  })

  test('should navigate end-to-end and return to the list pane when clicking back button', async ({ page }) => {
    test.slow()

    // Create a room first to have an active room selection
    await page.locator('[data-testid$="btnCreateRoom"]').click()
    await page.locator('create-room-modal [data-testid$="searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid$="btnCreate"]').click()

    // Chat detail view is now active and visible
    await expect(page.locator('atoll-chat-view')).toBeVisible({ timeout: 15000 })

    // Locate the back button and click it to perform the back navigation
    const backBtn = page.locator('[data-testid$="chatBackBtn"]')
    await expect(backBtn).toBeVisible()
    await backBtn.click()

    // Verify that we have successfully navigated back to the chats list pane (mobileNav is visible)
    await expect(page.locator('[data-testid$="mobileNav"]')).toBeVisible()
  })
})
