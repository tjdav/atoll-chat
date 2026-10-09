import { test, expect } from '@playwright/test'
import { stubAuth, seedSession, loadWithFixture } from '../helpers/storage-fixture.js'

test.use({ video: 'on' })

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await stubAuth(page)
  await seedSession(page)
  await loadWithFixture(page, {
    seed: 'chatWithMessages',
    path: '/app.html?rail=core.chat&detail=chat&id=r_1'
  })
})

test.describe('Message Context Menu', () => {
  test('1. Right-click opens the menu', async ({ page }) => {
    const bubble = page.locator('message-bubble').first()
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })
    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
  })

  test('2. Copy and Delete for me are visible for another user message; Unsend is hidden', async ({ page }) => {
    // First message in seed is from Alice (u_alice)
    const bubble = page.locator('message-bubble[sender-name="Alice"]').first()
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const copyBtn = page.locator('button', { hasText: 'Copy' })
    const deleteBtn = page.locator('button', { hasText: 'Delete for me' })
    const unsendBtn = page.locator('button', { hasText: 'Unsend' })

    await expect(copyBtn).toBeVisible()
    await expect(deleteBtn).toBeVisible()
    await expect(unsendBtn).toBeHidden()
  })

  test('3. Copy, Unsend, and Delete for me are visible for own recent message', async ({ page }) => {
    // u_me message m_3 in seed is recent sent message
    const bubble = page.locator('message-bubble[message-id="m_3"]')
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const copyBtn = page.locator('button', { hasText: 'Copy' })
    const deleteBtn = page.locator('button', { hasText: 'Delete for me' })
    const unsendBtn = page.locator('button', { hasText: 'Unsend' })

    await expect(copyBtn).toBeVisible()
    await expect(deleteBtn).toBeVisible()
    await expect(unsendBtn).toBeVisible()
  })

  test('4. Unsend is not shown for own message past 24-hour window', async ({ page }) => {
    // Seed message m_4 is 25 hours old from u_me
    const bubble = page.locator('message-bubble[message-id="m_4"]')
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const unsendBtn = page.locator('button', { hasText: 'Unsend' })
    await expect(unsendBtn).toBeHidden()
  })

  test('5. Copy action writes message text to clipboard', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_1"]')
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const copyBtn = page.locator('button', { hasText: 'Copy' })
    await copyBtn.click()

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toBe('Hello world')
  })

  test('6. Delete for me removes the bubble from the thread', async ({ page }) => {
    const countBefore = await page.locator('message-bubble').count()
    const bubble = page.locator('message-bubble[message-id="m_1"]')
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const deleteBtn = page.locator('button', { hasText: 'Delete for me' })
    await deleteBtn.click()

    const countAfter = await page.locator('message-bubble').count()
    expect(countAfter).toBe(countBefore - 1)
    await expect(page.locator('message-bubble[message-id="m_1"]')).toHaveCount(0)
  })

  test('7. Unsend replaces message with tombstone', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_3"]')
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const unsendBtn = page.locator('button', { hasText: 'Unsend' })
    await unsendBtn.click()

    const unsentBubble = page.locator('message-bubble[message-id="m_3"]')
    await expect(unsentBubble).toHaveAttribute('is-tombstone', '')
  })

  test('8. Click outside closes the menu', async ({ page }) => {
    const bubble = page.locator('message-bubble').first()
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    await page.mouse.click(10, 10)
    await expect(menu).toBeHidden()
  })

  test('9. Escape key closes the menu', async ({ page }) => {
    const bubble = page.locator('message-bubble').first()
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  })

  test('10. Long-press opens menu on touch pointer down', async ({ page }) => {
    const bubbleRow = page.locator('[data-testid="conversation-row"]').first()
    await bubbleRow.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 150, clientY: 150 })
    await page.waitForTimeout(600)
    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await bubbleRow.dispatchEvent('pointerup')
  })

  test('11. Locale switching translates context menu labels', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('atoll.preference.locale', 'fr')
    })
    await loadWithFixture(page, {
      seed: 'chatWithMessages',
      path: '/app.html?rail=core.chat&detail=chat&id=r_1'
    })

    const bubble = page.locator('message-bubble').first()
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const copyBtn = page.locator('button', { hasText: 'Copier' })
    await expect(copyBtn).toBeVisible()
  })

  test('12. Screenshot capture', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_3"]')
    await bubble.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    await page.screenshot({ path: 'test-results/context-menu-open.png' })
  })

  test('13. Menu can be reopened after closing and still positions correctly', async ({ page }) => {
    const bubble1 = page.locator('message-bubble[message-id="m_1"]')
    await bubble1.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    const bubble3 = page.locator('message-bubble[message-id="m_3"]')
    await bubble3.dispatchEvent('contextmenu', { clientX: 300, clientY: 400 })

    await expect(menu).toBeVisible()
    await page.waitForFunction(() => {
      const el = document.querySelector('[role="menu"]')
      return Boolean(el && el.style.left && el.style.top)
    })
  })
})
