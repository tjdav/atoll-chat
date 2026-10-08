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

test.describe('Message Editing', () => {
  test('1. Edit is available for own recent message', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_7"]')
    await expect(bubble).toBeVisible()
    await bubble.click({ button: 'right' })

    const editItem = page.locator('message-context-menu button[ref="edit"]')
    await expect(editItem).toBeVisible()
  })

  test('2. Edit is not available for another user message', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_1"]')
    await expect(bubble).toBeVisible()
    await bubble.click({ button: 'right' })

    const editItem = page.locator('message-context-menu button[ref="edit"]')
    await expect(editItem).toBeHidden()
  })

  test('3. Edit is not available for own old message', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_6"]')
    await expect(bubble).toBeVisible()
    await bubble.click({ button: 'right' })

    const editItem = page.locator('message-context-menu button[ref="edit"]')
    await expect(editItem).toBeHidden()
  })

  test('4. Edit is not available for a tombstone', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_5"]')
    await expect(bubble).toBeVisible()
    await bubble.click({ button: 'right' })

    const editItem = page.locator('message-context-menu button[ref="edit"]')
    await expect(editItem).toBeHidden()
  })

  test('5. Clicking Edit enters edit mode & screenshot active', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_7"]')
    await bubble.click({ button: 'right' })
    await page.locator('message-context-menu button[ref="edit"]').click()

    const banner = page.locator('message-composer .composer-banner')
    await expect(banner).toBeVisible()

    const textarea = page.locator('message-composer textarea[ref="input"]')
    await expect(textarea).toHaveValue('Editable message')

    const sendBtn = page.locator('message-composer button[ref="send"]')
    await expect(sendBtn).toHaveText('✓')

    await page.screenshot({ path: 'test-results/edit-mode-active.png' })
  })

  test('6. Submitting an edit updates the message & screenshot applied', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_7"]')
    await bubble.click({ button: 'right' })
    await page.locator('message-context-menu button[ref="edit"]').click()

    const textarea = page.locator('message-composer textarea[ref="input"]')
    await textarea.fill('Edited message')

    const sendBtn = page.locator('message-composer button[ref="send"]')
    await sendBtn.click()

    const updatedText = bubble.locator('.bubble__text')
    await expect(updatedText).toHaveText('Edited message')

    const editedTag = bubble.locator('.bubble__edited')
    await expect(editedTag).toBeVisible()

    await page.screenshot({ path: 'test-results/edit-applied.png' })
  })

  test('7. Cancelling an edit returns to normal', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_7"]')
    await bubble.click({ button: 'right' })
    await page.locator('message-context-menu button[ref="edit"]').click()

    const cancelBtn = page.locator('message-composer button[ref="cancel"]')
    await cancelBtn.click()

    const banner = page.locator('message-composer .composer-banner')
    await expect(banner).toBeHidden()

    const textarea = page.locator('message-composer textarea[ref="input"]')
    await expect(textarea).toHaveValue('')

    const text = bubble.locator('.bubble__text')
    await expect(text).toHaveText('Editable message')
  })

  test('8. Edited indicator persists after reload', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_7"]')
    await bubble.click({ button: 'right' })
    await page.locator('message-context-menu button[ref="edit"]').click()

    const textarea = page.locator('message-composer textarea[ref="input"]')
    await textarea.fill('Persistent edit')
    await page.locator('message-composer button[ref="send"]').click()

    await expect(bubble.locator('.bubble__text')).toHaveText('Persistent edit')

    await page.reload()
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('test-storage-seeded'))
    })

    const reloadedBubble = page.locator('message-bubble[message-id="m_7"]')
    await expect(reloadedBubble.locator('.bubble__text')).toHaveText('Persistent edit')
    await expect(reloadedBubble.locator('.bubble__edited')).toBeVisible()
  })
})
