import { test, expect } from './fixtures/base-test.js'

test.describe('Link Previews', () => {
  test('should generate and display a link preview', async ({ browser, loginCustomPage }) => {
    const aliceContext = await browser.newContext()
    const alicePage = await aliceContext.newPage()

    const bobContext = await browser.newContext()
    const bobPage = await bobContext.newPage()

    // 1. Login Alice and Bob
    await loginCustomPage(alicePage, 'alice', 'Password123!', 'VaultPassword123!')
    await loginCustomPage(bobPage, 'bob', 'Password123!', 'VaultPassword123!')

    // 2. Alice creates chat with Bob
    await alicePage.click('button[title="Create Room"]')
    await alicePage.fill('input[placeholder="Search by username..."]', 'bob')
    await alicePage.click('.search-result-item:has-text("bob")')
    await alicePage.click('button:has-text("Create Room")')

    await expect(alicePage.locator('chat-view')).toBeVisible()

    // 3. Alice types a URL
    const url = 'https://github.com/pocketbase/pocketbase'
    await alicePage.fill('textarea[placeholder="Type a message..."]', `Check this out: ${url} `)

    // 4. Verify live preview appears
    const livePreview = alicePage.locator('link-preview-input')
    await expect(livePreview).toBeVisible({ timeout: 15000 })

    // 5. Alice sends the message
    await alicePage.click('[data-testid$="__sendButton"]')

    // 6. Verify link preview in Alice's timeline
    const aliceLinkPreview = alicePage.locator('link-preview')
    await expect(aliceLinkPreview).toBeVisible({ timeout: 15000 })

    // 7. Bob opens the chat and verifies preview
    const bobChatListAlice = bobPage.locator('chat-list .list-group-item').filter({ hasText: 'alice' }).first()
    await expect(bobChatListAlice).toBeVisible({ timeout: 20000 })
    await bobChatListAlice.click()

    const bobLinkPreview = bobPage.locator('link-preview')
    await expect(bobLinkPreview).toBeVisible({ timeout: 15000 })

    // Verify it's a link
    const linkAnchor = bobLinkPreview.locator('a')
    await expect(linkAnchor).toHaveAttribute('href', url)

    await aliceContext.close()
    await bobContext.close()
  })

  test('should allow dismissing a link preview', async ({ page, loginCustomPage }) => {
    await loginCustomPage(page, 'alice', 'Password123!', 'VaultPassword123!')

    // Open any chat
    await page.click('button[title="Create Room"]')
    await page.fill('input[placeholder="Search by username..."]', 'bob')
    await page.click('.search-result-item:has-text("bob")')
    await page.click('button:has-text("Create Room")')

    const url = 'https://example.com '
    await page.fill('textarea[placeholder="Type a message..."]', url)

    await expect(page.locator('link-preview-input')).toBeVisible({ timeout: 10000 })

    // Dismiss
    await page.click('link-preview-input button[title="Dismiss preview"]')
    await expect(page.locator('link-preview-input')).not.toBeVisible()

    // Send
    await page.click('button:has-text("Send")')

    // Verify no link preview in timeline, only text
    await expect(page.locator('timeline-row').filter({ hasText: 'example.com' })).toBeVisible()
    await expect(page.locator('link-preview')).not.toBeVisible()
  })
})
