import { test, expect } from './fixtures/base-test.js'

test.describe('View Persistence and Scroll Restoration', () => {
  test.beforeEach(async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')
    await expect(page).toHaveURL(/\/\?view=chats$/)
  })

  test('Category Selection Persistence: Sidebar navigation should remember active selection', async ({ page }) => {
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')

    await expect(page).toHaveURL(/view=chats&id=/, { timeout: 15000 })
    const chatRoomUrl = page.url()

    await page.click('button[title="Music"]')
    await expect(page).toHaveURL(/\/\?view=music$/)

    await page.click('button[title="Chats"]')
    await expect(page).toHaveURL(chatRoomUrl, { timeout: 10000 })
    await expect(page.locator('chat-view')).toBeVisible()
  })

  test('Sidebar Click Behavior: Clicking active category icon should not reset view', async ({ page }) => {
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page).toHaveURL(/view=chats&id=/, { timeout: 15000 })

    await page.click('button[title="Chats"]')
    await expect(page).toHaveURL(/view=chats&id=/)
    await expect(page.locator('chat-view')).toBeVisible()
  })

  test('Timeline Scroll Restoration: Should remember scroll position per room', async ({ page }) => {
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')
    await expect(page).toHaveURL(/view=chats&id=/, { timeout: 15000 })

    const input = page.locator('textarea[placeholder="Type a message..."]')
    for (let i = 0; i < 25; i++) {
      await input.fill(`Persistence message ${i}`)
      await input.press('Enter')
      await page.waitForTimeout(50)
    }

    await expect(page.locator('timeline-row')).toHaveCount(25, { timeout: 15000 })
    const timeline = page.locator('message-timeline .overflow-auto')

    // Ensure we are at bottom
    await timeline.evaluate(el => el.scrollTop = el.scrollHeight)
    await page.waitForTimeout(500)

    // Scroll up
    await timeline.evaluate(el => el.scrollTop = 0)
    await page.waitForTimeout(1000)

    await page.click('button[title="Music"]')
    await expect(page).toHaveURL(/\/\?view=music$/)
    await page.click('button[title="Chats"]')

    // Wait for restoration
    await page.waitForTimeout(1000)
    const scrollTop = await timeline.evaluate(el => el.scrollTop)
    expect(scrollTop).toBeLessThan(200)

    // Scroll to middle
    await timeline.evaluate(el => el.scrollTop = 500)
    await page.waitForTimeout(1000)

    // Create charlie room
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'charlie')
    await page.click('.search-result-item:has-text("charlie")')
    await page.click('button:has-text("Create Room")')
    await expect(page.locator('chat-view header h6')).toContainText('charlie', { timeout: 15000 })

    await page.click('chat-list-item:has-text("bob")')
    await expect(page.locator('chat-view header h6')).toContainText('bob', { timeout: 10000 })

    await page.waitForTimeout(1000)
    const restoredScrollTop = await timeline.evaluate(el => el.scrollTop)
    expect(restoredScrollTop).toBeGreaterThan(350)
    expect(restoredScrollTop).toBeLessThan(650)
  })

  test('List Scroll Restoration: Should remember scroll position in state', async ({ page }) => {
    // 1. Just create 2 rooms so we have some items
    for (let i = 0; i < 2; i++) {
      await page.click('button[title="Create Room"]')
      await page.fill('input[placeholder="Search by username..."]', 'bob')
      await page.click('.search-result-item:has-text("bob")')
      await page.click('button:has-text("Create Room")')
      await expect(page).toHaveURL(/view=chats&id=/, { timeout: 10000 })
    }

    // Set a known scroll position in $state directly to simulate having scrolled
    await page.evaluate(() => {
      if (!window.$state.listScrollPositions) {
        window.$state.listScrollPositions = {}
      }
      window.$state.listScrollPositions.chats = 123
    })

    await page.click('button[title="Music"]')
    await expect(page).toHaveURL(/\/\?view=music$/)
    await page.click('button[title="Chats"]')

    // Check it's preserved in $state
    const stateScroll = await page.evaluate(() => window.$state.listScrollPositions?.chats)
    expect(stateScroll).toBe(123)
  })
})
