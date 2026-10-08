import { test, expect } from '@playwright/test'
import { stubAuth, seedSession, loadWithFixture } from '../helpers/storage-fixture.js'

test.use({ video: 'on' })

test.describe('Message Thread Surface Component Tests', () => {
  test('1. Empty thread state renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await stubAuth(page)
    await seedSession(page)
    await loadWithFixture(page, { seed: 'chatEmpty', path: '/app.html?rail=core.chat&detail=chat&id=r_1' })

    const chatView = page.locator('[data-testid="chat"]')
    await expect(chatView).toBeVisible()

    const emptyText = page.locator('.chat__empty')
    await expect(emptyText).toBeVisible()
    await expect(emptyText).toHaveText('This is the beginning of the room.')

    await page.screenshot({ path: 'test-results/chat-empty.png', fullPage: true })
  })

  test('2. Populated thread renders bubbles, date separators, new messages divider, and tombstone', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await stubAuth(page)
    await seedSession(page)
    await loadWithFixture(page, { seed: 'chatWithMessages', path: '/app.html?rail=core.chat&detail=chat&id=r_1' })

    const chatView = page.locator('[data-testid="chat"]')
    await expect(chatView).toBeVisible()

    const bubbles = page.locator('message-bubble')
    await expect(bubbles.first()).toBeVisible()

    const dateSep = page.locator('date-separator')
    await expect(dateSep.first()).toBeVisible()

    const divider = page.locator('.chat__divider')
    await expect(divider).toBeVisible()
    await expect(divider).toHaveText('New messages')

    const tombstone = page.locator('message-bubble[is-tombstone]')
    await expect(tombstone).toBeVisible()

    const pending = page.locator('message-bubble[is-pending]')
    await expect(pending).toBeVisible()

    await page.screenshot({ path: 'test-results/chat-populated.png', fullPage: true })
  })

  test('3. Scrolling up triggers scroll-to-bottom button and clicking it scrolls back to bottom', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await stubAuth(page)
    await seedSession(page)
    await loadWithFixture(page, { seed: 'chatWithMessages', path: '/app.html?rail=core.chat&detail=chat&id=r_1' })

    const thread = page.locator('[data-testid="thread"]')
    await expect(thread).toBeVisible()

    await thread.evaluate((el) => {
      el.scrollTop = el.scrollTop - 1000
    })

    const scrollBtn = page.locator('[data-testid="scroll-to-bottom"]')
    await expect(scrollBtn).toBeVisible()

    await scrollBtn.click()

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="thread"]')
      if (!el) return false
      return el.scrollHeight - el.scrollTop - el.clientHeight <= 80
    })
  })

  test('4. Empty thread respects French locale', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await stubAuth(page)
    await page.goto('/index.html')
    await page.evaluate(() => {
      localStorage.setItem('atoll.session.token', 'test-session-token')
      localStorage.setItem('atoll.session.username', 'alice')
      localStorage.setItem('atoll.preference.locale', 'fr')
    })
    await loadWithFixture(page, { seed: 'chatEmpty', path: '/app.html?rail=core.chat&detail=chat&id=r_1' })

    const emptyText = page.locator('.chat__empty')
    await expect(emptyText).toBeVisible()
    await expect(emptyText).toHaveText('C’est le début du salon.')
  })
})
