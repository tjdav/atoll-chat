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

test.describe('Message Versions Sheet ("Show Original")', () => {
  test('1. "Edited" label is not shown for unedited messages', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_1"]')
    await expect(bubble).toBeVisible()

    const editedBtn = bubble.locator('button.bubble-edited')
    await expect(editedBtn).toBeHidden()
  })

  test('2. "Edited" label appears after edit and clicking it opens edit history sheet', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_7"]')
    await expect(bubble).toBeVisible()

    // Right-click message text and choose Edit
    await bubble.locator('.bubble__text').click({ button: 'right' })

    const editBtn = page.locator('message-context-menu button', { hasText: 'Edit' })
    await expect(editBtn).toBeVisible()
    await editBtn.click()

    // Fill edit input and save
    const textarea = page.locator('message-composer textarea')
    await textarea.fill('First edited version')

    const saveBtn = page.locator('message-composer button', { hasText: '✓' })
    await saveBtn.click()

    // Verify bubble shows updated text and Edited button
    await expect(bubble.locator('.bubble__text')).toHaveText('First edited version')
    const editedBtn = bubble.locator('button.bubble-edited')
    await expect(editedBtn).toBeVisible()

    // Click Edited button to open history sheet
    await editedBtn.click()

    // Verify sheet is open
    const sheet = page.locator('message-versions-sheet ui-sheet')
    await expect(sheet).toBeVisible()

    const items = page.locator('message-versions-sheet [data-testid="history"] li.history__item')
    await expect(items).toHaveCount(2)

    // Check Current version (top item)
    const currentItem = items.nth(0)
    await expect(currentItem.locator('.history__badge')).toHaveText('Current')
    await expect(currentItem.locator('.history__text')).toHaveText('First edited version')

    // Check Original version (bottom item)
    const originalItem = items.nth(1)
    await expect(originalItem.locator('.history__badge')).toHaveText('Original')
    await expect(originalItem.locator('.history__text')).toHaveText('Editable message')

    // Desktop screenshot
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: 'test-results/versions-sheet-open.png' })

    // Mobile screenshot
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'test-results/versions-sheet-mobile.png' })
  })

  test('3. Escape key closes the version sheet', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_7"]')
    await bubble.locator('.bubble__text').click({ button: 'right' })

    const editBtn = page.locator('message-context-menu button', { hasText: 'Edit' })
    await editBtn.click()

    const textarea = page.locator('message-composer textarea')
    await textarea.fill('New edit text')
    await page.locator('message-composer button', { hasText: '✓' }).click()

    await bubble.locator('button.bubble-edited').click()
    const sheet = page.locator('message-versions-sheet ui-sheet')
    await expect(sheet).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })

  test('4. Close button closes the version sheet', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_7"]')
    await bubble.locator('.bubble__text').click({ button: 'right' })

    const editBtn = page.locator('message-context-menu button', { hasText: 'Edit' })
    await editBtn.click()

    const textarea = page.locator('message-composer textarea')
    await textarea.fill('New edit text')
    await page.locator('message-composer button', { hasText: '✓' }).click()

    await bubble.locator('button.bubble-edited').click()
    const sheet = page.locator('message-versions-sheet ui-sheet')
    await expect(sheet).toBeVisible()

    await sheet.locator('.sheet__close').click()
    await expect(sheet).toBeHidden()
  })
})
