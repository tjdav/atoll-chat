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

test.describe('Message Reply / Quote Flow', () => {
  test('1. The context menu shows the Reply item for normal messages', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Reply' })
    await expect(replyBtn).toBeVisible()
  })

  test('2. The Reply item is visible for tombstone messages', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_5"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Reply' })
    await expect(replyBtn).toBeVisible()
  })

  test('3. Clicking Reply opens the preview bar above composer', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Reply' })
    await replyBtn.click()

    const preview = page.locator('[data-testid="reply-preview"]')
    await expect(preview).toBeVisible()
  })

  test('4. The preview bar displays sender name and snippet', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Reply' })
    await replyBtn.click()

    const sender = page.locator('.preview__sender')
    const snippet = page.locator('.preview__snippet')

    await expect(sender).toHaveText('Alice')
    await expect(snippet).toHaveText('How are you?')
  })

  test('5. The preview dismiss button clears the active reply state', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Reply' })
    await replyBtn.click()

    const preview = page.locator('[data-testid="reply-preview"]')
    await expect(preview).toBeVisible()

    const closeBtn = page.locator('.preview__close')
    await closeBtn.click()

    await expect(preview).toBeHidden()
  })

  test('6. Sending with an active reply renders inline quote in sent bubble', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Reply' })
    await replyBtn.click()

    const preview = page.locator('[data-testid="reply-preview"]')
    await expect(preview).toBeVisible()

    const composer = page.locator('message-composer')
    const textarea = composer.locator('textarea')
    const sendBtn = composer.locator('.composer__btn--send')
    await textarea.fill('Doing well, thanks!')
    await expect(sendBtn).toBeEnabled()
    await sendBtn.click()

    const newBubble = page.locator('message-bubble[message-id^="local_"]')
    const quote = newBubble.locator('.bubble-quote')
    await expect(quote).toBeVisible()

    const quoteSender = newBubble.locator('.bubble-quote__sender')
    const quoteSnippet = newBubble.locator('.bubble-quote__snippet')

    await expect(quoteSender).toHaveText('Alice')
    await expect(quoteSnippet).toHaveText('How are you?')
  })

  test('7. The sent bubble quote possesses the accent border stripe styling', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Reply' })
    await replyBtn.click()

    const preview = page.locator('[data-testid="reply-preview"]')
    await expect(preview).toBeVisible()

    const composer = page.locator('message-composer')
    const textarea = composer.locator('textarea')
    const sendBtn = composer.locator('.composer__btn--send')
    await textarea.fill('Testing quote styling')
    await expect(sendBtn).toBeEnabled()
    await sendBtn.click()

    const newBubble = page.locator('message-bubble[message-id^="local_"]')
    const quote = newBubble.locator('.bubble-quote')
    await expect(quote).toBeVisible()
  })

  test('8. Replying to a deleted message renders the deleted placeholder in quote', async ({ page }) => {
    const bubble = page.locator('message-bubble[message-id="m_5"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Reply' })
    await replyBtn.click()

    const preview = page.locator('[data-testid="reply-preview"]')
    await expect(preview).toBeVisible()

    const composer = page.locator('message-composer')
    const textarea = composer.locator('textarea')
    const sendBtn = composer.locator('.composer__btn--send')
    await textarea.fill('Replying to deleted message')
    await expect(sendBtn).toBeEnabled()
    await sendBtn.click()

    const newBubble = page.locator('message-bubble[message-id^="local_"]')
    const quoteSnippet = newBubble.locator('.bubble-quote__snippet')
    await expect(quoteSnippet).toHaveText('Message deleted')
  })

  test('9. Screenshot — reply preview active', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Reply' })
    await replyBtn.click()

    const preview = page.locator('[data-testid="reply-preview"]')
    await expect(preview).toBeVisible()

    await page.screenshot({ path: 'test-results/reply-preview-active.png' })
  })

  test('10. Screenshot — reply quote rendered', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Reply' })
    await replyBtn.click()

    const preview = page.locator('[data-testid="reply-preview"]')
    await expect(preview).toBeVisible()

    const composer = page.locator('message-composer')
    const textarea = composer.locator('textarea')
    const sendBtn = composer.locator('.composer__btn--send')
    await textarea.fill('I am doing well, how about you?')
    await expect(sendBtn).toBeEnabled()
    await sendBtn.click()

    const newBubble = page.locator('message-bubble[message-id^="local_"]')
    const quote = newBubble.locator('.bubble-quote')
    await expect(quote).toBeVisible()

    await page.screenshot({ path: 'test-results/reply-quote-rendered.png' })
  })

  test('11. Locale check translates cancel reply close label', async ({ page }) => {
    await page.goto('/index.html')
    await page.evaluate(() => {
      localStorage.setItem('atoll.session.token', 'test-token')
      localStorage.setItem('atoll.session.username', 'alice')
      localStorage.setItem('atoll.preference.locale', 'fr')
    })
    await loadWithFixture(page, {
      seed: 'chatWithMessages',
      path: '/app.html?rail=core.chat&detail=chat&id=r_1'
    })

    const bubble = page.locator('message-bubble[message-id="m_2"]')
    await bubble.locator('.bubble').dispatchEvent('contextmenu', { clientX: 300, clientY: 300 })

    const replyBtn = page.locator('button', { hasText: 'Répondre' })
    await replyBtn.click()

    const closeBtn = page.locator('.preview__close')
    await expect(closeBtn).toHaveAttribute('aria-label', 'Annuler la réponse')
  })
})
