import { test, expect } from './fixtures/base-test.js'

test.describe('Atoll Bottom Navigation', () => {
  test.beforeEach(async ({ page, loginCustomPage }) => {
    // Set mobile viewport size
    await page.setViewportSize({
      width: 375,
      height: 667
    })
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await expect(page).toHaveURL(/\/\?view=chats$/)
  })

  test('should render bottom navigation on mobile viewports', async ({ page }) => {
    const bottomNav = page.locator('[data-testid$="__bottomNavigation"]')
    await expect(bottomNav).toBeVisible()

    // Verify Tab 1 (Chats), Media, Files, Account are visible
    await expect(page.locator('[data-testid$="__bottomBtnChats"]')).toBeVisible()
    await expect(page.locator('[data-testid$="__bottomBtnMedia"]')).toBeVisible()
    await expect(page.locator('[data-testid$="__bottomBtnFiles"]')).toBeVisible()
    await expect(page.locator('[data-testid$="__bottomBtnProfile"]')).toBeVisible()
  })

  test('should hide bottom navigation on desktop viewports', async ({ page }) => {
    // Resize to desktop viewport
    await page.setViewportSize({
      width: 1024,
      height: 768
    })
    await page.waitForTimeout(500)

    const bottomNav = page.locator('[data-testid$="__bottomNavigation"]')
    await expect(bottomNav).toBeHidden()
  })

  test('should handle sub-menus correctly and navigate views', async ({ page }) => {
    // Tap on Media trigger
    await page.click('[data-testid$="__bottomBtnMedia"]')

    // Verify sub-menu (Music, Pictures, Videos) are visible
    await expect(page.locator('[data-testid$="__bottomBtnMusic"]')).toBeVisible()
    await expect(page.locator('[data-testid$="__bottomBtnPictures"]')).toBeVisible()
    await expect(page.locator('[data-testid$="__bottomBtnVideos"]')).toBeVisible()

    // Click Pictures sub-menu
    await page.click('[data-testid$="__bottomBtnPictures"]')

    // URL should update
    await expect(page).toHaveURL(/\/\?view=pictures$/)
  })

  test('should hide bottom navigation when a chat thread is open', async ({ page }) => {
    // Create or select a conversation thread
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    await expect(page.locator('atoll-chat-view')).toBeVisible()

    // Bottom navigation should now be hidden
    const bottomNav = page.locator('[data-testid$="__bottomNavigation"]')
    await expect(bottomNav).toBeHidden()
  })
})
