import { test, expect } from '@playwright/test'
import { stubAuth, seedSession, loadWithFixture } from '../helpers/storage-fixture.js'

test.use({ video: 'on' })

test.beforeEach(async ({ page }) => {
  await stubAuth(page)
  await seedSession(page)
  await loadWithFixture(page, {
    seed: 'chatWithMessages',
    path: '/app.html?rail=core.chat&detail=chat&id=r_1'
  })
})

test.describe('Reactions Component Integration', () => {
  test('1. Pre-seeded reaction renders as a chip with aggregated count', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_1"]')
    await expect(bubble).toBeVisible()

    const chip = bubble.locator('reaction-chip[reaction="👍"]')
    await expect(chip).toBeVisible()

    const count = chip.locator('.chip__count')
    await expect(count).toHaveText('2')
  })

  test('2. Context menu shows emoji row with six emoji buttons', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await expect(bubble).toBeVisible()
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    const emojis = page.locator('button.menu__emoji')
    await expect(emojis).toHaveCount(6)
  })

  test('3. Reacting from context menu adds a reaction chip to the message', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const emojiBtn = page.locator('button.menu__emoji', { hasText: '❤️' })
    await expect(emojiBtn).toBeVisible()
    await emojiBtn.click()

    const chip = bubble.locator('reaction-chip[reaction="❤️"]')
    await expect(chip).toBeVisible()
    await expect(chip.locator('.chip__count')).toHaveText('1')
  })

  test('4. Clicking a chip toggles user own reaction', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const emojiBtn = page.locator('button.menu__emoji', { hasText: '😂' })
    await expect(emojiBtn).toBeVisible()
    await emojiBtn.click()

    const chip = bubble.locator('reaction-chip[reaction="😂"]')
    await expect(chip).toBeVisible()

    // Click the chip to remove the reaction
    await chip.click()
    await expect(chip).not.toBeVisible()
  })

  test('5. Multiple user reactions produce an aggregated count', async ({ page }) => {
    const chip = page.locator('message-bubble[message-id="m_1"] reaction-chip[reaction="👍"]')
    await expect(chip).toBeVisible()
    await expect(chip.locator('.chip__count')).toHaveText('2')
  })

  test('6. Own reaction chip reflects is-own host attribute', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const emojiBtn = page.locator('button.menu__emoji', { hasText: '🎉' })
    await expect(emojiBtn).toBeVisible()
    await emojiBtn.click()

    const chip = bubble.locator('reaction-chip[reaction="🎉"]')
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute('is-own', '')
  })

  test('7. Tombstoned messages do not show emoji picker row in context menu', async ({ page }) => {
    const tombstoneBubble = page.locator('message-bubble[message-id="m_5"]')
    await expect(tombstoneBubble).toBeVisible()
    await tombstoneBubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    const reactionsRow = page.locator('.menu__reactions')
    await expect(reactionsRow).toBeHidden()
  })

  test('8. Capture screenshot of reaction chips on a message', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const emojiBtn = page.locator('button.menu__emoji', { hasText: '👍' })
    await expect(emojiBtn).toBeVisible()
    await emojiBtn.click()

    await expect(bubble.locator('reaction-chip[reaction="👍"]')).toBeVisible()

    await page.screenshot({
      path: 'test-results/reactions-chips.png'
    })
  })

  test('9. Capture screenshot of open reaction picker in context menu', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    await page.screenshot({
      path: 'test-results/reactions-picker-open.png'
    })
  })
})
