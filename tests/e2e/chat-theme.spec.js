import { test, expect } from './fixtures/base-test.js'

test.describe('Chat View Theme System E2E', () => {
  test.beforeEach(async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await expect(page).toHaveURL(/\/\?view=chats$/)

    // Create room with Bob
    await page.locator('[data-testid="list-pane-0__btnCreateRoom"]').click()
    await page.locator('[data-testid="create-room-modal-0__searchInput"]').fill('bob')
    await page.locator('[data-testid$="search-result-bob"]').click()
    await page.locator('[data-testid="create-room-modal-0__btnCreate"]').click()

    await expect(page.locator('chat-view')).toBeVisible()
  })

  test('should apply and switch themes, updating computed colors on chat view container', async ({ page }) => {
    // Open room details sidebar and customization accordion
    await page.locator('[ref$="btnDetails"] button').click()
    await page.locator('[data-testid$="accordion-customise-btn"]').click()

    const themeModal = page.locator('[data-testid$="themeSelectorModal"]')
    const chatContainer = page.locator('[data-testid$="chat-view-container"]')

    // Select Ocean Theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal.locator('.modal')).toBeVisible()
    await page.locator('[data-testid$="theme-ocean-item"]').click()
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal.locator('.modal')).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'ocean')
    const oceanBgColor = await chatContainer.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    expect(oceanBgColor).toBe('rgb(15, 32, 39)')

    // Switch to Forest Theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal.locator('.modal')).toBeVisible()
    await page.locator('[data-testid$="theme-forest-item"]').click()
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal.locator('.modal')).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'forest')
    const forestBgColor = await chatContainer.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    expect(forestBgColor).toBe('rgb(17, 153, 142)')

    // Switch to Sunset Theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal.locator('.modal')).toBeVisible()
    await page.locator('[data-testid$="theme-sunset-item"]').click()
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal.locator('.modal')).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'sunset')
    const sunsetBgColor = await chatContainer.evaluate((el) => window.getComputedStyle(el).backgroundColor)
    expect(sunsetBgColor).toBe('rgb(241, 39, 17)')

    // Switch back to Classic Theme
    await page.locator('[data-testid$="btnChangeTheme"]').click()
    await expect(themeModal.locator('.modal')).toBeVisible()
    await page.locator('[data-testid$="theme-classic-item"]').click()
    await themeModal.locator('atoll-button[ref$="primaryBtn"] button').click()
    await expect(themeModal.locator('.modal')).not.toBeVisible()

    await expect(chatContainer).toHaveAttribute('data-theme', 'classic')
  })
})
