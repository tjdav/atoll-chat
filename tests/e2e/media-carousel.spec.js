import { test, expect } from './fixtures/base-test.js'
import path from 'path'

test.describe('Media Carousel and UI Improvements', () => {
  test('should rotate through images in carousel and sync with list view', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // 1. Create a chat and send 2 images (enough to test rotation)
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page.locator('chat-view')).toBeVisible({ timeout: 10000 })

    const imagePath = path.join(process.cwd(), 'tests/e2e/fixtures/test-files/test.png')
    for (let i = 0; i < 2; i++) {
      await page.setInputFiles('[data-testid$="__imageInput"]', imagePath)
      await page.waitForTimeout(500)
      await page.click('[data-testid$="__sendButton"]')
      await expect(page.locator('chat-view .message-status-container').last()).toBeVisible({ timeout: 20000 })
      await expect(page.locator('chat-view .message-status-container span').last()).toHaveText('Sent', { timeout: 20000 })
    }

    // 2. Go to Pictures view
    await page.click('button[title="Pictures"]')
    await expect(page.locator('picture-list')).toBeVisible()

    const cards = page.locator('media-grid-card')
    await expect(cards).toHaveCount(2, { timeout: 15000 })

    // 3. Select the first image
    await cards.first().click()
    await expect(page.locator('image-viewer')).toBeVisible()

    // Verify inset border on selected card
    const selectedCard = cards.first().locator('.card')
    await expect(selectedCard).toHaveClass(/is-active-card/)

    // 4. Test Carousel Next
    await page.click('.carousel-control-next')
    await page.waitForTimeout(1000)

    // Verify list selection synced
    await expect(cards.nth(1).locator('.card')).toHaveClass(/is-active-card/)

    // 5. Test Carousel Prev
    await page.click('.carousel-control-prev')
    await page.waitForTimeout(1000)
    await expect(cards.first().locator('.card')).toHaveClass(/is-active-card/)
  })

  test('should display active list item with correct contrast', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    // 1. Create a chat
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')

    // 2. Select it in the chat list
    const chatItem = page.locator('chat-list-item').first()
    await chatItem.click()

    const activeContainer = chatItem.locator('.chat-list-item')
    await expect(activeContainer).toHaveClass(/active/)

    // 3. Verify text contrast
    const previewText = activeContainer.locator('small').first()
    const color = await previewText.evaluate(el => getComputedStyle(el).color)
    expect(color).toBe('rgb(255, 255, 255)')

    const opacity = await previewText.evaluate(el => getComputedStyle(el).opacity)
    expect(parseFloat(opacity)).toBeGreaterThan(0.8)
  })
})
