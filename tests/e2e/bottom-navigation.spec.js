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
    const bottomNav = page.getByTestId('bottomNavigation')
    await expect(bottomNav).toBeVisible()

    // Verify Tab 1 (Chats), Media, Files, Account are visible
    await expect(page.getByTestId('bottomBtnChats')).toBeVisible()
    await expect(page.getByTestId('bottomBtnMedia')).toBeVisible()
    await expect(page.getByTestId('bottomBtnFiles')).toBeVisible()
    await expect(page.getByTestId('bottomBtnProfile')).toBeVisible()
  })

  test('should hide bottom navigation on desktop viewports', async ({ page }) => {
    // Resize to desktop viewport
    await page.setViewportSize({
      width: 1024,
      height: 768
    })
    await page.waitForTimeout(500)

    const bottomNav = page.getByTestId('bottomNavigation')
    await expect(bottomNav).toBeHidden()
  })

  test('should handle sub-menus correctly and navigate views', async ({ page }) => {
    // Tap on Media trigger
    await page.getByTestId('bottomBtnMedia').click()

    // Verify sub-menu (Music, Pictures, Videos) are visible
    await expect(page.getByTestId('bottomBtnMusic')).toBeVisible()
    await expect(page.getByTestId('bottomBtnPictures')).toBeVisible()
    await expect(page.getByTestId('bottomBtnVideos')).toBeVisible()

    // Click Pictures sub-menu
    await page.getByTestId('bottomBtnPictures').click()

    // URL should update
    await expect(page).toHaveURL(/\/\?view=pictures$/)
  })

  test('should hide bottom navigation when a chat thread is open', async ({ page }) => {
    // Create or select a conversation thread
    await page.getByTestId('btnCreateRoom').click()
    await page.locator('create-room-modal').getByTestId('searchInput').fill('bob')
    await page.getByTestId('search-result-bob').click()
    await page.getByTestId('btnCreate').click()

    await expect(page.locator('atoll-chat-view')).toBeVisible()

    // Bottom navigation should now be hidden
    const bottomNav = page.getByTestId('bottomNavigation')
    await expect(bottomNav).toBeHidden()
  })
})
